/**
 * Routage modèle par tâche.
 *
 * Trois niveaux de surcharge, du plus spécifique au plus général :
 *
 *   1. CLAUDE_MODEL_<ACTION>   — surcharge une action précise.
 *                                ex: CLAUDE_MODEL_DEAL_COACH=claude-opus-5
 *   2. CLAUDE_TIER_<TIER>      — surcharge tout un palier.
 *                                ex: CLAUDE_TIER_BALANCED=claude-sonnet-5
 *   3. defaults ci-dessous     — le palier déclaré par l'action.
 *
 * `CLAUDE_MODEL` reste supporté comme défaut global (rétrocompatibilité) et,
 * s'il contient "opus", conserve son comportement historique de surcharge
 * globale — c'est le commutateur du panneau Settings.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AVANT DE PASSER EN GÉNÉRATION 5 (claude-sonnet-5 / claude-opus-5)
 *
 * Sur ces modèles la réflexion (« thinking ») est ACTIVE PAR DÉFAUT quand le
 * paramètre est omis, alors qu'elle était inactive sur Sonnet 4.6 / Opus 4.8.
 * Or `max_tokens` plafonne la réflexion ET la réponse ensemble : une action à
 * `max_tokens: 300` se ferait tronquer au milieu.
 *
 * C'est pourquoi chaque action à sortie courte déclare ici `thinking: 'disabled'`.
 * Aujourd'hui c'est un no-op (les modèles 4.x ne pensent pas sans qu'on le
 * demande) ; au moment de la bascule, c'est ce qui évite la régression.
 *
 * Second point : Sonnet 5 utilise un tokenizer différent (~30 % de tokens en
 * plus pour le même texte). Re-mesurer avec count_tokens avant d'ajuster les
 * budgets, ne pas appliquer un facteur au jugé.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Paliers. Changer un palier ici reroute toutes les actions qui s'en réclament. */
const TIERS = {
  // Sorties courtes et mécaniques, gros volume.
  fast:     process.env.CLAUDE_TIER_FAST     || 'claude-haiku-4-5',
  // Génération et analyse courantes — le gros du produit.
  balanced: process.env.CLAUDE_TIER_BALANCED || 'claude-sonnet-4-6',
  // Raisonnement lourd, faible volume.
  deep:     process.env.CLAUDE_TIER_DEEP     || process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-8',
};

/**
 * Une entrée par action passée à callClaude(..., action).
 *   tier     — palier (fast | balanced | deep)
 *   thinking — 'disabled' pour les sorties courtes (voir avertissement ci-dessus)
 *
 * Toute action absente de cette table retombe sur DEFAULT_TIER : la table doit
 * donc rester exhaustive pour que le routage soit réel. `listUnrouted()` en bas
 * sert à vérifier qu'on n'a rien oublié.
 */
const ACTIONS = {
  // ---- Génération de séquences et de campagnes ----
  generateSequence:        { tier: 'balanced' },
  generateTouchpoint:      { tier: 'balanced' },
  generateVariables:       { tier: 'balanced', thinking: 'disabled' },
  regenerateSequence:      { tier: 'deep' },
  analyzeCampaign:         { tier: 'balanced' },

  // ---- Chat ----
  chat:                    { tier: 'balanced' },
  chatStream:              { tier: 'balanced' },
  chat_reactivation:       { tier: 'balanced' },

  // ---- Mémoire ----
  consolidateMemory:       { tier: 'deep' },
  template_generation:     { tier: 'balanced' },

  // ---- Agents stratégiques ----
  deal_coach:              { tier: 'balanced', thinking: 'disabled' },
  copy_optimizer:          { tier: 'balanced' },
  icp_refiner:             { tier: 'deep' },
  win_loss_analysis:       { tier: 'deep' },
  competitor_watch:        { tier: 'deep' },
  analyzeICP:              { tier: 'balanced' },

  // ---- Chaînes autonomes ----
  chain_deal_reactivation: { tier: 'balanced', thinking: 'disabled' },
  chain_auto_upsell:       { tier: 'balanced', thinking: 'disabled' },

  // ---- Nurture et conversation ----
  nurture_email:           { tier: 'balanced', thinking: 'disabled' },
  nurture_linkedin:        { tier: 'fast',     thinking: 'disabled' },
  conversation_autopilot:  { tier: 'balanced', thinking: 'disabled' },
  response_analysis:       { tier: 'balanced', thinking: 'disabled' },

  // ---- Signaux et LinkedIn ----
  signal_extraction:       { tier: 'balanced' },
  signal_outreach:         { tier: 'fast',     thinking: 'disabled' },
  linkedin_note:           { tier: 'fast',     thinking: 'disabled' },
  linkedin_followup:       { tier: 'fast',     thinking: 'disabled' },

  // ---- Enrichissement et prospection ----
  generateIcebreaker:      { tier: 'deep' },
  personalization:         { tier: 'fast',     thinking: 'disabled' },
  enrichment:              { tier: 'fast',     thinking: 'disabled' },
  web_search_prospects:    { tier: 'fast' },

  // Extraction depuis des snippets de recherche web : tâches purement
  // mécaniques, sorties courtes et structurées. Ces quatre actions appelaient
  // le SDK en direct sur un modèle codé en dur — donc hors routage, hors
  // timeout, hors retry et absentes de llm_usage.
  personalization_icebreaker: { tier: 'fast', thinking: 'disabled' },
  enrich_company_from_web:    { tier: 'fast', thinking: 'disabled' },
  enrich_contact_from_web:    { tier: 'fast', thinking: 'disabled' },
  web_prospect_parse:         { tier: 'fast', thinking: 'disabled' },

  // ---- Analyse de synchronisation CRM ----
  sync_analysis:           { tier: 'balanced' },

  // ---- Chat analytique (page Analytics) ----
  analytics_ask:           { tier: 'balanced', thinking: 'disabled' },

  // ---- Playbook à la demande (page Mémoire) ----
  playbook_generation:     { tier: 'deep' },

  // ---- Newsletter ----
  newsletter:              { tier: 'balanced' },
  newsletter_content:      { tier: 'balanced' },
};

const DEFAULT_TIER = 'balanced';

/** ACTION_NAME → CLAUDE_MODEL_ACTION_NAME */
function envKeyFor(action) {
  return 'CLAUDE_MODEL_' + String(action)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/**
 * Modèle à utiliser pour une action.
 * @param {string} [action]
 * @returns {string} identifiant de modèle
 */
function modelFor(action) {
  if (action) {
    const override = process.env[envKeyFor(action)];
    if (override) return override;
  }
  const entry = action ? ACTIONS[action] : null;
  return TIERS[entry?.tier || DEFAULT_TIER] || TIERS[DEFAULT_TIER];
}

/**
 * Paramètre `thinking` à passer à l'API pour une action, ou null si aucun.
 * Émis uniquement quand l'action le déclare — on ne change pas le comportement
 * des actions qui n'en demandent pas.
 */
function thinkingFor(action) {
  const entry = action ? ACTIONS[action] : null;
  if (entry?.thinking === 'disabled') return { type: 'disabled' };
  if (entry?.thinking === 'adaptive') return { type: 'adaptive' };
  return null;
}

/** Table de routage résolue — pour le debug et un futur endpoint d'admin. */
function describeRouting() {
  return Object.fromEntries(
    Object.keys(ACTIONS).sort().map(a => [a, { model: modelFor(a), tier: ACTIONS[a].tier }])
  );
}

/** Actions appelées dans le code mais absentes de la table (garde-fou de test). */
function listUnrouted(usedActions = []) {
  return usedActions.filter(a => a && !ACTIONS[a]);
}

module.exports = { TIERS, ACTIONS, DEFAULT_TIER, modelFor, thinkingFor, describeRouting, listUnrouted, envKeyFor };
