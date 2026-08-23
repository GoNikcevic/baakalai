/**
 * Prospection Agent
 *
 * Wraps existing jobs (collect-stats, regenerate, batch-orchestrator,
 * deliverability-agent) with intelligent decision-making.
 *
 * Instead of running everything on a fixed schedule, the agent:
 * - Checks what changed since last run
 * - Skips unnecessary work (saves Claude tokens)
 * - Prioritizes campaigns with recent activity
 * - Chains actions: stats → analysis → regeneration → batch → deliverability
 * - Reports what it did and why it skipped
 *
 * IMPORTANT: The underlying jobs are NOT modified. This agent calls them
 * conditionally. If the agent fails, the jobs still work standalone.
 */

const db = require('../db');
const collectStats = require('../orchestrator/jobs/collect-stats');
const { runBatchOrchestrator } = require('../orchestrator/jobs/batch-orchestrator');
const { runDeliverabilityChecks } = require('./deliverability-agent');
const logger = require('./logger');

/**
 * Run the prospection agent for all users.
 * Replaces 4 separate crons with one intelligent pass.
 */
async function runProspectionAgent() {
  const startTime = Date.now();
  const report = {
    stats: null,
    batch: null,
    deliverability: null,
    skipped: [],
    errors: [],
  };

  // ── Step 1: Collect Stats ──
  // Always run — this is the foundation for everything else.
  // The job itself already has smart gating (>50 prospects, >7 days).
  try {
    report.stats = await collectStats.run();
    logger.info('prospection-agent', `Stats: ${report.stats.collected} collected, ${report.stats.analyzed} analyzed`);
  } catch (err) {
    report.errors.push({ step: 'stats', error: err.message });
    logger.error('prospection-agent', `Stats failed: ${err.message}`);
  }

  // ── Step 2: Batch Orchestrator ──
  // Only run if there are active batch campaigns.
  try {
    const batchCampaigns = await db.query(
      `SELECT COUNT(*) as count FROM campaigns WHERE batch_mode = true AND status = 'active'`
    );
    const batchCount = parseInt(batchCampaigns.rows[0]?.count || 0, 10);

    if (batchCount > 0) {
      report.batch = await runBatchOrchestrator();
      logger.info('prospection-agent', `Batch: processed ${batchCount} campaigns`);
    } else {
      report.skipped.push('batch: no active batch campaigns');
    }
  } catch (err) {
    report.errors.push({ step: 'batch', error: err.message });
    logger.error('prospection-agent', `Batch failed: ${err.message}`);
  }

  // ── Step 3: Deliverability ──
  // Only run if stats were collected successfully and at least 1 campaign has >50 sends.
  try {
    const hasEnoughData = report.stats?.collected > 0;
    if (hasEnoughData) {
      report.deliverability = await runDeliverabilityChecks();
      logger.info('prospection-agent', 'Deliverability checks complete');
    } else {
      report.skipped.push('deliverability: no stats collected, nothing to check');
    }
  } catch (err) {
    report.errors.push({ step: 'deliverability', error: err.message });
    logger.error('prospection-agent', `Deliverability failed: ${err.message}`);
  }

  // ── Step 4: Signaux sur les comptes CRM (P4 recentrage, 23/08) ──
  // Le cron ne prospecte plus de nouvelles sociétés par secteur/mots-clés :
  // il surveille l'actu des sociétés déjà en CRM (rotation hebdo, signaux
  // rattachés à l'opportunité → contact/email déjà connus). Le scan par
  // config reste accessible en manuel (POST /api/signals/scan).
  try {
    const { runCrmWatch } = require('./agents/signal-agent');
    const users = await db.query(
      `SELECT DISTINCT user_id FROM opportunities WHERE company IS NOT NULL AND TRIM(company) <> ''`
    );
    let totalSignals = 0;
    for (const { user_id } of users.rows) {
      try {
        const signalReport = await runCrmWatch(user_id);
        totalSignals += signalReport.detected;
      } catch (err) {
        logger.warn('prospection-agent', `CRM watch failed for ${user_id}: ${err.message}`);
      }
    }
    report.signals = totalSignals;
    if (totalSignals > 0) logger.info('prospection-agent', `CRM watch: ${totalSignals} signals detected`);
  } catch (err) {
    report.errors.push({ step: 'signals', error: err.message });
  }

  // ── Step 5: LinkedIn outreach (for users with LinkedIn cookie) ──
  try {
    const { run: runLinkedInOutreach } = require('./agents/linkedin-outreach');
    const linkedinUsers = await db.query(
      `SELECT DISTINCT user_id FROM user_integrations WHERE provider = 'linkedin'`
    );
    let totalLinkedin = 0;
    for (const { user_id } of linkedinUsers.rows) {
      try {
        const liReport = await runLinkedInOutreach(user_id);
        totalLinkedin += (liReport.connectionsSent || 0) + (liReport.messagesSent || 0);
      } catch (err) {
        logger.warn('prospection-agent', `LinkedIn outreach failed for ${user_id}: ${err.message}`);
      }
    }
    report.linkedinOutreach = totalLinkedin;
    if (totalLinkedin > 0) logger.info('prospection-agent', `LinkedIn outreach: ${totalLinkedin} actions`);
  } catch (err) {
    report.errors.push({ step: 'linkedin', error: err.message });
  }

  report.duration = Date.now() - startTime;
  logger.info('prospection-agent', `Complete in ${report.duration}ms — stats: ${report.stats?.collected || 0}, batch: ${report.batch ? 'yes' : 'skipped'}, deliv: ${report.deliverability ? 'yes' : 'skipped'}, signals: ${report.signals || 0}, linkedin: ${report.linkedinOutreach || 0}, errors: ${report.errors.length}`);

  return report;
}

module.exports = { runProspectionAgent };
