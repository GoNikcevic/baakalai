/**
 * CRM Bidirectional Sync
 *
 * Pipedrive → Baakalai: import new contacts, update existing ones
 * Baakalai → Pipedrive: push status changes, scores, notes
 *
 * Runs as a cron job (daily after nurture engine).
 */

const db = require('../db');
const { getUserKey } = require('../config');
const { getUserCrmToken } = require('./crm-token');
const pipedrive = require('../api/pipedrive');
const logger = require('./logger');

const SUPPORTED_BIDIRECTIONAL = ['pipedrive', 'hubspot', 'salesforce'];

/**
 * Sync one user's CRM data bidirectionally.
 */
async function syncUser(userId) {
  const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [userId]);
  const activeCrm = userRow.rows[0]?.active_crm_provider || 'pipedrive';

  if (!SUPPORTED_BIDIRECTIONAL.includes(activeCrm)) {
    logger.warn('crm-sync', `Bidirectional sync not yet supported for ${activeCrm} (user ${userId})`);
    return { synced: 0, updated: 0, pushed: 0 };
  }

  const token = await getUserCrmToken(userId, activeCrm);
  if (!token) return { synced: 0, updated: 0, pushed: 0 };

  let synced = 0, updated = 0, pushed = 0;

  if (activeCrm === 'pipedrive') {
    // ── Pipedrive → Baakalai ──
    try {
      const persons = await pipedrive.listAllPersons(token);

      for (const raw of (persons || [])) {
        const email = Array.isArray(raw.email)
          ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
          : (raw.email || null);
        if (!email) continue;

        const existing = await db.opportunities.findByEmail(userId, email);

        if (!existing) {
          await db.opportunities.create({
            userId,
            name: raw.name || 'Unknown',
            email,
            title: raw.job_title || null,
            company: raw.org_name || raw.org_id?.name || null,
            status: 'imported',
            crmProvider: 'pipedrive',
            crmContactId: String(raw.id),
          });
          synced++;
        } else {
          const updates = {};
          const pdName = raw.name || '';
          const pdTitle = raw.job_title || '';
          const pdCompany = raw.org_name || raw.org_id?.name || '';

          if (pdName && pdName !== existing.name) updates.name = pdName;
          if (pdTitle && pdTitle !== existing.title) updates.title = pdTitle;
          if (pdCompany && pdCompany !== existing.company) updates.company = pdCompany;
          if (!existing.crm_contact_id) updates.crm_contact_id = String(raw.id);
          if (!existing.crm_provider) updates.crm_provider = 'pipedrive';

          if (Object.keys(updates).length > 0) {
            await db.opportunities.update(existing.id, updates);
            updated++;
          }
        }
      }
    } catch (err) {
      logger.warn('crm-sync', `Pipedrive→Baakalai failed for user ${userId}: ${err.message}`);
    }

    // ── Baakalai → Pipedrive ──
    try {
      const opps = await db.opportunities.listByUser(userId, 500, 0);

      for (const opp of opps) {
        if (opp.crm_provider !== 'pipedrive' || !opp.crm_contact_id) continue;

        if (opp.score != null) {
          try {
            const lastPush = opp.score_pushed_at ? new Date(opp.score_pushed_at).getTime() : 0;
            const scoreAge = Date.now() - lastPush;
            if (scoreAge > 7 * 86400000) {
              await pipedrive.createNote(token, {
                personId: parseInt(opp.crm_contact_id, 10),
                content: `<b>Baakalai Score: ${opp.score}/100</b>`,
              });
              pushed++;
            }
          } catch { /* ignore individual push errors */ }
        }
      }
    } catch (err) {
      logger.warn('crm-sync', `Baakalai→Pipedrive failed for user ${userId}: ${err.message}`);
    }
  } else {
    logger.warn('crm-sync', `Bidirectional sync for ${activeCrm} not implemented yet (user ${userId})`);
  }

  return { synced, updated, pushed };
}

/**
 * Run bidirectional sync for ALL users with any supported CRM connected.
 */
async function runAllSync() {
  const users = await db.query(
    `SELECT DISTINCT user_id FROM user_integrations WHERE provider = ANY($1) AND access_token IS NOT NULL`,
    [SUPPORTED_BIDIRECTIONAL]
  );

  const results = [];
  for (const { user_id } of users.rows) {
    try {
      const result = await syncUser(user_id);
      if (result.synced > 0 || result.updated > 0 || result.pushed > 0) {
        results.push({ userId: user_id, ...result });
      }
    } catch (err) {
      logger.error('crm-sync', `Sync failed for user ${user_id}: ${err.message}`);
    }
  }

  return results;
}

module.exports = { syncUser, runAllSync };
