/**
 * Dead-man's switch des crons.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * La variable Railway « " ORCHESTRATOR_ENABLED" » (espace en tête) a éteint
 * les 8 crons pendant environ trois mois — avril à juillet 2026 — sans
 * qu'aucun signal ne le révèle : un cron qui ne se déclenche pas ne produit
 * aucune erreur, juste une absence. Ce module surveille l'absence.
 *
 * PRINCIPE
 * --------
 * L'orchestrateur trace chaque exécution dans `cron_runs` (migration 069).
 * Le watchdog tourne dans le PROCESSUS WEB — délibérément hors du flag
 * ORCHESTRATOR_ENABLED : si le flag casse à nouveau, le web continue de
 * tourner et c'est lui qui donne l'alerte.
 *
 * Un job n'est surveillé que s'il a déjà tourné au moins une fois : staging
 * (orchestrateur volontairement éteint) n'alerte donc jamais, et la prod est
 * protégée dès la première exécution réussie de chaque job.
 *
 * Alerte = email système (Resend) à ALERT_EMAIL + ligne notifications pour
 * chaque admin, dédupliquée à une par job et par 24 h via `cron_alerts`.
 */

const logger = require('./logger');

/**
 * Délai d'alerte par job, en heures. Marge d'une nuit sur les quotidiens
 * (26 h) pour tolérer un run lent ou un redeploy pile sur le créneau ;
 * 8 jours sur les hebdomadaires.
 *
 * À maintenir en même temps que les schedule() de orchestrator/index.js —
 * un job absent d'ici est tracé mais jamais surveillé.
 */
const EXPECTED_JOBS = {
  prospection: 26,
  'evening-batch': 26,
  'crm-agent': 26,
  'strategic-daily': 26,
  'lifecycle-emails': 26,
  'memory-agent': 8 * 24,
  'churn-signals': 180,
  'signal-scheduler': 3, // tick 30 min — 3h de retard = vraiment mort
  'crm-digest': 8 * 24,
  'reporting-agent': 8 * 24,
};

/**
 * Détermine les jobs en retard à partir des dernières exécutions connues.
 * Fonction pure — c'est elle que les tests couvrent.
 *
 * @param {Array<{job: string, last_started: string|Date}>} lastRuns
 *        dernière exécution par job (toute exécution compte, même en échec :
 *        on surveille le déclenchement, pas le succès — un job qui tourne et
 *        échoue produit déjà ses propres logs d'erreur)
 * @param {Date} now
 * @returns {Array<{job: string, hoursLate: number, expectedHours: number}>}
 */
function findStaleJobs(lastRuns, now = new Date()) {
  const stale = [];
  for (const row of lastRuns || []) {
    const expectedHours = EXPECTED_JOBS[row.job];
    if (!expectedHours) continue; // job inconnu du catalogue : tracé, pas surveillé
    const last = new Date(row.last_started);
    if (Number.isNaN(last.getTime())) continue;
    const hoursSince = (now.getTime() - last.getTime()) / 3_600_000;
    if (hoursSince > expectedHours) {
      stale.push({ job: row.job, hoursLate: Math.round(hoursSince - expectedHours), expectedHours });
    }
  }
  return stale;
}

/** Dernière exécution par job (une ligne par job connu de cron_runs). */
async function fetchLastRuns(db) {
  const { rows } = await db.query(
    `SELECT job, MAX(started_at) AS last_started FROM cron_runs GROUP BY job`
  );
  return rows;
}

/** Vue pour /api/health : dernier run et son issue, par job. */
async function healthSummary(db) {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (job) job, started_at, finished_at, ok
         FROM cron_runs ORDER BY job, started_at DESC`
    );
    const stale = findStaleJobs(rows.map(r => ({ job: r.job, last_started: r.started_at })));
    const staleSet = new Set(stale.map(s => s.job));
    return rows.map(r => ({
      job: r.job,
      lastRun: r.started_at,
      ok: r.ok,
      stale: staleSet.has(r.job),
    }));
  } catch {
    return null; // table absente (migration pas encore jouée) : pas d'info, pas d'erreur
  }
}

async function checkOnce(db) {
  const lastRuns = await fetchLastRuns(db);
  const stale = findStaleJobs(lastRuns);
  if (stale.length === 0) return { stale: [] };

  for (const s of stale) {
    // Une alerte par job et par 24 h. L'UPDATE conditionnel est atomique :
    // si deux replicas web passent en même temps, un seul envoie.
    const claimed = await db.query(
      `INSERT INTO cron_alerts (job, last_alert_at) VALUES ($1, now())
       ON CONFLICT (job) DO UPDATE SET last_alert_at = now()
       WHERE cron_alerts.last_alert_at < now() - interval '24 hours'
       RETURNING job`,
      [s.job]
    );
    if (!claimed.rows[0]) continue;

    const subject = `⚠️ baakalai — le cron « ${s.job} » ne tourne plus`;
    const body = `Le job planifié « ${s.job} » n'a pas démarré depuis plus de ${s.expectedHours} h `
      + `(retard : ~${s.hoursLate} h au-delà du délai attendu).\n\n`
      + `Causes déjà vues : variable ORCHESTRATOR_ENABLED absente ou mal nommée après un `
      + `changement Railway, orchestrateur qui ne démarre plus, crash au boot du scheduler.\n`
      + `Vérifier : railway logs (ligne « 8 cron jobs registered ») et la table cron_runs.`;

    logger.error('cron-watchdog', `${s.job} silencieux depuis ${s.expectedHours + s.hoursLate}h — alerte émise`);

    try {
      const alertTo = process.env.ALERT_EMAIL;
      if (alertTo) {
        const { sendEmail } = require('./email');
        await sendEmail({ to: alertTo, subject, html: `<pre style="font-family:inherit;white-space:pre-wrap">${body}</pre>` });
      }
    } catch (err) {
      logger.warn('cron-watchdog', `email d'alerte non envoyé: ${err.message}`);
    }

    try {
      const admins = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
      for (const a of admins.rows) {
        await db.notifications.create(a.id, 'system', subject, body);
      }
    } catch (err) {
      logger.warn('cron-watchdog', `notification non créée: ${err.message}`);
    }
  }
  return { stale };
}

/**
 * Démarre la surveillance horaire. À appeler depuis server.js, SANS condition
 * sur ORCHESTRATOR_ENABLED (c'est tout l'intérêt).
 */
function startWatchdog(db, { intervalMs = 60 * 60 * 1000 } = {}) {
  const tick = () => {
    checkOnce(db).catch(err => logger.warn('cron-watchdog', `check impossible: ${err.message}`));
  };
  // Premier passage différé de 2 min : laisse la DB et les migrations respirer au boot.
  setTimeout(tick, 2 * 60 * 1000).unref();
  // .unref() obligatoire : quatre setInterval sans lui ont déjà figé la suite
  // de tests 179 s (voir session 2026-07-27).
  setInterval(tick, intervalMs).unref();
  logger.info('cron-watchdog', `surveillance active (${Object.keys(EXPECTED_JOBS).length} jobs, passage horaire)`);
}

module.exports = { startWatchdog, checkOnce, findStaleJobs, healthSummary, EXPECTED_JOBS };
