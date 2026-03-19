const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const prompts = require('./prompts');

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

/** Helper: call Claude and parse JSON from response */
async function callClaude(systemPrompt, userContent, maxTokens = 4000) {
  let response;
  try {
    response = await getClient().messages.create({
      model: config.claude.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
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
    response = await getClient().messages.create({
      model: config.claude.model,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Génère l\'icebreaker.' }],
    });
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

async function chat(messages, context) {
  const systemPrompt = `Tu es l'assistant IA de Bakal, une plateforme de prospection B2B.
Tu aides les utilisateurs à construire et optimiser leurs campagnes d'outreach (Email + LinkedIn).

Tu es conversationnel, chaleureux et direct. Tu guides l'utilisateur étape par étape.

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

Tu peux inclure UN SEUL bloc JSON par réponse. Le texte autour du JSON sert d'explication pour l'utilisateur.

${context ? `\nContexte actuel de l'utilisateur :\n${context}` : ''}`;

  let response;
  try {
    response = await getClient().messages.create({
      model: config.claude.model,
      max_tokens: 3000,
      system: systemPrompt,
      messages,
    });
  } catch (err) {
    throw wrapApiError(err);
  }

  return {
    content: response.content[0].text,
    usage: response.usage,
  };
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
};
