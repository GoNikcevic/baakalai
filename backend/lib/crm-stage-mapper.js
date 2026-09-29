/**
 * CRM Stage Mapper · ce que baakalai comprend du pipeline du user.
 *
 * Le produit lisait les étapes du CRM sans jamais les traduire. `crm_stage` et
 * `crm_stage_id` sont recopiés tels quels sur chaque opportunité, Analytics
 * groupe le tunnel sur ces libellés, et la Vue globale Deals affichait une
 * tuile par étape : seize intitulés maison sur un Salesforce standard, que
 * baakalai relayait sans savoir lesquels voulaient dire « on négocie ».
 *
 * Ce module fait la traduction, une fois par analyse CRM, vers les statuts que
 * le reste du produit sait déjà lire (`opportunities.status`).
 *
 * ── Deux sources, dans cet ordre ────────────────────────────────────────────
 *
 * 1. RÈGLES · les quatre CRM structurés disent eux-mêmes quelles étapes sont
 *    terminales, et c'est une donnée, pas une interprétation :
 *      salesforce · OpportunityStage.IsWon / IsClosed
 *      hubspot    · metadata.probability = 1 / metadata.isClosed
 *      odoo       · crm.stage.is_won
 *      pipedrive  · rien · gagné/perdu y est un statut de DEAL, pas une étape
 *    Demander à un modèle ce que l'API affirme serait payer pour moins sûr.
 *
 * 2. CLAUDE · les étapes intermédiaires, que rien ne permet de déduire
 *    mécaniquement. « Analyse de la perception » est-ce un RDV ou une négo ?
 *    Aucune heuristique par mot-clé ne tient la route d'un CRM à l'autre, ni
 *    d'une langue à l'autre.
 *
 * ── Ce que le mappage a le droit de faire ───────────────────────────────────
 *
 * Il ne renseigne QUE les statuts ouverts (interested, meeting, negotiation).
 * Gagné et perdu restent la propriété de lib/deal-lifecycle-sync.js, qui les
 * tire des drapeaux natifs du deal (IsWon, hs_is_closed_won...), autrement
 * plus fiables que l'étape où le deal se trouve. Deux écritures concurrentes
 * sur le même champ finiraient par se contredire ; celle-ci est donc
 * strictement additive : elle donne du grain là où baakalai n'en avait aucun
 * (tout restait sur 'imported'), sans jamais toucher à un dénouement.
 *
 * Une ligne corrigée à la main (source = 'user') n'est jamais réécrite : sans
 * ça, la correction sauterait à l'analyse suivante et le user n'aurait aucun
 * moyen de la faire tenir.
 */

const db = require('../db');
const logger = require('./logger');
const { safeParseClaudeJSON } = require('./utils/safe-json-parse');

/** Statuts atteignables depuis une étape de pipeline. 'new' et 'imported' en
 *  sont absents : ils disent d'où vient un contact, pas où il en est. */
const CANONICAL_STATUSES = ['interested', 'meeting', 'negotiation', 'won', 'lost'];

/** Statuts que ce module a le droit d'écrire sur une opportunité. */
const OPEN_STATUSES = ['interested', 'meeting', 'negotiation'];

/** CRM dont l'étape de pipeline est une notion structurée. Notion, Airtable et
 *  Folk n'ont qu'une propriété texte libre, sans ordre : rien à mapper. */
const WITH_PIPELINE = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];

/**
 * Étapes du pipeline d'un user, normalisées pour les quatre CRM.
 *
 * ATTENTION · `id` doit être exactement ce que lib/stage-tracking.js écrit
 * dans opportunities.crm_stage_id, sinon le rapprochement échoue en silence :
 *   pipedrive / odoo · identifiant numérique de l'étape
 *   hubspot          · id interne de dealstage ("appointmentscheduled")
 *   salesforce       · le LIBELLÉ (StageName), pas l'Id du OpportunityStage
 *
 * @returns {Promise<Array<{id, name, order, pipelineId, pipelineName, isWon, isClosed}>>}
 */
async function fetchPipelineStages(provider, creds) {
  if (!provider || !WITH_PIPELINE.includes(provider) || !creds) return [];

  if (provider === 'pipedrive') {
    const pipedrive = require('../api/pipedrive');
    // Sans pipelineId, Pipedrive renvoie les étapes de TOUS les pipelines.
    const [pipelines, raw] = await Promise.all([
      pipedrive.getPipelines(creds).catch(() => []),
      pipedrive.getStages(creds),
    ]);
    const names = new Map((pipelines || []).map(p => [String(p.id), p.name]));
    return (raw || []).map(st => ({
      id: String(st.id),
      name: st.name,
      order: st.order ?? 0,
      pipelineId: st.pipelineId != null ? String(st.pipelineId) : null,
      pipelineName: names.get(String(st.pipelineId)) || null,
      // Chez Pipedrive, gagné et perdu sont un statut de deal, jamais une
      // étape : aucune étape n'est terminale, toutes passent par Claude.
      isWon: false,
      isClosed: false,
    }));
  }

  if (provider === 'hubspot') {
    const hubspot = require('../api/hubspot');
    const pipelines = await hubspot.getDealPipelines(creds);
    const out = [];
    for (const pl of pipelines || []) {
      for (const st of pl.stages || []) {
        out.push({
          id: String(st.id), name: st.name, order: st.order ?? 0,
          pipelineId: pl.id, pipelineName: pl.name,
          isWon: !!st.won, isClosed: !!st.closed,
        });
      }
    }
    return out;
  }

  if (provider === 'salesforce') {
    const salesforce = require('../api/salesforce');
    const raw = await salesforce.getStages(creds.instanceUrl, creds.accessToken);
    return (raw || []).map(st => ({
      // Le libellé fait office d'id : l'Opportunity ne porte que StageName.
      id: st.name, name: st.name, order: st.order ?? 0,
      pipelineId: null, pipelineName: null,
      isWon: !!st.isWon, isClosed: !!st.isClosed,
    }));
  }

  // odoo
  const odoo = require('../api/odoo');
  let parsed = creds;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  const raw = await odoo.getStages(parsed);
  return (raw || []).map(st => ({
    id: String(st.id), name: st.name, order: st.order ?? 0,
    pipelineId: null, pipelineName: null,
    // Odoo ne marque que l'étape gagnée · le perdu y est un motif de perte
    // posé sur le lead, pas une étape.
    isWon: !!st.isWon, isClosed: !!st.isWon,
  }));
}

/**
 * Statut déduit des seuls drapeaux du CRM, ou null quand il n'en donne pas.
 * Une étape fermée sans être gagnée est perdue : c'est ce que les quatre
 * connecteurs entendent par là.
 */
function ruleStatus(stage) {
  if (stage.isWon) return 'won';
  if (stage.isClosed) return 'lost';
  return null;
}

/**
 * Classe les étapes ouvertes dans le modèle baakalai via Claude.
 *
 * Un seul appel pour tout le pipeline : les étapes se comprennent les unes par
 * rapport aux autres (« Proposition » ne veut pas dire la même chose selon
 * qu'elle précède ou suit « Négociation »), les classer une par une perdrait
 * justement ce qui permet de trancher.
 *
 * Best-effort : un échec laisse les étapes non mappées plutôt que de faire
 * tomber l'analyse CRM.
 *
 * @returns {Promise<Map<string, {status, confidence, reasoning}>>} clé = id d'étape
 */
async function classifyOpenStages(provider, stages) {
  const out = new Map();
  if (stages.length === 0) return out;

  const claude = require('../api/claude');
  const listing = stages.map(s => ({
    id: s.id,
    name: s.name,
    order: s.order,
    ...(s.pipelineName ? { pipeline: s.pipelineName } : {}),
  }));

  const system = 'Tu analyses la structure d\'un pipeline CRM. Réponds UNIQUEMENT en JSON valide.';
  const prompt = `Voici les étapes ouvertes du pipeline ${provider} d'une équipe commerciale B2B, dans leur ordre natif.

${JSON.stringify(listing, null, 2)}

Range chaque étape dans l'un de ces trois statuts :
  interested  · le prospect est identifié ou qualifié, la conversation commence, rien n'est encore engagé
  meeting     · un échange de fond a lieu ou est prévu (découverte, démo, analyse du besoin, cadrage)
  negotiation · une proposition chiffrée circule (devis, contrat, décision, négociation des termes)

Règles :
- l'ordre natif est un indice fort, un pipeline progresse rarement à l'envers, mais il ne fait pas foi à lui seul
- les intitulés peuvent être dans n'importe quelle langue, ou propres au métier de l'équipe
- une étape d'attente ou de mise en veille garde le statut de l'étape qui la précède
- confidence entre 0 et 1 · descends sous 0.6 quand l'intitulé est vraiment ambigu, c'est ce qui dira au user quoi relire
- reason : une phrase courte, en français, qui dit pourquoi

Retourne :
{
  "stages": [
    { "id": "...", "status": "interested|meeting|negotiation", "confidence": 0.0, "reason": "..." }
  ]
}`;

  try {
    const result = await claude.callClaude(system, prompt, 2000, 'crm_stage_mapping');
    const parsed = safeParseClaudeJSON(result, 'stages');
    for (const row of parsed?.stages || []) {
      if (!row?.id || !OPEN_STATUSES.includes(row.status)) continue;
      const confidence = Number(row.confidence);
      out.set(String(row.id), {
        status: row.status,
        // Une confiance absente ou illisible ne doit pas se lire comme une
        // certitude : on ne suppose rien, on laisse le champ vide.
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
        reasoning: typeof row.reason === 'string' ? row.reason.slice(0, 500) : null,
      });
    }
  } catch (err) {
    logger.warn('crm-stage-mapper', `Classification failed (${provider}): ${err.message}`);
  }
  return out;
}

/**
 * Lit le pipeline du CRM, en déduit le mappage et le persiste.
 *
 * @param {string} userId
 * @param {object} [opts]
 * @param {string} [opts.provider] · évite un second resolveCrmForUser quand l'appelant l'a déjà
 * @param {object} [opts.creds]
 * @returns {Promise<{provider, stages: number, byRule: number, byAi: number, kept: number}>}
 */
async function analyzeStageArchitecture(userId, opts = {}) {
  const report = { provider: null, stages: 0, byRule: 0, byAi: 0, kept: 0 };
  try {
    let { provider, creds } = opts;
    if (!provider || !creds) {
      const { resolveCrmForUser } = require('./crm-token');
      ({ provider, creds } = await resolveCrmForUser(userId));
    }
    if (!provider || !WITH_PIPELINE.includes(provider) || !creds) return report;
    report.provider = provider;

    const stages = await fetchPipelineStages(provider, creds);
    report.stages = stages.length;
    if (stages.length === 0) return report;

    // Ce que le user a corrigé à la main reste tel quel, et sort du périmètre
    // avant même l'appel à Claude : inutile de payer pour une réponse qu'on
    // jettera.
    const existing = await db.query(
      `SELECT pipeline_id, crm_stage_id, source FROM crm_stage_mappings
       WHERE user_id = $1 AND crm_provider = $2`,
      [userId, provider]
    );
    const frozen = new Set(
      existing.rows.filter(r => r.source === 'user')
        .map(r => `${r.pipeline_id || ''}::${r.crm_stage_id}`)
    );

    const pending = stages.filter(s => !frozen.has(`${s.pipelineId || ''}::${s.id}`));
    report.kept = stages.length - pending.length;

    const byRule = new Map();
    const needsAi = [];
    for (const stage of pending) {
      const status = ruleStatus(stage);
      if (status) byRule.set(stage.id, status);
      else needsAi.push(stage);
    }

    const byAi = await classifyOpenStages(provider, needsAi);

    for (const stage of pending) {
      const ruled = byRule.get(stage.id);
      const guessed = byAi.get(String(stage.id));
      let row;
      if (ruled) {
        row = { status: ruled, source: 'rule', confidence: 1, reasoning: null };
      } else if (guessed) {
        row = { status: guessed.status, source: 'ai', confidence: guessed.confidence, reasoning: guessed.reasoning };
      } else {
        // Ni règle ni déduction : on n'écrit rien plutôt que d'inventer un
        // statut. Une étape absente de la table est simplement « pas encore
        // comprise », l'écran de relecture la montre comme telle.
        continue;
      }

      await db.query(
        `INSERT INTO crm_stage_mappings
           (user_id, crm_provider, pipeline_id, pipeline_name, crm_stage_id, crm_stage_name,
            stage_order, baakalai_status, source, confidence, reasoning)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, crm_provider, COALESCE(pipeline_id, ''), crm_stage_id)
         DO UPDATE SET
           pipeline_name = EXCLUDED.pipeline_name,
           crm_stage_name = EXCLUDED.crm_stage_name,
           stage_order = EXCLUDED.stage_order,
           baakalai_status = EXCLUDED.baakalai_status,
           source = EXCLUDED.source,
           confidence = EXCLUDED.confidence,
           reasoning = EXCLUDED.reasoning,
           updated_at = now()`,
        [userId, provider, stage.pipelineId, stage.pipelineName, String(stage.id), stage.name,
         stage.order ?? null, row.status, row.source, row.confidence, row.reasoning]
      );
      if (row.source === 'rule') report.byRule++; else report.byAi++;
    }

    logger.info('crm-stage-mapper',
      `${provider} · ${report.stages} étapes, ${report.byRule} par règle, ${report.byAi} par Claude, ${report.kept} laissées au user`);
  } catch (err) {
    logger.warn('crm-stage-mapper', `Analyse échouée pour ${userId}: ${err.message}`);
  }
  return report;
}

/**
 * Applique le mappage aux opportunités déjà synchronisées.
 *
 * Seuls les statuts ouverts sont écrits, et jamais par-dessus un dénouement :
 * voir l'en-tête du module. Un deal sans crm_stage_id n'est pas touché · son
 * étape est inconnue, pas neutre.
 *
 * @returns {Promise<{updated: number}>}
 */
async function applyStageMapping(userId, provider) {
  try {
    if (!provider || !WITH_PIPELINE.includes(provider)) return { updated: 0 };
    const result = await db.query(
      `UPDATE opportunities o
          SET status = m.baakalai_status, updated_at = now()
         FROM crm_stage_mappings m
        WHERE m.user_id = $1
          AND m.crm_provider = $2
          AND o.user_id = m.user_id
          AND o.crm_provider = m.crm_provider
          AND o.crm_stage_id = m.crm_stage_id
          AND m.baakalai_status = ANY($3)
          AND o.status <> m.baakalai_status
          AND o.status NOT IN ('won', 'lost')`,
      [userId, provider, OPEN_STATUSES]
    );
    if (result.rowCount > 0) {
      logger.info('crm-stage-mapper', `${result.rowCount} opportunité(s) repositionnée(s) pour ${userId}`);
    }
    return { updated: result.rowCount || 0 };
  } catch (err) {
    logger.warn('crm-stage-mapper', `Application échouée pour ${userId}: ${err.message}`);
    return { updated: 0 };
  }
}

/** Le mappage tel qu'il est stocké, ordonné comme le pipeline du user. */
async function getStageMappings(userId, provider) {
  const result = await db.query(
    `SELECT id, crm_provider, pipeline_id, pipeline_name, crm_stage_id, crm_stage_name,
            stage_order, baakalai_status, source, confidence, reasoning, updated_at
       FROM crm_stage_mappings
      WHERE user_id = $1 AND ($2::text IS NULL OR crm_provider = $2)
      ORDER BY COALESCE(pipeline_name, ''), stage_order NULLS LAST, crm_stage_name`,
    [userId, provider || null]
  );
  return result.rows;
}

/**
 * Correction manuelle. Passe la ligne en source 'user', ce qui la met hors de
 * portée des analyses suivantes.
 */
async function setStageMapping(userId, mappingId, status) {
  if (!CANONICAL_STATUSES.includes(status)) {
    throw new Error(`Statut inconnu : ${status}`);
  }
  const result = await db.query(
    `UPDATE crm_stage_mappings
        SET baakalai_status = $3, source = 'user', confidence = 1, reasoning = NULL, updated_at = now()
      WHERE id = $2 AND user_id = $1
      RETURNING *`,
    [userId, mappingId, status]
  );
  return result.rows[0] || null;
}

module.exports = {
  CANONICAL_STATUSES,
  OPEN_STATUSES,
  WITH_PIPELINE,
  fetchPipelineStages,
  ruleStatus,
  // Exporté pour pouvoir rejouer le classement sur un pipeline réel sans
  // écrire en base · c'est la seule partie du module qu'on ne peut pas juger
  // sur du code, seulement sur ce qu'elle rend.
  classifyOpenStages,
  analyzeStageArchitecture,
  applyStageMapping,
  getStageMappings,
  setStageMapping,
};
