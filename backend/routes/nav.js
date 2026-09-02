/**
 * Nav counts — cheap per-user action counters for the sidebar badges.
 *
 * Everything here must stay DB-only and fast: this endpoint is polled by the
 * layout on every session. No Claude calls, no CRM API calls, no scans —
 * data quality reads existing scan caches only (badge fills once a scan ran).
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { listDealsToReactivate, listClientsToUpsell } = require('../lib/reactivation-queue');
const { AT_RISK_THRESHOLD } = require('../lib/churn-scoring');

// GET /api/nav/counts
router.get('/counts', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [deals, upsells, churn, nurture, dqReports] = await Promise.all([
      listDealsToReactivate(userId),
      listClientsToUpsell(userId),
      db.query(
        `SELECT count(*)::int AS n FROM opportunities
         WHERE user_id = $1 AND status = 'won' AND churn_score >= $2`,
        [userId, AT_RISK_THRESHOLD]
      ),
      db.query(
        `SELECT count(*)::int AS n FROM nurture_emails
         WHERE user_id = $1 AND status = 'pending'`,
        [userId]
      ),
      // Latest cached report per provider — includes the __deal_quality__ /
      // __client_quality__ sentinel rows written by routes/data-quality.js.
      db.query(
        `SELECT DISTINCT ON (provider) provider, issues
         FROM crm_cleaning_reports
         WHERE user_id = $1 AND created_at > now() - interval '24 hours'
         ORDER BY provider, created_at DESC`,
        [userId]
      ),
    ]);

    const dataQuality = dqReports.rows.reduce(
      (sum, r) => sum + (Array.isArray(r.issues) ? r.issues.length : 0), 0);

    res.json({
      reactivation: deals.length,
      upsell: upsells.length,
      churn: churn.rows[0].n,
      nurturePending: nurture.rows[0].n,
      dataQuality,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
