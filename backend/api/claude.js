const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const prompts = require('./prompts');
const { withRetry } = require('../lib/retry');
const logger = require('../lib/logger');

let client;
let clientKeyHash;
function getClient() {
  const currentKey = config.claude.apiKey || '';
  if (!currentKey) {
    const err = new Error('Clé API Anthropic non configurée. Ajoutez-la dans Réglages ou dans le fichier .env.');
    err.status = 503;
    err.code = 'API_KEY_MISSING';
    throw err;
  }
  if (!client || clientKeyHash !== currentKey) {
    client = new Anthropic({ apiKey: currentKey });
    clientKeyHash = currentKey;
  }
  return client;
}

/** Wrap Anthropic SDK errors into user-friendly messages */
function wrapApiError(err) {
  const msg = err?.error?.error?.message || err?.message || String(err);

  if (msg.includes('credit balance') || msg.includes('billing')) {
    const wrapped = new Error('Crédits API Anthropic insuffisants. Rechargez votre compte sur console.anthropic.com.');
    wrapped.status = 402;
    wrapped.code = 'INSUFFICIENT_CREDITS';
    return wrapped;
  }
  if (msg.includes('authentication') || msg.includes('invalid x-api-key') || msg.includes('invalid api key')) {
    const wrapped = new Error('Clé API Anthropic invalide. Vérifiez-la dans Réglages.');
    wrapped.status = 401;
    wrapped.code = 'INVALID_API_KEY';
    return wrapped;
  }
  if (msg.includes('rate_limit') || msg.includes('rate limit')) {
    const wrapped = new Error('Limite de requêtes API atteinte. Réessayez dans quelques instants.');
    wrapped.status = 429;
    wrapped.code = 'RATE_LIMITED';
    return wrapped;
  }
  if (msg.includes('overloaded') || msg.includes('529')) {
    const wrapped = new Error('API Anthropic temporairement surchargée. Réessayez dans quelques minutes.');
    wrapped.status = 503;
    wrapped.code = 'API_OVERLOADED';
    return wrapped;
  }

  const wrapped = new Error('Erreur API Claude : ' + msg.substring(0, 200));
  wrapped.status = err.status || 500;
  wrapped.code = 'API_ERROR';
  return wrapped;
}

/**
 * Convert a system prompt (string or array) to the cacheable array format.
 * - String input → wrapped in a single ephemeral-cached text block
 * - Array input → passed through (caller controls cache breakpoints)
 *
 * Prompt caching notes:
 * - Min 1024 tokens for Sonnet, 2048 for Opus/Haiku to actually cache.
 * - Below that threshold, cache_control is silently ignored.
 * - Cache lifetime is 5 min, refreshed on each hit.
 * - Cache hit → ~10% of normal input cost. First write → 25% premium.
 */
function toSystemBlocks(systemPrompt) {
  if (Array.isArray(systemPrompt)) return systemPrompt;
  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/** Helper: call Claude and parse JSON from response */
async function callClaude(systemPrompt, userContent, maxTokens = 4000) {
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model: config.claude.model,
      max_tokens: maxTokens,
      system: toSystemBlocks(systemPrompt),
      messages: [{ role: 'user', content: userContent }],
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    logger.error('claude', 'API call failed', { error: err.message });
    throw wrapApiError(err);
  }

  const text = response.content[0].text;

  // Try to extract JSON from response
  let parsed;
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[1] || jsonMatch[0]) : null;
  } catch {
    parsed = null;
  }

  return { raw: text, parsed, usage: response.usage };
}

// =============================================
// Generate Full Sequence (Master Prompt)
// =============================================

async function generateSequence(params) {
  const systemPrompt = prompts.masterPrompt(params);
  const userContent = `Génère la séquence de prospection complète pour cette campagne.

Paramètres clés :
- Secteur : ${params.sector}
- Cible : ${params.position}
- Canal : ${params.channel}
- Angle : ${params.angle || 'Douleur client'}
- Proposition de valeur : ${params.valueProp || 'À déduire du contexte'}
- Douleurs : ${params.painPoints || 'À déduire du secteur'}

Retourne UNIQUEMENT le JSON structuré.`;

  return callClaude(systemPrompt, userContent, 6000);
}

// =============================================
// Generate Single Touchpoint (Sub-Prompt)
// =============================================

async function generateTouchpoint(type, params) {
  const subPromptFn = prompts.subPrompts[type];
  if (!subPromptFn) {
    throw new Error(`Type de touchpoint inconnu : ${type}. Types valides : ${Object.keys(prompts.subPrompts).join(', ')}`);
  }

  const systemPrompt = subPromptFn(params);
  return callClaude(systemPrompt, 'Génère le touchpoint. Retourne UNIQUEMENT le JSON structuré.', 2000);
}

// =============================================
// Performance Analysis
// =============================================

async function analyzeCampaign(campaignData) {
  const systemPrompt = prompts.analysisPrompt(campaignData);
  const result = await callClaude(
    systemPrompt,
    `Analyse cette campagne et fournis le diagnostic complet en JSON.\n\nDonnées brutes :\n${JSON.stringify(campaignData, null, 2)}`,
    3000,
  );

  // For backwards compatibility, also extract text diagnostic
  return {
    diagnostic: result.parsed?.summary
      ? `## Résumé\n${result.parsed.summary}\n\n## Analyse détaillée\n${result.raw}`
      : result.raw,
    parsed: result.parsed,
    usage: result.usage,
  };
}

// =============================================
// Sequence Regeneration
// =============================================

async function regenerateSequence(params) {
  const systemPrompt = prompts.regenerationPrompt(params);
  const userContent = `Régénère les messages selon le diagnostic et les instructions.

Messages originaux :
${JSON.stringify(params.originalMessages, null, 2)}

Retourne UNIQUEMENT le JSON structuré.`;

  return callClaude(systemPrompt, userContent, 5000);
}

// =============================================
// Cross-Campaign Memory Consolidation
// =============================================

async function consolidateMemory(diagnostics, existingMemory) {
  const systemPrompt = prompts.memoryConsolidationPrompt(diagnostics, existingMemory);
  return callClaude(
    systemPrompt,
    'Consolide les diagnostics et retourne les patterns en JSON.',
    3000,
  );
}

// =============================================
// Variable Chain Generator
// =============================================

async function generateVariables(params) {
  const systemPrompt = prompts.variableGeneratorPrompt(params);
  return callClaude(
    systemPrompt,
    `Analyse le contexte et propose une chaîne de variables personnalisées pour cette campagne.\nRetourne UNIQUEMENT le JSON structuré.`,
    3000,
  );
}

// =============================================
// Icebreaker Execution (per prospect)
// =============================================

async function generateIcebreaker(params) {
  const systemPrompt = prompts.icebreakerExecutionPrompt(params);
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model: config.claude.model,
      max_tokens: 300,
      system: toSystemBlocks(systemPrompt),
      messages: [{ role: 'user', content: 'Génère l\'icebreaker.' }],
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    throw wrapApiError(err);
  }

  return {
    icebreaker: response.content[0].text.trim(),
    usage: response.usage,
  };
}

// =============================================
// Full Refinement Loop
// =============================================

async function runRefinementLoop(campaignData, originalMessages, memory) {
  // Step 1: Analyze
  const analysis = await analyzeCampaign(campaignData);

  // Step 2: Extract regeneration instructions from analysis
  const regenerationInstructions = analysis.parsed?.regenerationInstructions || null;
  const stepsToRegenerate = regenerationInstructions?.stepsToRegenerate || [];

  // If nothing to regenerate, return analysis only
  if (stepsToRegenerate.length === 0 && !analysis.parsed?.priorities?.length) {
    return {
      analysis,
      regeneration: null,
      stepsRegenerated: [],
      totalUsage: analysis.usage,
    };
  }

  // Step 3: Regenerate
  const messagesToRegenerate = originalMessages.filter(
    m => stepsToRegenerate.includes(m.step) || stepsToRegenerate.length === 0,
  );

  const regeneration = await regenerateSequence({
    diagnostic: analysis.diagnostic,
    originalMessages: messagesToRegenerate,
    memory,
    clientParams: {
      tone: campaignData.tone,
      formality: campaignData.formality,
      length: campaignData.length,
      sector: campaignData.sector,
    },
    regenerationInstructions,
  });

  return {
    analysis,
    regeneration,
    stepsRegenerated: stepsToRegenerate,
    totalUsage: {
      input_tokens: (analysis.usage?.input_tokens || 0) + (regeneration.usage?.input_tokens || 0),
      output_tokens: (analysis.usage?.output_tokens || 0) + (regeneration.usage?.output_tokens || 0),
    },
  };
}

// =============================================
// Chat — Conversational Campaign Builder
// =============================================

/**
 * STABLE rules block for the Baakalai chat assistant.
 * - Identical text on every call → eligible for prompt caching (Anthropic
 *   ephemeral cache, 5 min TTL, ~90% input discount on cache hits).
 * - Scope strictly limited to prospection B2B / Baakalai. Off-topic
 *   questions are politely redirected instead of answered, which also
 *   caps token consumption from misuse.
 */
const CHAT_SYSTEM_RULES = `Tu es l'assistant IA de Baakalai, une plateforme de prospection B2B.
Tu aides les utilisateurs à construire et optimiser leurs campagnes d'outreach (Email + LinkedIn).

Tu es conversationnel, chaleureux et direct.

PÉRIMÈTRE STRICT : Tu réponds UNIQUEMENT aux questions liées à :
- Les campagnes de prospection B2B de l'utilisateur (création, édition, analyse, optimisation)
- Le sourcing de prospects (ICP, critères, recherche via les outils connectés)
- La rédaction de copy email/LinkedIn (séquences, touchpoints, angles, ton)
- L'analyse de performance et les A/B tests
- La mémoire cross-campagne et les patterns appris
- L'utilisation des fonctionnalités Baakalai (intégrations, paramètres, tarification)

Si l'utilisateur te pose une question HORS de ce périmètre (météo, actualités, code, recettes, opinions politiques, sujets personnels, general knowledge, etc.), redirige poliment avec cette phrase exacte :
"Je suis l'assistant Baakalai, je ne peux t'aider que sur la prospection B2B et tes campagnes. Dis-moi en quoi je peux t'assister côté outreach !"
Ne réponds PAS à la question hors-sujet, même partiellement. Reste amical mais ferme.

RÈGLE CRITIQUE : Quand l'utilisateur te demande de créer une campagne et que tu as des informations dans le PROFIL ENTREPRISE (secteur, cible, personas, proposition de valeur, zones), tu dois PROPOSER DIRECTEMENT une campagne complète avec séquences basée sur ces informations. Ne pose PAS de questions sur des infos que tu as déjà. Demande uniquement ce qui manque (ex: canal préféré si non renseigné). Si tu as assez d'infos, génère la campagne immédiatement.

Tes capacités :
- Aider à définir un ICP (Ideal Customer Profile)
- Construire une campagne de A à Z (cible, canal, angle, ton, séquences)
- Analyser les performances d'une campagne existante et proposer des optimisations
- Régénérer des touchpoints sous-performants
- Rédiger des séquences de prospection personnalisées
- Exploiter les patterns appris (memory) pour améliorer les nouvelles campagnes
- Planifier des envois et gérer le calendrier de prospection

Règles :
- Réponds toujours en français
- Sois concis mais utile (pas de pavés inutiles)
- IMPORTANT : Si le profil entreprise contient des informations (secteur, cible, proposition de valeur, personas), UTILISE-LES directement. Ne redemande JAMAIS une info déjà présente dans le contexte. Propose directement une campagne basée sur ce que tu sais. Ne pose que les questions manquantes.
- Quand l'utilisateur a défini suffisamment de paramètres pour une campagne, propose un résumé structuré
- Ne mentionne JAMAIS "IA" ou "automatisé" dans les textes de prospection
- Préserve les variables Lemlist : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}
- Utilise le contexte (campagnes, stats, diagnostics, memory patterns) pour personnaliser tes réponses
- Si des memory patterns existent, intègre ces apprentissages dans tes recommandations

ACTIONS STRUCTURÉES :
Quand tu proposes une action concrète, inclus un bloc JSON délimité par \`\`\`json et \`\`\` avec l'un de ces formats :

Créer une campagne :
{ "action": "create_campaign", "campaign": { "name": "...", "sector": "...", "position": "...", "size": "...", "channel": "email|linkedin|multi", "angle": "...", "zone": "...", "tone": "...", "formality": "Tu|Vous", "valueProp": "...", "painPoints": "...", "sequence": [{ "step": "E1", "type": "email", "label": "...", "timing": "J+0", "subject": "...", "body": "..." }] } }

Modifier une campagne existante :
{ "action": "update_campaign", "campaignName": "Nom exact de la campagne", "changes": { "angle": "...", "tone": "..." } }

Lancer une analyse :
{ "action": "analyze_campaign", "campaignName": "Nom exact de la campagne" }

Régénérer des touchpoints spécifiques :
{ "action": "regenerate_touchpoints", "campaignName": "Nom exact de la campagne", "steps": ["E3", "L2"] }

Afficher le diagnostic détaillé :
{ "action": "show_diagnostic", "campaignName": "Nom exact de la campagne" }

Rechercher des prospects via un outil d'outreach :
{ "action": "search_prospects", "source": "apollo", "titles": ["DAF", "Directeur Financier"], "sectors": ["SaaS", "Fintech"], "locations": ["Paris", "Île-de-France"], "companySizes": ["11-50", "51-200"], "limit": 25 }

Demander à l'utilisateur de choisir une source (quand plusieurs outils sont disponibles) :
{ "action": "choose_prospect_source", "sources": [{"provider": "apollo", "name": "Apollo"}, {"provider": "lemlist", "name": "Lemlist"}], "pending_criteria": { "titles": ["DAF"], "sectors": ["SaaS"], "companySizes": ["11-50"], "locations": ["Paris"], "limit": 25 } }

RÈGLES search_prospects (TRÈS IMPORTANT) :
1. Consulte OUTILS OUTREACH CONFIGURÉS dans le contexte. Seuls les outils marqués "✅ peut générer des listes de prospects" peuvent être utilisés comme source.
2. Si 0 outil avec search : NE génère PAS d'action search_prospects. Explique à l'utilisateur qu'il doit connecter un outil de recherche (Apollo par exemple) dans la page Intégrations.
3. Si 1 seul outil avec search : génère directement l'action search_prospects avec "source" = ce provider (ex: "apollo").
4. Si 2+ outils avec search : génère une action "choose_prospect_source" avec la liste des providers disponibles et les critères déjà identifiés dans "pending_criteria". N'exécute pas la recherche tant que l'utilisateur n'a pas choisi.
5. Utilise TOUJOURS les critères du PROFIL ENTREPRISE (target_sectors, persona_primary, target_size, target_zones) sans redemander à l'utilisateur.
6. Les tailles valides pour companySizes sont : "1-10", "11-50", "51-200", "201-500", "501-1000", "1001+".

Tu peux inclure UN SEUL bloc JSON par réponse. Le texte autour du JSON sert d'explication pour l'utilisateur.

RÉPONSES RAPIDES (quick_replies) :
Quand tu poses une question à l'utilisateur avec des choix clairs, ajoute un champ "quick_replies" dans ton JSON pour afficher des boutons cliquables.
Chaque quick_reply a un "label" (texte du bouton) et un "value" (le message envoyé quand l'utilisateur clique).
Tu peux aussi inclure un "type" optionnel : "confirm" (bouton principal vert), "option" (bouton choix standard), ou "dismiss" (bouton secondaire gris).

Exemples de quick_replies SEULS (sans action) :
{ "quick_replies": [{ "label": "Email", "value": "Email", "type": "option" }, { "label": "LinkedIn", "value": "LinkedIn", "type": "option" }, { "label": "Multi-canal", "value": "Multi-canal", "type": "option" }] }

{ "quick_replies": [{ "label": "Oui, on lance", "value": "Oui, je confirme", "type": "confirm" }, { "label": "Non, je veux modifier", "value": "Non, je veux modifier", "type": "dismiss" }] }

Les quick_replies peuvent aussi être combinés avec une action :
{ "action": "create_campaign", "campaign": { ... }, "quick_replies": [{ "label": "Créer cette campagne", "value": "Oui, crée cette campagne", "type": "confirm" }, { "label": "Modifier", "value": "Je veux modifier quelques paramètres", "type": "dismiss" }] }

Utilise les quick_replies quand :
- Tu poses une question avec 2-5 choix clairs (canal, ton, secteur, confirmation...)
- Tu demandes une confirmation oui/non
- Tu proposes des options à l'utilisateur
N'utilise PAS les quick_replies pour les questions ouvertes où l'utilisateur doit écrire librement.`;

/**
 * Build the system param for chat/chatStream as an array of content blocks:
 * - Block 1: stable CHAT_SYSTEM_RULES (cached, same for everyone)
 * - Block 2: per-user dynamic context (NOT cached, varies per call)
 *
 * Anthropic caches everything up to (and including) the last block marked
 * with cache_control. Keeping the dynamic context AFTER the cached block
 * means every user benefits from the shared cache of the rules.
 */
function buildChatSystem(context) {
  const blocks = [
    {
      type: 'text',
      text: CHAT_SYSTEM_RULES,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (context) {
    blocks.push({
      type: 'text',
      text: `\nContexte actuel de l'utilisateur :\n${context}`,
    });
  }
  return blocks;
}

async function chat(messages, context) {
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model: config.claude.model,
      max_tokens: 3000,
      system: buildChatSystem(context),
      messages,
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    throw wrapApiError(err);
  }

  return {
    content: response.content[0].text,
    usage: response.usage,
  };
}

// =============================================
// Chat — Streaming Conversational Campaign Builder
// =============================================

async function chatStream(messages, context, onChunk) {
  let fullText = '';

  try {
    const stream = getClient().messages.stream({
      model: config.claude.model,
      max_tokens: 3000,
      system: buildChatSystem(context),
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullText += event.delta.text;
        if (onChunk) onChunk(event.delta.text);
      }
    }

    const finalMessage = await stream.finalMessage();

    return {
      content: fullText,
      usage: finalMessage.usage || { input_tokens: 0, output_tokens: 0 },
    };
  } catch (err) {
    // If we already streamed some content, return what we have
    if (fullText.length > 0) {
      logger.error('claude', 'Stream interrupted after partial response', { error: err.message });
      return {
        content: fullText,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    }
    logger.error('claude', 'Stream failed', { error: err.message });
    throw wrapApiError(err);
  }
}

module.exports = {
  callClaude,
  generateSequence,
  generateTouchpoint,
  analyzeCampaign,
  regenerateSequence,
  consolidateMemory,
  generateVariables,
  generateIcebreaker,
  runRefinementLoop,
  chat,
  chatStream,
};
