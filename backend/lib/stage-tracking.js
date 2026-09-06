/**
 * Stage Tracking — rapatriement des étapes de pipeline CRM (migration 092).
 *
 * Chaque provider expose l'étape sur ses deals mais sous une forme différente :
 *   - Pipedrive : stage_id numérique (libellé via GET /stages)
 *   - HubSpot   : id interne dealstage (libellé via /crm/v3/pipelines/deals)
 *   - Salesforce: StageName = déjà le libellé
 *   - Odoo      : stage_id [id, libellé] — les deux sont déjà là
 *
 * On mappe par ID natif quand il existe (stable au renommage d'étape) et on
 * n'enregistre une transition que quand l'ID change — un simple renommage met
 * à jour le libellé sans polluer l'historique.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Carte id d'étape → libellé pour les providers qui ne renvoient qu'un id.
 * Retourne null pour les providers dont les deals portent déjà le libellé.
 * Best-effort : une erreur API rend une carte vide, jamais une exception.
 */
async function getStageLabelMap(provider, creds) {
  try {
    if (provider === 'pipedrive') {
      const pipedrive = require('../api/pipedrive');
      const stages = await pipedrive.getStages(creds);
      return new Map(stages.map(s => [String(s.id), s.name]));
    }
    if (provider === 'hubspot') {
      const hubspot = require('../api/hubspot');
      return await hubspot.getDealStageLabels(creds);
    }
  } catch (err) {
    logger.warn('stage-tracking', `Stage label map failed (${provider}): ${err.message}`);
    return new Map();
  }
  return null; // salesforce / odoo : libellé déjà sur le deal
}

/**
 * Normalise (stageId, stageLabel) d'un deal getDeals() selon le provider.
 */
function extractStage(provider, deal, labelMap) {
  if (provider === 'pipedrive') {
    const id = deal.stage != null ? String(deal.stage) : null;
    if (!id) return { stageId: null, stageLabel: null };
    return { stageId: id, stageLabel: labelMap?.get(id) || `Stage ${id}` };
  }
  if (provider === 'hubspot') {
    const id = deal.stage ? String(deal.stage) : null;
    if (!id) return { stageId: null, stageLabel: null };
    return { stageId: id, stageLabel: labelMap?.get(id) || id };
  }
  if (provider === 'odoo') {
    return {
      stageId: deal.stageId != null ? String(deal.stageId) : null,
      stageLabel: deal.stage || null,
    };
  }
  // salesforce (et défaut) : StageName est le libellé, il sert aussi d'id
  const label = deal.stage || null;
  return { stageId: label, stageLabel: label };
}

/**
 * Compare l'étape observée avec celle stockée sur l'opportunité et, si elle a
 * changé, insère la transition dans opportunity_stage_history.
 *
 * @param {object} opp — ligne opportunities avec au moins { id, crm_stage, crm_stage_id }
 * @returns {object} updates à fusionner dans db.opportunities.update (vide si rien)
 */
async function trackStage(userId, opp, { stageId, stageLabel }, { status = null, source = 'delta_sync' } = {}) {
  if (!stageLabel) return {};

  const sameId = stageId != null && opp.crm_stage_id != null && String(opp.crm_stage_id) === String(stageId);
  const sameLabel = opp.crm_stage === stageLabel;
  if (sameId && sameLabel) return {};

  const updates = { crm_stage: stageLabel, crm_stage_id: stageId };

  // Renommage d'étape (même id, autre libellé) : on rafraîchit sans transition.
  if (sameId && !sameLabel) return updates;

  updates.crm_stage_changed_at = new Date().toISOString();
  try {
    await db.query(
      `INSERT INTO opportunity_stage_history
         (user_id, opportunity_id, from_stage, from_stage_id, to_stage, to_stage_id, deal_status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, opp.id, opp.crm_stage || null, opp.crm_stage_id || null, stageLabel, stageId, status, source]
    );
  } catch (err) {
    logger.warn('stage-tracking', `History insert failed for opp ${opp.id}: ${err.message}`);
  }
  return updates;
}

module.exports = { getStageLabelMap, extractStage, trackStage };
