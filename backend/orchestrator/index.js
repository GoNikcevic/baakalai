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
  // Agent Chains — Daily 9:45 AM
  // Autonomous action chains (deal reactivation, auto-upsell)
  // Runs after strategic agents so data is fresh
  // ═══════════════════════════════════════════════════
  cron.schedule('45 9 * * *', async () => {
    console.log('[agent:chains] Starting autonomous chains...');
    try {
      const { runAllChains } = require('../lib/agent-chains');
      const results = await runAllChains();
      const summary = results.map(r => {
        const re = r.reactivation?.executed || r.reactivation?.pending || 0;
        const up = r.upsell?.executed || r.upsell?.pending || 0;
        return re + up > 0 ? `user:${r.userId} reactivation:${re} upsell:${up}` : null;
      }).filter(Boolean);
      console.log(`[agent:chains] Done — ${summary.length > 0 ? summary.join(', ') : 'no actions triggered'}`);
    } catch (err) {
      logger.error('orchestrator', 'Agent chains failed: ' + err.message);
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

  console.log('[orchestrator] 6 agents + lifecycle scheduled:');
  console.log('  Prospection:      daily 8AM + evening batch 8PM');
  console.log('  CRM:              daily 9AM');
  console.log('  Strategic (fast): daily 9:30AM (deal_coach, upsell, copy_optimizer)');
  console.log('  Agent Chains:     daily 9:45AM (deal reactivation, auto-upsell)');
  console.log('  Lifecycle:        daily 10AM');
  console.log('  Memory:           Sunday 10AM (+ heavy strategic agents)');
  console.log('  Reporting:        Monday 9AM');
}

module.exports = { start, collectStats, regenerate, consolidate, runBatchOrchestrator };
