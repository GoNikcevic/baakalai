/**
 * Orchestrator — Scheduler entry point
 *
 * Replaces n8n workflows with native cron jobs.
 * Uses the same API clients from /api (lemlist, notion, claude).
 *
 * NOT ACTIVE — enable in server.js when ready to migrate off n8n.
 */

// const cron = require('node-cron');  // Add to package.json when activating
const collectStats = require('./jobs/collect-stats');
const regenerate = require('./jobs/regenerate');
const consolidate = require('./jobs/consolidate');

function start() {
  console.log('[orchestrator] Starting scheduler...');

  // Workflow 1 — Daily stats collection (8:00 AM)
  // cron.schedule('0 8 * * *', () => collectStats.run());

  // Workflow 2 — Triggered by Workflow 1 when optimization needed
  // (called programmatically, not on a schedule)

  // Workflow 3 — Monthly memory consolidation (1st of month, 9:00 AM)
  // cron.schedule('0 9 1 * *', () => consolidate.run());

  console.log('[orchestrator] Scheduler registered (all jobs commented out).');
}

module.exports = { start, collectStats, regenerate, consolidate };
