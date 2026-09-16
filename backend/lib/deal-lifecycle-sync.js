/**
 * Deal lifecycle sync · maps each CRM's native won/lost signal onto opportunities:
 * status, won_date/lost_date, deal_value, lost_reason, next activity, pipeline stage.
 *
 * Extracted from crm-agent's stepSync so the manual Settings sync (lib/crm-sync.js)
 * runs it too: before this, a fresh « Analyser le CRM » imported contacts but left
 * every status on 'imported' until the next 9AM cron · so a new user saw no clients
 * (won) anywhere, and staging (orchestrator off) never mapped them at all.
 *
 * Every provider's getDeals() is normalized to the same shape ({ personId,
 * status: 'won'|'lost'|'open', value, updatedAt }), so this loop treats them
 * identically · status is always taken from the CRM's own native won/lost signal
 * (Pipedrive/Odoo: deal/stage flag; Salesforce: IsWon/IsClosed; HubSpot:
 * hs_is_closed_won/hs_is_closed), authoritative regardless of the opportunity's
 * current status · a deal the CRM now shows as lost must stop being treated as a
 * client even if it was won before (manual correction in the CRM is the source of
 * truth).
 *
 * Best-effort: never throws · deal sync is optional on top of the contact sync.
 */

const db = require('../db');
const logger = require('./logger');

async function syncDealLifecycle(userId, token, crmProvider, report = {}) {
  const result = { processed: 0, updated: 0 };
  try {
    let deals = [];
    if (crmProvider === 'pipedrive') { const pipedrive = require('../api/pipedrive'); deals = await pipedrive.getDeals(token, 500); }
    else if (crmProvider === 'salesforce') { const sf = require('../api/salesforce'); deals = await sf.getDeals(token.instanceUrl, token.accessToken); }
    else if (crmProvider === 'hubspot') { const hs = require('../api/hubspot'); deals = await hs.getDeals(token); }
    else if (crmProvider === 'odoo') { const odooApi = require('../api/odoo'); deals = await odooApi.getDeals(token, { limit: 500 }); }

    // Étapes de pipeline (migration 092) : carte id → libellé résolue une fois
    // par sync pour les providers qui ne renvoient qu'un id d'étape.
    const { getStageLabelMap, extractStage, trackStage } = require('./stage-tracking');
    const stageLabelMap = await getStageLabelMap(crmProvider, token);

    // Prefer the CRM's own close date over "now" · "now" is only a fair proxy for a
    // transition happening in this very sync, never for backfilling an older won/lost deal.
    const safeDateISO = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };

    for (const deal of deals) {
      const personId = deal.personId ? String(deal.personId) : null;
      if (!personId) continue;

      const opp = await db.query(
        `SELECT id, status, won_date, lost_date, deal_value, planned_followup_date, last_activity_at, crm_stage, crm_stage_id, lost_reason FROM opportunities WHERE user_id = $1 AND crm_contact_id = $2 LIMIT 1`,
        [userId, personId]
      );
      if (!opp.rows[0]) continue;
      const o = opp.rows[0];
      result.processed++;

      const updates = {};
      if (deal.value && deal.value !== parseFloat(o.deal_value)) updates.deal_value = deal.value;

      const closeDate = safeDateISO(deal.closeDate);
      if (deal.status === 'won' && o.status !== 'won') {
        updates.status = 'won';
        updates.won_date = closeDate || new Date().toISOString();
      } else if (deal.status === 'won' && o.status === 'won' && !o.won_date && closeDate) {
        // Backfill: already won locally, just never got a real close date recorded.
        updates.won_date = closeDate;
      }
      if (deal.status === 'lost' && o.status !== 'lost') {
        updates.status = 'lost';
        updates.lost_date = closeDate || new Date().toISOString();
      } else if (deal.status === 'lost' && o.status === 'lost' && !o.lost_date && closeDate) {
        updates.lost_date = closeDate;
      }
      // Rapatrie la raison de perte native (Pipedrive) · jamais si une valeur
      // existe déjà (CRM ou saisie manuelle), pour ne jamais écraser une
      // correction humaine par une resynchro.
      if (deal.lostReason && !o.lost_reason) {
        updates.lost_reason = deal.lostReason;
        updates.lost_reason_source = 'crm';
      }
      // Pipedrive's native "next activity" date feeds planned_followup_date · never overwrite
      // a manually-set date with null (Pipedrive is the only provider that returns this today).
      if (deal.nextActivityDate && deal.nextActivityDate !== o.planned_followup_date) {
        updates.planned_followup_date = deal.nextActivityDate;
        updates.planned_followup_reason = 'crm_sync';
      }
      // The CRM's own "last modified" timestamp is the real activity signal · `updated_at`
      // gets reset to now() by a DB trigger on every internal write (e.g. churn scoring),
      // so it can't be trusted for staleness. Only advance last_activity_at forward, never back.
      if (deal.updatedAt) {
        const crmUpdated = new Date(deal.updatedAt);
        const stored = o.last_activity_at ? new Date(o.last_activity_at) : null;
        if (!isNaN(crmUpdated.getTime()) && (!stored || crmUpdated > stored)) {
          updates.last_activity_at = crmUpdated.toISOString();
        }
      }

      // Étape de pipeline réelle : transition historisée quand l'id change,
      // simple rafraîchissement de libellé sinon (renommage côté CRM).
      try {
        const stageUpdates = await trackStage(
          userId, o, extractStage(crmProvider, deal, stageLabelMap),
          { status: deal.status, source: 'delta_sync' }
        );
        Object.assign(updates, stageUpdates);
      } catch { /* stage tracking best-effort */ }

      if (Object.keys(updates).length > 0) {
        // Attribution: if deal moves to 'won' from lost/stagnant, check for reactivation email in last 90 days
        if (updates.status === 'won' && ['lost', 'stagnant', 'imported', 'new'].includes(o.status)) {
          const reactivationEmail = await db.query(
            `SELECT id, pattern_ids FROM nurture_emails
             WHERE opportunity_id = $1 AND user_id = $2 AND status = 'sent'
               AND metadata->>'chain' = 'deal_reactivation'
               AND created_at > NOW() - INTERVAL '90 days'
             ORDER BY created_at DESC LIMIT 1`,
            [o.id, userId]
          );
          if (reactivationEmail.rows[0]) {
            updates.reactivated_at = new Date().toISOString();
            updates.reactivated_from_email_id = reactivationEmail.rows[0].id;
            report.reactivations = (report.reactivations || 0) + 1;
            logger.info('deal-lifecycle-sync', `Deal reactivated: ${o.id} (email ${reactivationEmail.rows[0].id})`);

            // Renforcement de la boucle d'apprentissage : deal mort → gagné
            // avec email causal identifié, c'est LE signal le plus fort du
            // produit. Les patterns utilisés pour rédiger cet email gagnent
            // une confirmation. Best-effort : ne doit jamais faire échouer
            // le sync.
            const causalPatternIds = reactivationEmail.rows[0].pattern_ids || [];
            if (causalPatternIds.length > 0) {
              try {
                await db.query(
                  `UPDATE memory_patterns
                   SET confirmations = COALESCE(confirmations, 0) + 1, last_confirmed_at = now()
                   WHERE id = ANY($1)`,
                  [causalPatternIds]
                );
                logger.info('deal-lifecycle-sync', `Reactivation win: +1 confirmation on ${causalPatternIds.length} pattern(s)`);
              } catch (err) {
                logger.warn('deal-lifecycle-sync', `Pattern reinforcement failed: ${err.message}`);
              }
            }
          }
        }
        await db.opportunities.update(o.id, updates);
        result.updated++;
      }
    }
  } catch (err) {
    // Avant l'extraction ce catch était muet · c'est précisément ce qui rendait
    // les échecs de mapping won/lost invisibles. On trace, sans faire échouer.
    logger.warn('deal-lifecycle-sync', `${crmProvider} deal sync failed for user ${userId}: ${err.message}`);
  }
  return result;
}

module.exports = { syncDealLifecycle };
