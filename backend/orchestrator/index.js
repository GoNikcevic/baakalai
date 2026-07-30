/**
 * Orchestrator — Agent-based scheduler
 *
 * 4 intelligent agents replace 7 separate cron jobs:
 *
 * | Agent              | Schedule     | Replaces                                    |
 * |--------------------|-------------|---------------------------------------------|
 * | Prospection Agent  | Daily 8AM   | collect-stats + batch-orch + deliverability  |
 * | CRM Agent          | Daily 9AM   | nurture + sync + cleaning                    |
 * | Memory Agent       | Weekly Sun  | consolidate + pruning + templates             |
 * | Reporting Agent    | Monday 9AM  | weekly-report + anomaly detection             |
 *
 * Each agent wraps the existing job code (no job is modified).
 * Agents add: context evaluation, skip logic, error isolation, reporting.
 *
 * Enable by calling orchestrator.start() in server.js.
 * Set ORCHESTRATOR_ENABLED=true in .env to activate.
 */

const cron = require('node-cron');
const collectStats = require('./jobs/collect-stats');
const regenerate = require('./jobs/regenerate');
const consolidate = require('./jobs/consolidate');
const { runBatchOrchestrator } = require('./jobs/batch-orchestrator');
const logger = require('../lib/logger');

const isEnabled = () => process.env.ORCHESTRATOR_ENABLED === 'true';

function start() {
  if (!isEnabled()) {
    console.log('[orchestrator] Disabled (set ORCHESTRATOR_ENABLED=true to activate).');
    return;
  }

  console.log('[orchestrator] Starting 4-agent scheduler...');

  // ═══════════════════════════════════════════════════
  // Agent 1: Prospection Agent — Daily 8:00 AM
  // Stats collection + batch A/B + deliverability
  // ═══════════════════════════════════════════════════
  cron.schedule('0 8 * * *', async () => {
    console.log('[agent:prospection] Starting...');
    try {
      const { runProspectionAgent } = require('../lib/prospection-agent');
      const report = await runProspectionAgent();
      console.log(`[agent:prospection] Done in ${report.duration}ms — stats: ${report.stats?.collected || 0}, batch: ${report.batch ? 'ran' : 'skipped'}, deliv: ${report.deliverability ? 'ran' : 'skipped'}, errors: ${report.errors.length}`);
    } catch (err) {
      logger.error('orchestrator', 'Prospection Agent failed: ' + err.message);
    }
  });

  // Evening batch check (8PM) — only batch orchestrator, not full agent
  cron.schedule('0 20 * * *', async () => {
    try {
      const result = await runBatchOrchestrator();
      if (result) console.log('[agent:prospection] Evening batch check complete');
    } catch (err) {
      logger.error('orchestrator', 'Evening batch check failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Agent 2: CRM Agent — Daily 9:00 AM
  // Sync + cleaning + nurture
  // ═══════════════════════════════════════════════════
  cron.schedule('0 9 * * *', async () => {
    console.log('[agent:crm] Starting...');
    try {
      const { runAllAgents } = require('../lib/crm-agent');
      const results = await runAllAgents();
      const summary = results.map(r => `user:${r.userId?.slice(0, 8)} sync:+${r.sync?.imported || 0} nurture:${r.nurture?.sent || 0}/${r.nurture?.queued || 0} alerts:${r.alerts?.length || 0}`);
      console.log(`[agent:crm] Done — ${summary.join(', ') || 'no users'}`);
    } catch (err) {
      logger.error('orchestrator', 'CRM Agent failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Strategic Agents (fast) — Daily 9:30 AM
  // Deal Coach + Upsell + Copy Optimizer (benefit from daily runs)
  // Heavy agents (ICP, Win/Loss, Competitor, Timing) stay weekly in Memory Agent
  // ═══════════════════════════════════════════════════
  cron.schedule('30 9 * * *', async () => {
    console.log('[agent:strategic-daily] Starting fast strategic agents...');
    try {
      const { runOne } = require('../lib/agents/strategic-orchestrator');
      const db = require('../db');
      const users = await db.query('SELECT id FROM users WHERE onboarding_complete = true');

      for (const row of users.rows) {
        const userId = row.id;
        const results = {};
        for (const agent of ['deal_coach', 'upsell', 'copy_optimizer']) {
          try {
            results[agent] = await runOne(userId, agent);
          } catch (err) {
            results[agent] = { error: err.message };
          }
        }
        const coached = results.deal_coach?.coached || 0;
        const upsells = results.upsell?.opportunities?.length || 0;
        console.log(`[agent:strategic-daily] user:${userId.slice(0, 8)} deal_coach:${coached} upsell:${upsells}`);
      }
    } catch (err) {
      logger.error('orchestrator', 'Strategic daily agents failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Lifecycle Emails — Daily 10:00 AM
  // Onboarding sequences + retention re-engagement
  // ═══════════════════════════════════════════════════
  cron.schedule('0 10 * * *', async () => {
    try {
      const { runLifecycleEmails } = require('../lib/lifecycle-emails');
      const report = await runLifecycleEmails();
      if (report.total > 0) {
        console.log(`[lifecycle] Sent ${report.total} emails (onboarding: ${report.onboarding.sent}, retention: ${report.retention.sent})`);
      }
    } catch (err) {
      logger.error('orchestrator', 'Lifecycle emails failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Agent 3: Memory Agent — Sunday 10:00 AM
  // Consolidation + pruning + templates (when needed)
  // ═══════════════════════════════════════════════════
  cron.schedule('0 10 * * 0', async () => {
    console.log('[agent:memory] Starting...');
    try {
      const { runMemoryAgent } = require('../lib/memory-agent');
      const report = await runMemoryAgent();
      console.log(`[agent:memory] Done in ${report.duration}ms — skipped: [${report.skipped.join(', ')}], errors: ${report.errors.length}`);
    } catch (err) {
      logger.error('orchestrator', 'Memory Agent failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Churn External Signals — Weekly Sunday 11:00 AM
  // Brave Search scan for medium+ risk clients only (cost control)
  // ═══════════════════════════════════════════════════
  cron.schedule('0 11 * * 0', async () => {
    console.log('[churn-signals] Starting weekly external signal scan...');
    try {
      const { scanExternalSignalsForUser } = require('../lib/churn-external-signals');
      const db = require('../db');
      const users = await db.query('SELECT id FROM users WHERE onboarding_complete = true');
      let scanned = 0, signalsFound = 0;
      for (const { id } of users.rows) {
        try {
          const report = await scanExternalSignalsForUser(id);
          scanned += report.scanned;
          signalsFound += report.signalsFound;
        } catch (err) {
          logger.error('orchestrator', `Churn signals failed for user ${id}: ${err.message}`);
        }
      }
      console.log(`[churn-signals] Done — ${scanned} opportunit${scanned === 1 ? 'y' : 'ies'} scanned, ${signalsFound} signal(s) found`);
    } catch (err) {
      logger.error('orchestrator', 'Churn external signals job failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Agent 4: Reporting Agent — Monday 9:00 AM
  // Weekly report + anomaly detection
  // ═══════════════════════════════════════════════════
  cron.schedule('0 9 * * 1', async () => {
    console.log('[agent:reporting] Starting...');
    try {
      const { runReportingAgent } = require('../lib/reporting-agent');
      const report = await runReportingAgent();
      console.log(`[agent:reporting] Done in ${report.duration}ms — anomalies: ${report.anomalies.length}, errors: ${report.errors.length}`);
    } catch (err) {
      logger.error('orchestrator', 'Reporting Agent failed: ' + err.message);
    }
  });

  console.log('[orchestrator] 5 agents + lifecycle scheduled:');
  console.log('  Prospection:      daily 8AM + evening batch 8PM');
  console.log('  CRM:              daily 9AM');
  console.log('  Strategic (fast): daily 9:30AM (deal_coach, upsell, copy_optimizer)');
  console.log('  Lifecycle:        daily 10AM');
  console.log('  Memory:           Sunday 10AM (+ heavy strategic agents)');
  console.log('  Churn signals:    Sunday 11AM (external web scan, medium+ risk clients only)');
  console.log('  Reporting:        Monday 9AM');
  console.log('  (Deal reactivation / auto-upsell now generate on demand — no background cron)');
}

module.exports = { start, collectStats, regenerate, consolidate, runBatchOrchestrator };
