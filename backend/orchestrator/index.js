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
const { withLock } = require('../lib/db-lock');

const isEnabled = () => process.env.ORCHESTRATOR_ENABLED === 'true';

/**
 * Fuseau des expressions cron.
 *
 * Sans `timezone`, node-cron interprete l'expression dans le fuseau du
 * conteneur — UTC sur Railway. « 9h » tombait donc a 10h ou 11h a Paris selon
 * la saison. L'intention produit est l'heure de bureau francaise.
 */
const TZ = process.env.CRON_TIMEZONE || 'Europe/Paris';

/**
 * Planifie une tache sous verrou exclusif.
 *
 * node-cron est purement in-process : chaque instance enregistre ses propres
 * crons. Avec deux replicas — ou pendant un redeploiement qui chevauche un
 * creneau — la meme tache s'executerait deux fois, donc double facture LLM et
 * emails envoyes en double. Le verrou consultatif Postgres (non bloquant) fait
 * qu'une seule instance execute; les autres passent leur tour.
 *
 * Chaque declenchement est trace dans cron_runs (migration 069) : c'est la
 * matiere premiere du dead-man's switch (lib/cron-watchdog.js), ne le
 * retirer sous aucun pretexte — sans lui, une panne de scheduler redevient
 * invisible, comme les trois mois d'extinction d'avril-juillet 2026.
 * Le tracage est best-effort : il ne doit jamais empecher un job de tourner.
 */
function schedule(name, expression, handler) {
  cron.schedule(expression, async () => {
    const db = require('../db');
    let runId = null;
    try {
      const r = await db.query(
        `INSERT INTO cron_runs (job) VALUES ($1) RETURNING id`, [name]
      );
      runId = r.rows[0]?.id ?? null;
    } catch { /* table absente ou DB indisponible : le job prime */ }

    let ok = true;
    let errMsg = null;
    const outcome = await withLock(`cron:${name}`, handler).catch((err) => {
      ok = false;
      errMsg = err.message;
      logger.error('orchestrator', `${name} failed: ${err.message}`, { cron: name });
      return { ran: true };
    });
    if (outcome && outcome.ran === false) {
      logger.info('orchestrator', `${name} skipped — already running on another instance`, { cron: name });
    }

    if (runId != null) {
      try {
        await db.query(
          `UPDATE cron_runs SET finished_at = now(), ok = $1, error = $2, meta = $3 WHERE id = $4`,
          [ok, errMsg, JSON.stringify({ skipped: outcome?.ran === false }), runId]
        );
      } catch { /* best-effort */ }
    }
  }, { timezone: TZ });
}

function start() {
  if (!isEnabled()) {
    console.log('[orchestrator] Disabled (set ORCHESTRATOR_ENABLED=true to activate).');
    return;
  }

  console.log(`[orchestrator] Starting scheduler (timezone: ${TZ})...`);

  // ═══════════════════════════════════════════════════
  // Agent 1: Prospection Agent — Daily 8:00 AM
  // Stats collection + batch A/B + deliverability
  // ═══════════════════════════════════════════════════
  schedule('prospection', '0 8 * * *', async () => {
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
  schedule('evening-batch', '0 20 * * *', async () => {
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
  schedule('crm-agent', '0 9 * * *', async () => {
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
  schedule('strategic-daily', '30 9 * * *', async () => {
    console.log('[agent:strategic-daily] Starting fast strategic agents...');
    try {
      const { runOne } = require('../lib/agents/strategic-orchestrator');
      const db = require('../db');

      // Purge de l'historique des résultats stratégiques (migration 073)
      await db.query(`DELETE FROM strategic_results WHERE created_at < now() - interval '90 days'`);

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
  schedule('lifecycle-emails', '0 10 * * *', async () => {
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
  schedule('memory-agent', '0 10 * * 0', async () => {
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
  schedule('churn-signals', '0 11 * * 0', async () => {
    console.log('[churn-signals] Starting weekly external signal scan...');
    try {
      const { scanExternalSignalsForUser } = require('../lib/churn-external-signals');
      const { scanFinancialHealthForUser } = require('../lib/financial-health');
      const db = require('../db');
      const users = await db.query('SELECT id FROM users WHERE onboarding_complete = true');
      let scanned = 0, signalsFound = 0;
      for (const { id } of users.rows) {
        try {
          // Registres officiels d'abord (gratuit, signaux durs — toutes les sociétés
          // clientes), puis le scan news Brave (payant — clients déjà à risque only).
          const registryReport = await scanFinancialHealthForUser(id);
          signalsFound += registryReport.signalsFound;
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
  // CRM Digest — Monday 8:45 AM
  // Email hebdo « À traiter cette semaine » pour les utilisateurs CRM
  // (weekly-report ne couvre que ceux qui ont des campagnes actives)
  // ═══════════════════════════════════════════════════
  schedule('crm-digest', '45 8 * * 1', async () => {
    console.log('[crm-digest] Starting...');
    try {
      const { runCrmDigests } = require('./jobs/crm-digest');
      const result = await runCrmDigests();
      console.log(`[crm-digest] Done — ${result.sent} sent, ${result.skipped} skipped`);
    } catch (err) {
      logger.error('orchestrator', 'CRM digest failed: ' + err.message);
    }
  });

  // ═══════════════════════════════════════════════════
  // Agent 4: Reporting Agent — Monday 9:00 AM
  // Weekly report + anomaly detection
  // ═══════════════════════════════════════════════════
  schedule('reporting-agent', '0 9 * * 1', async () => {
    console.log('[agent:reporting] Starting...');
    try {
      const { runReportingAgent } = require('../lib/reporting-agent');
      const report = await runReportingAgent();
      console.log(`[agent:reporting] Done in ${report.duration}ms — anomalies: ${report.anomalies.length}, errors: ${report.errors.length}`);
    } catch (err) {
      logger.error('orchestrator', 'Reporting Agent failed: ' + err.message);
    }
  });

  console.log(`[orchestrator] Started — 9 cron jobs registered (timezone: ${TZ})`);
  console.log('  Prospection:      daily 8AM + evening batch 8PM');
  console.log('  CRM:              daily 9AM');
  console.log('  Strategic (fast): daily 9:30AM (deal_coach, upsell, copy_optimizer)');
  console.log('  Lifecycle:        daily 10AM');
  console.log('  Memory:           Sunday 10AM (+ heavy strategic agents)');
  console.log('  Churn signals:    Sunday 11AM (external web scan, medium+ risk clients only)');
  console.log('  CRM Digest:       Monday 8:45AM (à traiter cette semaine)');
  console.log('  Reporting:        Monday 9AM');
  console.log('  (Deal reactivation / auto-upsell now generate on demand — no background cron)');
}

module.exports = { start, collectStats, regenerate, consolidate, runBatchOrchestrator };
