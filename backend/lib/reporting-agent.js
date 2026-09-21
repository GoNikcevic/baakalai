/**
 * Reporting Agent
 *
 * Wraps the weekly-report job with intelligent decisions:
 * - Suppresses empty reports (nothing changed → don't email)
 * - Adds anomaly detection (alert on sudden drops)
 * - Contextual recommendations based on campaign state
 *
 * IMPORTANT: Underlying weekly-report job is NOT modified.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Run the reporting agent.
 * Checks if a report is worth sending before generating it.
 */
async function runReportingAgent() {
  const startTime = Date.now();
  const report = {
    weeklyReport: null,
    anomalies: [],
    skipped: [],
    errors: [],
  };

  try {
    // Check if any user has active campaigns with recent activity
    const activeUsers = await db.query(
      `SELECT DISTINCT u.id, u.email, u.name
       FROM users u
       INNER JOIN campaigns c ON c.user_id = u.id
       WHERE c.status = 'active' AND c.last_collected > now() - interval '14 days'`
    );

    if (activeUsers.rows.length === 0) {
      report.skipped.push('No users with recently collected campaigns, skipping reports');
      report.duration = Date.now() - startTime;
      return report;
    }

    // ── Step 1: Anomaly detection (before sending reports) ──
    for (const user of activeUsers.rows) {
      try {
        const campaigns = await db.campaigns.list({ userId: user.id, status: 'active' });

        for (const campaign of campaigns) {
          // Check for sudden open rate drop
          if (campaign.open_rate != null && campaign.open_rate < 5 && campaign.nb_prospects > 50) {
            report.anomalies.push({
              userId: user.id,
              campaign: campaign.name,
              type: 'low_open_rate',
              message: `${campaign.name}: taux d'ouverture critique (${campaign.open_rate}%)`,
            });
          }

          // Check for stale campaign (no collection in 7+ days)
          if (campaign.last_collected) {
            const daysSinceCollection = (Date.now() - new Date(campaign.last_collected).getTime()) / 86400000;
            if (daysSinceCollection > 7) {
              report.anomalies.push({
                userId: user.id,
                campaign: campaign.name,
                type: 'stale_data',
                message: `${campaign.name}: pas de collecte depuis ${Math.round(daysSinceCollection)} jours`,
              });
            }
          }
        }
      } catch (err) {
        report.errors.push({ step: 'anomaly_detection', user: user.id, error: err.message });
      }
    }

    // ── Step 2: Send weekly reports ──
    try {
      const { runWeeklyReports } = require('../orchestrator/jobs/weekly-report');
      report.weeklyReport = await runWeeklyReports();
      logger.info('reporting-agent', `Weekly reports sent to ${activeUsers.rows.length} users`);
    } catch (err) {
      report.errors.push({ step: 'weekly_report', error: err.message });
      logger.error('reporting-agent', `Weekly report failed: ${err.message}`);
    }

    // ── Step 2b: Per-user team digests ──
    try {
      const teamMembers = await db.query(
        `SELECT tm.user_id, u.email, u.name, tm.team_id
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.role != 'viewer'`
      );
      let digestCount = 0;
      for (const member of teamMembers.rows) {
        try {
          const statsResult = await db.query(
            `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE churn_score >= 76) as critical,
              COUNT(*) FILTER (WHERE churn_score >= 50 AND churn_score < 76) as at_risk,
              COUNT(*) FILTER (WHERE status = 'won') as won,
              COUNT(*) FILTER (WHERE status = 'lost') as lost,
              COALESCE(SUM(deal_value) FILTER (WHERE status = 'won'), 0) as revenue
            FROM opportunities WHERE owner_id = $1`,
            [member.user_id]
          );
          const stats = statsResult.rows[0];
          if (Number(stats.total) === 0) continue;

          const recentResult = await db.query(
            `SELECT name, company, status, deal_value, churn_score
             FROM opportunities WHERE owner_id = $1 AND updated_at > now() - interval '7 days'
             ORDER BY updated_at DESC LIMIT 5`,
            [member.user_id]
          );

          const { createNotification } = require('./notify');
          await createNotification(member.user_id, {
            type: 'campaign_launched',
            title: 'Your weekly CRM digest',
            body: `${stats.total} contacts | ${stats.won} won ($${Number(stats.revenue).toLocaleString()}) | ${stats.critical} critical risk | ${recentResult.rows.length} updated this week`,
            metadata: { stats: { total: Number(stats.total), critical: Number(stats.critical), atRisk: Number(stats.at_risk), won: Number(stats.won), lost: Number(stats.lost), revenue: Number(stats.revenue) }, recentChanges: recentResult.rows },
          });
          digestCount++;
        } catch (err) {
          report.errors.push({ step: 'member_digest', user: member.user_id, error: err.message });
        }
      }
      report.memberDigests = digestCount;
      logger.info('reporting-agent', `Per-user digests: ${digestCount} sent`);
    } catch (err) {
      report.errors.push({ step: 'team_digests', error: err.message });
    }

    // ── Step 3: Create notifications for anomalies ──
    for (const anomaly of report.anomalies) {
      try {
        await db.query(
          `INSERT INTO notifications (user_id, title, body, type) VALUES ($1, $2, $3, 'warning')`,
          [anomaly.userId, anomaly.type === 'low_open_rate' ? 'Alerte délivrabilité' : 'Données obsolètes', anomaly.message]
        );
      } catch { /* ignore notification errors */ }
    }

  } catch (err) {
    report.errors.push({ step: 'main', error: err.message });
    logger.error('reporting-agent', `Agent failed: ${err.message}`);
  }

  report.duration = Date.now() - startTime;
  logger.info('reporting-agent', `Complete in ${report.duration}ms, anomalies: ${report.anomalies.length}, errors: ${report.errors.length}`);

  return report;
}

module.exports = { runReportingAgent };
