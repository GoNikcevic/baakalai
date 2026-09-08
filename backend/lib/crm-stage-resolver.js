/**
 * CRM Stage Resolver — rapatriement unifié des étapes de pipeline.
 *
 * Chaque CRM décrit son pipeline à sa façon : Pipedrive numérote ses étapes et
 * les groupe par pipeline, HubSpot les imbrique dans l'objet pipeline avec une
 * probabilité, Salesforce les expose comme un picklist global (OpportunityStage)
 * dont seul le libellé est reporté sur l'Opportunity, et Odoo les rattache à une
 * équipe commerciale plutôt qu'à un pipeline.
 *
 * Ce module ramène tout ça à une seule forme :
 *   { pipelineId, pipelineName, stageId, stageName, order, isWon, isClosed }
 *
 * et la persiste dans `crm_stages` (migration 079) pour que le reste du produit
 * n'ait plus jamais à connaître ces différences.
 *
 * Supporté : Pipedrive, HubSpot, Salesforce, Odoo.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Identifiants Odoo, en objet quel que soit le chemin d'appel.
 */
function odooCreds(credentials) {
  if (typeof credentials !== 'string') return credentials;
  try { return JSON.parse(credentials); } catch { return {}; }
}

/**
 * Interroge le CRM et renvoie ses étapes sous la forme normalisée.
 * Ne touche pas à la base — testable sans connexion.
 */
async function fetchStages(provider, credentials) {
  switch (provider) {
    case 'pipedrive': {
      const pipedrive = require('../api/pipedrive');
      // Deux appels : les étapes portent un pipeline_id mais pas son nom.
      const [pipelines, stages] = await Promise.all([
        pipedrive.getPipelines(credentials).catch(() => []),
        pipedrive.getStages(credentials),
      ]);
      const nameById = new Map((pipelines || []).map(p => [String(p.id), p.name]));
      return (stages || []).map(s => ({
        pipelineId: s.pipelineId != null ? String(s.pipelineId) : null,
        pipelineName: nameById.get(String(s.pipelineId)) || null,
        stageId: String(s.id),
        stageName: s.name || String(s.id),
        order: s.order ?? 0,
        // Pipedrive sépare l'étape du statut : aucune étape n'est « gagnée »,
        // c'est le champ status du deal qui porte won/lost.
        isWon: false,
        isClosed: false,
      }));
    }

    case 'hubspot': {
      const hubspot = require('../api/hubspot');
      const pipelines = await hubspot.getPipelines(credentials);
      const out = [];
      for (const pl of pipelines || []) {
        for (const s of pl.stages || []) {
          out.push({
            pipelineId: pl.id,
            pipelineName: pl.name,
            stageId: s.id,
            stageName: s.name,
            order: s.order ?? 0,
            isWon: !!s.isWon,
            isClosed: !!s.isClosed,
          });
        }
      }
      return out;
    }

    case 'salesforce': {
      const salesforce = require('../api/salesforce');
      const { instanceUrl, accessToken } = credentials || {};
      const stages = await salesforce.getStages(instanceUrl, accessToken);
      return (stages || []).map(s => ({
        // Salesforce n'a qu'un picklist global d'étapes : pas de pipeline.
        pipelineId: null,
        pipelineName: null,
        // Clé de jointure = le libellé, seul champ reporté sur l'Opportunity
        // (Opportunity.StageName). L'Id du OpportunityStage n'y apparaît jamais.
        stageId: s.name,
        stageName: s.name,
        order: s.order ?? 0,
        isWon: !!s.isWon,
        isClosed: !!s.isClosed,
      }));
    }

    case 'odoo': {
      const odoo = require('../api/odoo');
      // Selon le chemin d'appel, Odoo arrive soit en objet, soit en JSON
      // sérialisé (config.getUserKey renvoie la chaîne déchiffrée telle quelle).
      const stages = await odoo.getStages(odooCreds(credentials));
      return (stages || []).map(s => ({
        // Chez Odoo le « pipeline » est l'équipe commerciale (crm.team).
        pipelineId: s.teamId != null ? String(s.teamId) : null,
        pipelineName: s.teamName || null,
        stageId: String(s.id),
        stageName: s.name || String(s.id),
        order: s.order ?? 0,
        isWon: !!s.isWon,
        // Odoo ne marque que le gain : une étape gagnée est fermée, les autres
        // restent ouvertes (la perte se fait par `active = false`, pas par étape).
        isClosed: !!s.isWon,
      }));
    }

    default:
      return [];
  }
}

/**
 * Rapatrie les étapes du CRM et les enregistre pour cet utilisateur.
 * Renvoie une Map stageId → étape, prête à être appliquée aux deals.
 *
 * Les étapes disparues du CRM ne sont pas supprimées : des deals historiques
 * peuvent encore y pointer, et perdre le libellé rendrait leur affichage muet.
 */
async function syncStages(userId, provider, credentials) {
  const map = new Map();
  if (!provider || !credentials) return map;

  let stages = [];
  try {
    stages = await fetchStages(provider, credentials);
  } catch (err) {
    logger.warn('crm-stages', `${provider}: lecture des étapes impossible — ${err.message}`);
    return map;
  }

  for (const s of stages) {
    if (!s.stageId) continue;
    map.set(String(s.stageId), s);
    try {
      await db.query(
        `INSERT INTO crm_stages
           (user_id, crm_provider, pipeline_id, pipeline_name, stage_id, stage_name, display_order, is_won, is_closed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, crm_provider, stage_id) DO UPDATE SET
           pipeline_id = EXCLUDED.pipeline_id,
           pipeline_name = EXCLUDED.pipeline_name,
           stage_name = EXCLUDED.stage_name,
           display_order = EXCLUDED.display_order,
           is_won = EXCLUDED.is_won,
           is_closed = EXCLUDED.is_closed,
           updated_at = now()`,
        [userId, provider, s.pipelineId, s.pipelineName, String(s.stageId),
         s.stageName, s.order ?? 0, !!s.isWon, !!s.isClosed]
      );
    } catch (err) {
      logger.warn('crm-stages', `${provider}: étape ${s.stageId} non enregistrée — ${err.message}`);
    }
  }

  if (map.size > 0) {
    logger.info('crm-stages', `${provider}: ${map.size} étape(s) rapatriée(s) pour ${userId}`);
  }
  return map;
}

/**
 * Extrait l'identifiant d'étape d'un deal brut, quel que soit le connecteur.
 * Renvoie null si le CRM n'en expose pas (ex. Notion, Airtable).
 */
function extractStageId(provider, deal) {
  if (!deal) return null;
  switch (provider) {
    case 'salesforce':
      // Le libellé fait office d'identifiant — voir fetchStages.
      return deal.stageId || deal.stage || null;
    case 'pipedrive':
    case 'hubspot':
    case 'odoo': {
      const raw = deal.stageId ?? deal.stage;
      return raw == null || raw === '' ? null : String(raw);
    }
    default:
      return null;
  }
}

/**
 * Calcule les colonnes crm_stage_* à écrire sur une opportunité.
 * Renvoie un objet vide si l'étape n'a pas changé — pour que la synchro
 * quotidienne n'écrive rien tant que le deal ne bouge pas, et surtout pour que
 * `stage_changed_at` reste la vraie date d'entrée dans l'étape.
 *
 * @param {object} deal — deal brut du connecteur
 * @param {Map} stageMap — sortie de syncStages()
 * @param {object} existing — ligne opportunities actuelle
 */
function stageUpdates(provider, deal, stageMap, existing = {}) {
  const stageId = extractStageId(provider, deal);
  if (!stageId) return {};
  if (String(existing.crm_stage_id || '') === stageId) return {};

  const stage = stageMap?.get(stageId) || null;
  const updates = {
    crm_stage_id: stageId,
    // Sans référentiel (étape supprimée côté CRM, ou lecture des étapes en
    // échec), on garde l'identifiant plutôt qu'un libellé inventé.
    crm_stage_name: stage?.stageName || stageId,
    stage_changed_at: new Date().toISOString(),
  };
  if (stage) {
    updates.crm_pipeline_id = stage.pipelineId || null;
    updates.crm_pipeline_name = stage.pipelineName || null;
    updates.crm_stage_order = stage.order ?? 0;
  }
  return updates;
}

/**
 * Statut déduit de l'étape, pour les CRM qui n'en exposent pas.
 *
 * Odoo est le cas visé : son connecteur ne renvoie aucun champ statut, et le
 * gain n'est marqué que par le drapeau `is_won` de l'étape. Sans cette
 * déduction, aucun deal Odoo ne passe jamais « gagné », donc ni won_date, ni
 * attribution de réactivation, ni LTV.
 *
 * Renvoie null quand l'étape ne dit rien : on ne devine jamais une perte,
 * qu'Odoo n'exprime pas par l'étape mais par l'archivage du lead.
 */
function statusFromStage(stageMap, stageId) {
  if (!stageId) return null;
  const stage = stageMap?.get(String(stageId));
  return stage?.isWon ? 'won' : null;
}

module.exports = { fetchStages, syncStages, extractStageId, stageUpdates, statusFromStage, odooCreds };
