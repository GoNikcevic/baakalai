/**
 * Memory Agent
 *
 * Wraps existing jobs (consolidate, pruning, template-generator) with
 * intelligent triggering logic.
 *
 * Instead of running monthly on the 1st, the agent:
 * - Checks if enough new diagnostics exist to justify consolidation
 * - Only prunes patterns that are truly outdated
 * - Generates templates only when high-performing campaigns exist
 * - Reports what it did and what it skipped
 *
 * IMPORTANT: Underlying jobs are NOT modified.
 */

const db = require('../db');
const consolidate = require('../orchestrator/jobs/consolidate');
const logger = require('./logger');

const MIN_NEW_DIAGNOSTICS = 3; // minimum new diagnostics to justify consolidation

/**
 * Run the memory agent.
 * Evaluates whether consolidation/pruning/template generation is needed.
 */
async function runMemoryAgent() {
  const startTime = Date.now();
  const report = {
    consolidation: null,
    pruning: null,
    templates: null,
    skipped: [],
    errors: [],
  };

  // ── Step 1: Check if consolidation is needed ──
  try {
    // Count diagnostics since last consolidation
    const lastConsolidation = await db.query(
      `SELECT MAX(date_discovered) as last_date FROM memory_patterns`
    );
    const lastDate = lastConsolidation.rows[0]?.last_date || '2020-01-01';

    const newDiagnostics = await db.query(
      `SELECT COUNT(*) as count FROM diagnostics WHERE date_analyse > $1`,
      [lastDate]
    );
    const newCount = parseInt(newDiagnostics.rows[0]?.count || 0, 10);

    if (newCount >= MIN_NEW_DIAGNOSTICS) {
      report.consolidation = await consolidate.run();
      logger.info('memory-agent', `Consolidation: ${newCount} new diagnostics processed`);
    } else {
      report.skipped.push(`consolidation: only ${newCount} new diagnostics (need ${MIN_NEW_DIAGNOSTICS})`);
    }
  } catch (err) {
    report.errors.push({ step: 'consolidation', error: err.message });
    logger.error('memory-agent', `Consolidation failed: ${err.message}`);
  }

  // ── Step 2: Pruning ──
  // Only prune if we have patterns older than 90 days with low confidence
  try {
    const oldPatterns = await db.query(
      `SELECT COUNT(*) as count FROM memory_patterns
       WHERE confidence = 'Faible' AND date_discovered < now() - interval '90 days'`
    );
    const oldCount = parseInt(oldPatterns.rows[0]?.count || 0, 10);

    if (oldCount > 0) {
      const pruned = await db.memoryPatterns.pruneOld(90);
      report.pruning = { pruned };
      logger.info('memory-agent', `Pruning: removed ${pruned} old low-confidence patterns`);
    } else {
      report.skipped.push('pruning: no old low-confidence patterns found');
    }
  } catch (err) {
    report.errors.push({ step: 'pruning', error: err.message });
  }

  // ── Step 3: Template generation ──
  // Only generate if we have high-performing campaigns not yet templated
  try {
    const highPerf = await db.query(
      `SELECT COUNT(*) as count FROM campaigns
       WHERE open_rate > 55 AND reply_rate > 7 AND nb_prospects > 100`
    );
    const highPerfCount = parseInt(highPerf.rows[0]?.count || 0, 10);

    if (highPerfCount > 0) {
      const { runTemplateGeneration } = require('./template-generator');
      report.templates = await runTemplateGeneration();
      logger.info('memory-agent', `Templates: ${report.templates.community} community + ${report.templates.ai} AI`);
    } else {
      report.skipped.push('templates: no high-performing campaigns for template generation');
    }
  } catch (err) {
    report.errors.push({ step: 'templates', error: err.message });
  }

  // ── Step 4: Sector template agent ──
  // Generate/update templates based on memory patterns + campaign performance
  try {
    const { runTemplateAgent } = require('./template-agent');
    const templateReport = await runTemplateAgent();
    report.sectorTemplates = templateReport;
    if (templateReport.generated > 0 || templateReport.updated > 0) {
      logger.info('memory-agent', `Sector templates: ${templateReport.generated} new, ${templateReport.updated} updated`);
    }
  } catch (err) {
    report.errors.push({ step: 'sector-templates', error: err.message });
  }

  report.duration = Date.now() - startTime;
  logger.info('memory-agent', `Complete in ${report.duration}ms — skipped: ${report.skipped.length}, errors: ${report.errors.length}`);

  return report;
}

module.exports = { runMemoryAgent };
