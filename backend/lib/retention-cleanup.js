/**
 * Data Retention Cleanup
 *
 * Runs periodically to enforce data retention policies:
 * - Audit logs: 1 year
 * - Sent nurture emails: 6 months
 * - Read notifications: 3 months
 * - Prospect activities: 1 year
 * - Dismissed memory patterns: 30 days (already exists)
 * - Completed jobs: 7 days (already exists)
 */

const db = require('../db');
const logger = require('./logger');

async function runRetentionCleanup() {
  const results = {};

  try {
    // Audit logs older than 1 year
    const audit = await db.query(
      `DELETE FROM audit_log WHERE created_at < now() - interval '1 year'`
    );
    results.audit_log = audit.rowCount || 0;
  } catch { results.audit_log = 'skipped'; }

  try {
    // Sent nurture emails older than 6 months
    const emails = await db.query(
      `DELETE FROM nurture_emails WHERE status = 'sent' AND created_at < now() - interval '6 months'`
    );
    results.nurture_emails = emails.rowCount || 0;
  } catch { results.nurture_emails = 'skipped'; }

  try {
    // Read notifications older than 3 months
    const notifs = await db.query(
      `DELETE FROM notifications WHERE read = true AND created_at < now() - interval '3 months'`
    );
    results.notifications = notifs.rowCount || 0;
  } catch { results.notifications = 'skipped'; }

  try {
    // Prospect activities older than 1 year
    const activities = await db.query(
      `DELETE FROM prospect_activities WHERE created_at < now() - interval '1 year'`
    );
    results.prospect_activities = activities.rowCount || 0;
  } catch { results.prospect_activities = 'skipped'; }

  try {
    // Rapports du diagnostic CRM public : éphémères par design (30 jours)
    const diag = await db.query(
      `DELETE FROM public_diagnostics WHERE expires_at < now()`
    );
    results.public_diagnostics = diag.rowCount || 0;
  } catch { results.public_diagnostics = 'skipped'; }

  const totalDeleted = Object.values(results)
    .filter(v => typeof v === 'number')
    .reduce((sum, n) => sum + n, 0);

  if (totalDeleted > 0) {
    logger.info('retention', `Cleanup completed: ${totalDeleted} records deleted`, results);
  }

  return results;
}

module.exports = { runRetentionCleanup };
