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
const db = require('../db');

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

  console.log('[orchestrator] Scheduler active — WF1: daily 8:00 AM, WF3: monthly 1st 9:00 AM, Pruning: monthly 1st 10:00 AM');
}

module.exports = { start, collectStats, regenerate, consolidate };
