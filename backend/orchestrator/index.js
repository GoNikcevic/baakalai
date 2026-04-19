/**
 * Orchestrator — Scheduler entry point
 *
 * Replaces n8n workflows with native cron jobs.
 * Uses the same API clients from /api (lemlist, notion, claude).
 *
 * Enable by calling orchestrator.start() in server.js.
 * Set ORCHESTRATOR_ENABLED=true in .env to activate cron jobs.
 */

const cron = require('node-cron');
const collectStats = require('./jobs/collect-stats');
const regenerate = require('./jobs/regenerate');
const consolidate = require('./jobs/consolidate');
const { runBatchOrchestrator } = require('./jobs/batch-orchestrator');
const db = require('../db');
const logger = require('../lib/logger');

const isEnabled = () => process.env.ORCHESTRATOR_ENABLED === 'true';

function start() {
  if (!isEnabled()) {
    console.log('[orchestrator] Disabled (set ORCHESTRATOR_ENABLED=true to activate).');
    return;
  }

  console.log('[orchestrator] Starting scheduler...');

  // Workflow 1 — Daily stats collection (8:00 AM)
  cron.schedule('0 8 * * *', async () => {
    console.log('[orchestrator] Running daily stats collection...');
    try {
      const result = await collectStats.run();
      console.log(`[orchestrator] Stats collection complete:`, result);
    } catch (err) {
      console.error('[orchestrator] Stats collection failed:', err.message);
    }
  });

  // Workflow 2 — Triggered by Workflow 1 when optimization needed
  // (called programmatically by collect-stats, not on a schedule)

  // Workflow 3 — Monthly memory consolidation (1st of month, 9:00 AM)
  cron.schedule('0 9 1 * *', async () => {
    console.log('[orchestrator] Running monthly memory consolidation...');
    try {
      const result = await consolidate.run();
      console.log(`[orchestrator] Memory consolidation complete:`, result);
    } catch (err) {
      console.error('[orchestrator] Memory consolidation failed:', err.message);
    }
  });

  // Memory pruning — 1st of each month at 10:00
  cron.schedule('0 10 1 * *', async () => {
    try {
      const pruned = await db.memoryPatterns.pruneOld(90);
      console.log(`[pruning] Removed ${pruned} old low-confidence patterns`);
    } catch (err) {
      console.error('[pruning] Error:', err.message);
    }
  });

  // Template generation — 1st of each month at 11:00 (runs after consolidation + pruning)
  cron.schedule('0 11 1 * *', async () => {
    console.log('[orchestrator] Running monthly template generation...');
    const { runTemplateGeneration } = require('../lib/template-generator');
    try {
      const tplResult = await runTemplateGeneration();
      console.log(`[templates] Generated ${tplResult.community} community + ${tplResult.ai} AI templates`);
    } catch (err) {
      console.error('[templates] Error:', err.message);
    }
  });

  // Batch A/B orchestrator — every 12h at 8am and 8pm
  cron.schedule('0 8,20 * * *', async () => {
    console.log('[orchestrator] Running batch A/B orchestrator...');
    try {
      const result = await runBatchOrchestrator();
      console.log('[orchestrator] Batch orchestrator complete:', result);
    } catch (err) {
      logger.error('orchestrator', 'Batch orchestrator failed', { error: err.message });
    }
  });

  // Weekly report — Monday 9:00 AM Paris (7 UTC summer)
  cron.schedule('0 7 * * 1', async () => {
    try {
      const { runWeeklyReports } = require('./jobs/weekly-report');
      await runWeeklyReports();
    } catch (err) {
      logger.error('orchestrator', 'Weekly reports failed: ' + err.message);
    }
  });

  // Deliverability checks — daily at 10:00 AM
  cron.schedule('0 8 * * *', async () => {
    try {
      const { runDeliverabilityChecks } = require('../lib/deliverability-agent');
      await runDeliverabilityChecks();
    } catch (err) {
      logger.error('orchestrator', 'Deliverability checks failed: ' + err.message);
    }
  });

  // Nurture engine — daily at 9:00 AM (after stats collection at 8:00)
  cron.schedule('0 9 * * *', async () => {
    try {
      const { runAllNurture } = require('../lib/nurture-engine');
      const results = await runAllNurture();
      console.log('[orchestrator] Nurture engine complete:', JSON.stringify(results.map(r => ({ userId: r.userId, sent: r.sent, queued: r.queued }))));
    } catch (err) {
      logger.error('orchestrator', 'Nurture engine failed: ' + err.message);
    }
  });

  // CRM bidirectional sync — daily at 9:30 AM (after nurture at 9:00)
  cron.schedule('30 9 * * *', async () => {
    try {
      const { runAllSync } = require('../lib/crm-bidirectional-sync');
      const results = await runAllSync();
      if (results.length > 0) {
        console.log('[orchestrator] CRM sync complete:', JSON.stringify(results));
      }
    } catch (err) {
      logger.error('orchestrator', 'CRM sync failed: ' + err.message);
    }
  });

  console.log('[orchestrator] Scheduler active — Stats: 8AM, Nurture: 9AM, CRM sync: 9:30AM, Batch A/B: 8AM+8PM');
}

module.exports = { start, collectStats, regenerate, consolidate, runBatchOrchestrator };
