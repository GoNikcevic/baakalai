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
    const err = new Error('Anthropic API key not configured. Add it in Settings or .env file.');
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
    const wrapped = new Error('Insufficient Anthropic API credits. Top up at console.anthropic.com.');
    wrapped.status = 402;
    wrapped.code = 'INSUFFICIENT_CREDITS';
    return wrapped;
  }
  if (msg.includes('authentication') || msg.includes('invalid x-api-key') || msg.includes('invalid api key')) {
    const wrapped = new Error('Invalid Anthropic API key. Check it in Settings.');
    wrapped.status = 401;
    wrapped.code = 'INVALID_API_KEY';
    return wrapped;
  }
  if (msg.includes('rate_limit') || msg.includes('rate limit')) {
    const wrapped = new Error('API rate limit reached. Try again in a moment.');
    wrapped.status = 429;
    wrapped.code = 'RATE_LIMITED';
    return wrapped;
  }
  if (msg.includes('overloaded') || msg.includes('529')) {
    const wrapped = new Error('Anthropic API temporarily overloaded. Try again in a few minutes.');
    wrapped.status = 503;
    wrapped.code = 'API_OVERLOADED';
    return wrapped;
  }

  const wrapped = new Error('Claude API error: ' + msg.substring(0, 200));
  wrapped.status = err.status || 500;
  wrapped.code = 'API_ERROR';
  return wrapped;
}

/**
 * Resolve which model to use for a given action.
 *
 * Priority:
 * 1. If config.claude.model is explicitly set to an Opus model (via env or
 *    Settings), it acts as a global override — every action uses Opus.
 * 2. Otherwise, use the per-action model from config.claude.models.
 * 3. Fallback to config.claude.model (Sonnet by default).
 */
function resolveModel(action) {
  const globalModel = config.claude.model;

  // Global override: if the user explicitly chose an Opus model in Settings,
  // respect that for ALL actions.
  if (globalModel && globalModel.includes('opus')) {
    return globalModel;
  }

  // Per-action routing from config.claude.models
  const actionModel = config.claude.models?.[action];
  if (actionModel) return actionModel;

  // Fallback to the global default
  return globalModel;
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

/** Helper: call Claude and parse JSON from response.
 *  @param {string|Array} systemPrompt
 *  @param {string} userContent
 *  @param {number} [maxTokens=4000]
 *  @param {string} [action] — action name for model routing & logging
 */
async function callClaude(systemPrompt, userContent, maxTokens = 4000, action) {
  const model = resolveModel(action);
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model,
      max_tokens: maxTokens,
      system: toSystemBlocks(systemPrompt),
      messages: [{ role: 'user', content: userContent }],
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    logger.error('claude', 'API call failed', { action, model, error: err.message });
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

  logger.info('claude', 'API call completed', {
    action: action || 'unknown',
    model,
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
  });

  return { raw: text, parsed, usage: response.usage, model };
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

  return callClaude(systemPrompt, userContent, 6000, 'generateSequence');
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
  return callClaude(systemPrompt, 'Génère le touchpoint. Retourne UNIQUEMENT le JSON structuré.', 2000, 'generateTouchpoint');
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
    'analyzeCampaign',
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

  return callClaude(systemPrompt, userContent, 5000, 'regenerateSequence');
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
    'consolidateMemory',
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
    'generateVariables',
  );
}

// =============================================
// Icebreaker Execution (per prospect)
// =============================================

async function generateIcebreaker(params) {
  const action = 'generateIcebreaker';
  const model = resolveModel(action);
  const systemPrompt = prompts.icebreakerExecutionPrompt(params);
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model,
      max_tokens: 300,
      system: toSystemBlocks(systemPrompt),
      messages: [{ role: 'user', content: 'Génère l\'icebreaker.' }],
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    logger.error('claude', 'API call failed', { action, model, error: err.message });
    throw wrapApiError(err);
  }

  logger.info('claude', 'API call completed', {
    action,
    model,
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
  });

  return {
    icebreaker: response.content[0].text.trim(),
    usage: response.usage,
    model,
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

RÈGLE CRITIQUE — CRÉATION DE CAMPAGNE :
Avant de créer une campagne, tu DOIS avoir ces 4 informations obligatoires :
1. **Job titles** des contacts recherches (ex: "Directeur R&D", "DAF", "CEO")
2. **Secteur / industrie** cible (ex: "Biotech", "SaaS", "Industrie pharmaceutique")
3. **Taille d'entreprise** cible (ex: "51-200", "201-500")
4. **Zone geographique** (ex: "France", "Paris", "Europe")

Si l'utilisateur ne precise pas UN de ces 4 elements dans sa demande, DEMANDE-LUI explicitement avec des quick_replies quand c'est possible. Exemple : "Pour creer ta campagne, j'ai besoin de savoir : quels postes tu cibles ?" Ne devine PAS ces informations critiques.

CEPENDANT, si le PROFIL ENTREPRISE contient deja certaines de ces infos (persona_primary, target_sectors, target_size, target_zones), UTILISE-LES et ne redemande que ce qui manque vraiment. Propose directement la campagne avec les infos du profil + ce que l'utilisateur a precise, en demandant uniquement les elements absents des deux sources.

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
- RÈGLE ABSOLUE : Avant CHAQUE action importante (créer une campagne, déployer, envoyer un email, importer des contacts, lancer un scan), demande TOUJOURS une confirmation explicite à l'utilisateur. Exemples : "Tu veux que je lance la création ?", "On part là-dessus ?", "Tu valides cette approche ?". Ne lance JAMAIS une action sans que l'utilisateur ait dit oui.
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

Rechercher des prospects via un outil d'outreach (recherche sectorielle large) :
{ "action": "search_prospects", "source": "apollo", "titles": ["DAF", "Directeur Financier"], "sectors": ["SaaS", "Fintech"], "locations": ["Paris"], "companySizes": ["11-50", "51-200"], "minConnections": 300, "limit": 100 }

Rechercher des prospects DANS des entreprises spécifiques (quand l'utilisateur fournit une liste de sociétés) :
{ "action": "search_prospects", "source": "lemlist", "titles": ["Directeur R&D", "Directeur Innovation"], "companies": ["De Sangosse", "Koppert France", "Lallemand Plant Care", "ARD"], "locations": ["France"], "limit": 50 }

Demander à l'utilisateur de choisir une source (quand plusieurs outils sont disponibles) :
{ "action": "choose_prospect_source", "sources": [{"provider": "apollo", "name": "Apollo"}, {"provider": "lemlist", "name": "Lemlist"}], "pending_criteria": { "titles": ["DAF"], "sectors": ["SaaS"], "companySizes": ["11-50"], "locations": ["Paris"], "limit": 100 } }

Ajouter une liste de contacts fournie par l'utilisateur (quand il colle ou décrit une liste de prospects dans le chat) :
{ "action": "add_prospects_manual", "campaignName": "Nom optionnel de la campagne destinataire", "contacts": [{ "name": "Jean Dupont", "firstName": "Jean", "lastName": "Dupont", "email": "jean.dupont@hopital-xyz.fr", "company": "CHU Lyon", "title": "Directeur R&D", "linkedinUrl": "https://linkedin.com/in/jdupont" }, ...] }

Recherche web approfondie (quand Lemlist retourne peu/pas de resultats pour des entreprises specifiques) :
{ "action": "web_search_prospects", "companies": ["De Sangosse", "Koppert France", "Lallemand Plant Care"], "titles": ["Directeur R&D", "Directeur Innovation"], "location": "France", "campaignName": "optional" }

REGLES web_search_prospects :
- Utilise cette action quand une recherche Lemlist (search_prospects) retourne moins de 5 resultats pour une liste d'entreprises specifiques, OU quand l'utilisateur demande explicitement une "recherche web" ou "recherche approfondie".
- Propose-la automatiquement apres un search_prospects decevant : "Lemlist n'a trouve que X contacts. Je peux lancer une recherche web approfondie sur les Y entreprises sans resultat."
- NE l'utilise PAS pour des recherches sectorielles larges (pas de company list) — dans ce cas utilise search_prospects.
- Max 50 entreprises par action.

RÈGLES add_prospects_manual :
- Si l'utilisateur colle une liste (CSV, texte, tabulaire, ou juste des lignes "Nom - Email - Société - Poste"), parse-la et propose l'action add_prospects_manual avec le tableau contacts.
- L'email est obligatoire pour chaque contact (ignore les lignes sans email).
- Fields acceptés: name, firstName, lastName, email, company, title, linkedinUrl. Remplis ce que tu peux extraire, laisse vide le reste.
- Si l'utilisateur mentionne une campagne destinataire ("ajoute à la campagne Hôpitaux"), mets son nom dans campaignName. Sinon laisse ce champ absent, l'UI demandera à l'utilisateur de choisir.
- NE génère PAS cette action si l'utilisateur demande juste "trouve-moi des prospects" sans fournir de liste — dans ce cas utilise search_prospects.
- Le nombre max de contacts par action est 500.

Envoyer un email personnel à un contact (activation/suivi client) :
{ "action": "send_email", "to": "email@example.com", "toName": "Jean Dupont", "subject": "Objet de l'email", "body": "Contenu de l'email en texte simple" }

Scanner le CRM pour détecter les problèmes de données :
{ "action": "scan_crm", "provider": "pipedrive" }

Nettoyer automatiquement le CRM (corrige les doublons, noms en majuscules, emails invalides) :
{ "action": "clean_crm" }

Relancer les deals stagnants (contacts avec deals inactifs depuis X jours) :
{ "action": "run_nurture", "triggerType": "deal_stagnant", "days": 30 }

Relancer les contacts inactifs :
{ "action": "run_nurture", "triggerType": "inactive_contact", "days": 60 }

Importer les contacts depuis le CRM :
{ "action": "import_crm", "provider": "pipedrive" }

Créer un trigger d'activation (relance automatique sur condition CRM) :
{ "action": "create_trigger", "name": "Relance deals stagnants", "triggerType": "deal_stagnant", "actionType": "email", "days": 30, "mode": "approval" }
triggerType : deal_won | deal_stagnant | inactive_contact | deal_lost | onboarding_check | renewal_reminder | upsell_opportunity | feedback_request
actionType : email | linkedin_connect | linkedin_message | linkedin_visit
mode : auto | approval

Activer ou désactiver l'autopilot de conversation (l'IA répond automatiquement aux prospects) :
{ "action": "toggle_autopilot", "enabled": true }

Lister les clients avec un filtre :
{ "action": "list_clients", "filter": "won|stagnant|inactive", "days": 30 }

RÈGLES send_email :
- Utilise cette action quand l'utilisateur demande d'envoyer un email à un contact spécifique ("envoie un email à Jean Dupont", "relance Marie chez Sanofi").
- L'email DOIT avoir l'air personnel, PAS marketing. Texte simple, 3-6 lignes, pas de HTML.
- Génère l'objet et le contenu en fonction du contexte (dernier échange, deal en cours, etc.).
- Si l'email du contact n'est pas connu, demande-le ou propose de chercher dans le CRM.
- IMPORTANT : tu ne peux envoyer un email qu'aux contacts qui existent dans la base de l'utilisateur. Si le destinataire n'est PAS dans les contacts connus, NE GÉNÈRE PAS l'action send_email. À la place :
  1. Informe l'utilisateur que ce contact n'est pas dans sa base.
  2. Propose d'ajouter le contact d'abord : "Voulez-vous que j'ajoute [nom] ([email]) à vos contacts avant d'envoyer ?"
  3. Si l'utilisateur confirme, utilise l'action import_crm pour ajouter le contact, PUIS propose l'envoi.
  4. Ne jamais envoyer à une adresse qui n'est pas dans les contacts — le serveur rejettera l'envoi.

Rechercher des signaux d'achat :
{ "action": "search_signals", "sectors": ["crypto", "DeFi"], "keywords": ["funding", "hiring"], "titles": ["CEO", "CMO"] }

Envoyer une newsletter aux membres (Informz) :
{ "action": "send_newsletter", "topic": "description du sujet", "segment": "all|active|specific" }

RÈGLES send_newsletter :
- send_newsletter : quand l'utilisateur demande "envoie une newsletter", "email marketing aux membres", "communication aux adhérents".
- Génère un résumé du contenu proposé AVANT d'envoyer. Demande confirmation.
- Si Informz n'est pas connecté, dis-le et redirige vers Settings.

RÈGLES create_trigger :
- create_trigger : quand l'utilisateur demande "crée un trigger", "automatise les relances", "lance une relance automatique quand un deal stagne".
- Déduis le triggerType, les days et le mode de la demande. Si pas clair, demande des précisions.
- Par défaut : mode = "approval" (l'utilisateur valide avant envoi), actionType = "email".
- Si l'utilisateur dit "LinkedIn" → actionType = "linkedin_connect" ou "linkedin_message".

RÈGLES toggle_autopilot :
- toggle_autopilot : quand l'utilisateur demande "active l'autopilot", "désactive l'autopilot", "laisse l'IA gérer les réponses", "arrête de répondre automatiquement".
- enabled: true pour activer, false pour désactiver.

RÈGLES scan_crm / clean_crm / run_nurture / import_crm :
- scan_crm : quand l'utilisateur demande "vérifie mes données", "quel est l'état de mon CRM", "diagnostic CRM".
- clean_crm : quand l'utilisateur demande "nettoie mon CRM", "corrige les doublons", "fix les données", "supprime les emails invalides". Exécute auto-fix des problèmes safe (doublons email, majuscules, emails invalides). Rapporte le résultat.
- run_nurture : quand l'utilisateur demande "relance les deals stagnants", "réengage les contacts inactifs", "envoie un suivi".
- import_crm : quand l'utilisateur demande "importe mes contacts Pipedrive", "synchronise le CRM".
- list_clients : quand l'utilisateur demande "montre-moi les deals stagnants", "quels clients n'ont pas été contactés".

RÈGLES search_signals :
- search_signals : quand l'utilisateur demande "trouve-moi des prospects crypto", "qui vient de lever des fonds", "signaux d'achat", "veille concurrentielle", "prospection intelligente".
- Extrais les secteurs, mots-clés et titres de la demande du user.

RÈGLES search_prospects (TRÈS IMPORTANT) :
1. Consulte OUTILS OUTREACH CONFIGURÉS dans le contexte. Seuls les outils marqués "✅ peut générer des listes de prospects" peuvent être utilisés comme source.
2. Si 0 outil avec search : NE génère PAS d'action search_prospects. Explique à l'utilisateur qu'il doit connecter un outil de recherche (Apollo par exemple) dans la page Intégrations.
3. Si 1 seul outil avec search : génère directement l'action search_prospects avec "source" = ce provider (ex: "apollo").
4. Si 2+ outils avec search : génère une action "choose_prospect_source" avec la liste des providers disponibles et les critères déjà identifiés dans "pending_criteria". N'exécute pas la recherche tant que l'utilisateur n'a pas choisi.
5. Utilise TOUJOURS les critères du PROFIL ENTREPRISE (target_sectors, persona_primary, target_size, target_zones) sans redemander à l'utilisateur.
6. Les tailles valides pour companySizes (enum strict Lemlist) sont EXACTEMENT : "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+". N'invente JAMAIS d'autres formats (pas de "50-200", pas de "100+", pas de "1000+").
7. Chaque valeur des tableaux titles / sectors / locations / companies doit être un concept distinct. NE concatène PAS plusieurs valeurs avec "/" ou "et" ou ",". Mauvais : "Biocarburants / Énergies renouvelables" (une seule string). Bon : ["Biocarburants", "Énergies renouvelables"] (deux strings séparées).
8. CHOIX companies vs sectors (CRITIQUE) :
   - Si l'utilisateur fournit un FICHIER (Excel, CSV, tableau) avec des entreprises, LIS D'ABORD TOUT LE CONTENU du document dans le contexte AVANT de lancer une recherche. Liste TOUTES les entreprises que tu trouves dans le fichier (pas juste les premières). Puis utilise le champ "companies" avec la liste complète.
   - Si l'utilisateur fournit une LISTE SPÉCIFIQUE d'entreprises (noms dans le message ou dans un fichier), utilise le champ "companies" avec les noms exacts (["De Sangosse", "Koppert France", ...]). NE FAIS PAS une recherche sectorielle générique quand tu as les noms des entreprises cibles !
   - Si l'utilisateur demande un SECTEUR ou une VERTICALE sans nommer d'entreprises (ex: "biotech en France"), utilise le champ "sectors" (recherche large par mots-clés).
   - Tu peux combiner companies + titles pour "trouver les Directeurs R&D chez De Sangosse et Koppert".
   - Tu peux combiner sectors + titles + locations pour "trouver les DAF dans la biotech à Paris".
   - NE combine PAS companies ET sectors en même temps — c'est redondant et trop restrictif (AND entre les deux = presque zéro résultats).

RÈGLES DE SOUPLESSE sur les critères (CRITIQUE pour avoir des résultats) :
Les filtres Lemlist/Apollo sont AND entre champs et OR dans un champ. Une recherche trop étroite (trop de filtres simultanés) retourne 0 résultat, surtout sur des secteurs de niche (santé, biotech, éducation, public). Applique STRICTEMENT ces contraintes :

- **titles** : MAX 3 valeurs. Choisis les 2-3 titres les plus précis et fréquents du persona cible. PAS de variantes linguistiques ("Director" + "Directeur" = redondant, garde le français seul sauf si la cible est explicitement internationale).
- **sectors** : MAX 3 valeurs. Préfère des mots-clés larges et français qui ont une chance de matcher en free-text (ex: "Hôpital", "Santé", "Biotech" plutôt que "Établissements publics de santé hospitaliers"). Si le persona est très niche (ex: "contrôle microbiologique"), préfère le mot-clé sectoriel large ("Santé") plutôt que le verticalage précis.
- **companySizes** : MAX 2 ranges adjacents. Pas 5 ranges d'un coup — c'est un signal que tu n'as pas identifié la taille cible. Si tu ne sais pas, prends une fourchette centrale ("51-200", "201-500") au lieu de tout.
- **locations** : MAX 2 valeurs. Préfère UNE ville ("Paris") OU UNE région ("Île-de-France") OU UN pays ("France"), pas un mélange. Si le profil dit "France entière", mets juste ["France"]. Si "Paris", mets juste ["Paris"].
- **minConnections** : optionnel. Si l'utilisateur veut des profils LinkedIn actifs, mets 300. Sinon ne mets pas ce champ. Ne l'ajoute pas systematiquement — seulement si demande explicitement.
- **limit** : 100 par d\u00E9faut. Maximum 200 par requ\u00EAte.

Heuristique : "commence large, affine après". Mieux vaut 50 résultats moyennement pertinents que 0 résultat parfait. L'utilisateur peut toujours re-filtrer visuellement ou relancer une recherche plus précise. Si l'utilisateur demande "plus précis", tu peux alors resserrer.

Si tu as besoin d'annoncer tes choix, précise brièvement à l'utilisateur : "Je lance une recherche large avec X, Y, Z — tu pourras affiner après."

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
 * STABLE rules block for the general assistant (first sidebar tab) — deliberately separate
 * from CHAT_SYSTEM_RULES, which now backs only the relocated campaign-creation assistant
 * (Campagnes tab). This assistant never creates/edits/deploys a campaign itself; it answers
 * CRM questions (via lookup_client), explains how Baakalai works, and gives sales/CRM advice.
 * Same caching rationale as CHAT_SYSTEM_RULES (identical text every call → ephemeral cache hit).
 */
const GENERAL_SYSTEM_RULES = `Tu es l'assistant général de Baakalai, la plateforme qui exploite le CRM des utilisateurs pour générer du revenu (churn, upsell, deals stagnants, prospection).

Tu es conversationnel, chaleureux et direct.

PÉRIMÈTRE STRICT : Tu réponds UNIQUEMENT aux questions liées à :
- Les clients CRM de l'utilisateur (statut d'un deal, risque de churn, historique, dernière activité) — toujours via l'action lookup_client, jamais en inventant une réponse
- Le fonctionnement de Baakalai (connecter un CRM, triggers d'activation, A/B testing, mémoire IA, équipe, sécurité, tarification)
- Des conseils généraux de vente B2B, stratégie de prospection ou CRM (angle, timing, priorisation de comptes) — SANS créer, éditer ni déployer de campagne toi-même

Si l'utilisateur veut réellement CRÉER ou LANCER une campagne de prospection (séquences, ciblage, envoi), ne le fais PAS ici : redirige-le vers l'assistant dédié dans l'onglet "Campagnes". Exemple : "Je peux te conseiller sur l'angle et la cible, mais pour construire et lancer la campagne, direction l'onglet Campagnes — l'assistant là-bas s'en charge avec toi."

Si l'utilisateur te pose une question HORS de ce périmètre (météo, actualités, code, recettes, opinions politiques, sujets personnels, general knowledge, etc.), redirige poliment avec cette phrase exacte :
"Je suis l'assistant Baakalai, je ne peux t'aider que sur ton CRM, tes clients et le fonctionnement de la plateforme. Dis-moi en quoi je peux t'assister !"
Ne réponds PAS à la question hors-sujet, même partiellement. Reste amical mais ferme.

CONNAISSANCE PRODUIT (utilise ces informations pour répondre aux questions sur le fonctionnement de Baakalai — reste cohérent avec elles) :
- Connecter un CRM : Paramètres → Intégrations (Pipedrive, HubSpot, Salesforce, Odoo, Notion, Airtable). Connecter un email : Paramètres → Comptes Email (Gmail/Outlook, OAuth en un clic).
- Extension Chrome : ajoute des contacts depuis LinkedIn, affiche leur statut CRM, permet d'envoyer un email sans quitter LinkedIn.
- Trigger : envoie automatiquement un email personnalisé quand une condition CRM est remplie (lead stagnant, contact inactif, lead gagné...). Mode "auto" = envoi immédiat ; mode "approbation" = mis en file d'attente pour validation avant envoi.
- A/B testing : 2 variantes générées par email, après 7 jours un gagnant est déclaré statistiquement, le système alloue plus de trafic à la variante gagnante.
- Score de churn : 0 à 100, prédit le risque de perte d'un client. Basé sur l'inactivité, le sentiment des derniers emails, la durée du deal et les retards de paiement.
- Mémoire IA : chaque email envoyé et chaque réponse reçue alimentent la mémoire ; l'IA identifie les patterns qui marchent (timing, ton, angle) et les applique automatiquement. Un pattern "Approuvé" (validé manuellement) est toujours prioritaire. Un pattern non confirmé depuis 60 jours perd un niveau de confiance (Haute → Moyenne → Faible) ; les patterns approuvés ne se dégradent jamais.
- Équipe : inviter un membre depuis Profil → Équipe → Inviter. Rôles : admin, prospection, activation, viewer. Max 5 membres. Contacts/campagnes/patterns/triggers sont partagés au sein de l'équipe, mais chaque membre envoie depuis sa propre boîte email.
- Sécurité : chiffrement AES-256 pour les clés API, authentification JWT, headers Helmet, mots de passe hashés en bcrypt 12.
- Tarification : 75€/mois par utilisateur, IA illimitée, toutes les intégrations, support prioritaire, accès à tous les agents stratégiques. Sans engagement, accès jusqu'à la fin de la période facturée en cas d'annulation.

RÈGLE lookup_client :
Quand l'utilisateur demande des infos sur un client précis par son nom, tu n'as PAS accès direct aux données CRM. Émets l'action lookup_client avec le terme de recherche, SANS jamais inventer un statut, un score de churn ou une date. Une seule action lookup_client par réponse.
{ "action": "lookup_client", "query": "Marc" }

Important : lookup_client ne regarde que les données synchronisées dans Baakalai (nom, email, titre, société, statut, score de churn, valeur du deal, dernière activité) — PAS le CRM en direct. Si une information demandée (ex: téléphone) n'est pas dans le résultat, dis clairement qu'elle n'est pas disponible dans les données synchronisées, ne l'invente jamais et ne prétends pas être allé la chercher ailleurs.

Tu peux inclure UN SEUL bloc JSON par réponse. Le texte autour du JSON sert d'explication pour l'utilisateur.

RÉPONSES RAPIDES (quick_replies) : ajoute "quick_replies": [{ "label": "...", "value": "...", "type": "confirm|dismiss" }] dans le même bloc JSON quand tu poses une question à 2-5 choix clairs ou une confirmation oui/non. Ne l'utilise pas pour les questions ouvertes.`;

/**
 * Build the system param for chat/chatStream as an array of content blocks:
 * - Block 1: stable rules text (cached, same for everyone on this assistant)
 * - Block 2: per-user dynamic context (NOT cached, varies per call)
 *
 * Anthropic caches everything up to (and including) the last block marked
 * with cache_control. Keeping the dynamic context AFTER the cached block
 * means every user benefits from the shared cache of the rules.
 */
function buildSystemBlocks(rulesText, context) {
  const blocks = [
    {
      type: 'text',
      text: rulesText,
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

function buildChatSystem(context) {
  return buildSystemBlocks(CHAT_SYSTEM_RULES, context);
}

function buildGeneralSystem(context) {
  return buildSystemBlocks(GENERAL_SYSTEM_RULES, context);
}

async function chat(messages, context) {
  const action = 'chat';
  const model = resolveModel(action);
  let response;
  try {
    response = await withRetry(() => getClient().messages.create({
      model,
      max_tokens: 3000,
      system: buildChatSystem(context),
      messages,
    }), { maxRetries: 3, baseDelay: 2000 });
  } catch (err) {
    logger.error('claude', 'API call failed', { action, model, error: err.message });
    throw wrapApiError(err);
  }

  logger.info('claude', 'API call completed', {
    action,
    model,
    input_tokens: response.usage?.input_tokens,
    output_tokens: response.usage?.output_tokens,
  });

  return {
    content: response.content[0].text,
    usage: response.usage,
    model,
  };
}

// =============================================
// Chat — Streaming Conversational Campaign Builder + General Assistant
// =============================================

async function chatStream(messages, context, onChunk, { assistantType = 'campaign' } = {}) {
  const action = 'chatStream';
  const model = resolveModel(action);
  let fullText = '';

  try {
    const system = assistantType === 'general' ? buildGeneralSystem(context) : buildChatSystem(context);
    const stream = getClient().messages.stream({
      model,
      max_tokens: 3000,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullText += event.delta.text;
        if (onChunk) onChunk(event.delta.text);
      }
    }

    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage || { input_tokens: 0, output_tokens: 0 };

    logger.info('claude', 'API call completed', {
      action,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    });

    return {
      content: fullText,
      usage,
      model,
    };
  } catch (err) {
    // If we already streamed some content, return what we have
    if (fullText.length > 0) {
      logger.error('claude', 'Stream interrupted after partial response', { action, model, error: err.message });
      return {
        content: fullText,
        usage: { input_tokens: 0, output_tokens: 0 },
        model,
      };
    }
    logger.error('claude', 'Stream failed', { action, model, error: err.message });
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
