/**
 * Signal Scheduler — file tournante continue, sous quota.
 *
 * Remplace le batch unique du matin : un tick toutes les 30 minutes prend les
 * cibles les plus « dues » (priorité × ancienneté) dans une file unifiée
 * configs actives + sociétés du CRM, et s'arrête quand le budget Brave du
 * jour est consommé. Plus d'utilisateurs = la file tourne moins vite au lieu
 * d'exploser le quota au pic de 8 h.
 *
 * Cadences cibles (l'ancienneté fait monter tout le monde — pas de famine) :
 *   - société chaude (churn >= seuil, ou deal >= 10 k€, ou boost webhook) : ~6 h
 *   - config active : ~12 h (2×/jour — avant : jamais scannée automatiquement)
 *   - société standard : ~7 jours (cadence de l'ancien sharding hebdo)
 */

const db = require('../db');
const logger = require('./logger');
const { AT_RISK_THRESHOLD } = require('./churn-scoring');

const MONTHLY_QUOTA = parseInt(process.env.BRAVE_MONTHLY_QUOTA || '2000', 10);
// 80 % du quota pour le scheduler — la réserve couvre les scans manuels
// (bouton « Lancer le scan ») et le scan hebdo churn du dimanche.
const DAILY_BUDGET = Math.max(5, Math.floor((MONTHLY_QUOTA / 31) * 0.8));

const HOUR_MS = 3600 * 1000;
const INTERVALS = {
  companyHot: 6 * HOUR_MS,
  config: 12 * HOUR_MS,
  companyStandard: 7 * 24 * HOUR_MS,
};
const HOT_DEAL_VALUE = 10000;

async function getRemainingBudget() {
  const r = await db.query(`SELECT used FROM signal_scan_budget WHERE day = CURRENT_DATE`);
  return DAILY_BUDGET - (r.rows[0]?.used || 0);
}

async function consumeBudget(queries) {
  if (queries <= 0) return;
  await db.query(
    `INSERT INTO signal_scan_budget (day, used) VALUES (CURRENT_DATE, $1)
     ON CONFLICT (day) DO UPDATE SET used = signal_scan_budget.used + $1`,
    [queries]
  );
}

async function markScanned(userId, targetType, targetKey) {
  await db.query(
    `INSERT INTO signal_scan_state (user_id, target_type, target_key, last_scanned_at, boost_until)
     VALUES ($1, $2, $3, now(), NULL)
     ON CONFLICT (user_id, target_type, target_key)
     DO UPDATE SET last_scanned_at = now(), boost_until = NULL`,
    [userId, targetType, targetKey]
  );
}

/**
 * Pose un boost sur une société : elle passera en tête de file au prochain
 * tick. Appelé par les webhooks CRM quand un deal bouge — fraîcheur <= 30 min
 * sans appel immédiat (le budget reste maître).
 */
async function boostCompany(userId, companyName, hours = 2) {
  const key = (companyName || '').trim().toLowerCase();
  if (!key) return;
  await db.query(
    `INSERT INTO signal_scan_state (user_id, target_type, target_key, boost_until)
     VALUES ($1, 'company', $2, now() + interval '1 hour' * $3)
     ON CONFLICT (user_id, target_type, target_key)
     DO UPDATE SET boost_until = now() + interval '1 hour' * $3`,
    [userId, key, hours]
  ).catch(err => logger.warn('signal-scheduler', `boost ${key}: ${err.message}`));
}

/**
 * Construit la file des cibles dues, triée par urgence décroissante.
 * score = boost (prioritaire absolu) puis âge/intervalle (1.0 = tout juste dû).
 */
async function collectDueTargets() {
  const targets = [];

  // Configs actives des utilisateurs onboardés
  const configs = await db.query(
    `SELECT c.id, c.user_id, s.last_scanned_at, s.boost_until,
            COALESCE(array_length(c.signal_types, 1), 3) AS n_types
     FROM signal_configs c
     JOIN users u ON u.id = c.user_id AND u.onboarding_complete = true
     LEFT JOIN signal_scan_state s ON s.user_id = c.user_id AND s.target_type = 'config' AND s.target_key = c.id::text
     WHERE c.enabled = true`
  );
  for (const c of configs.rows) {
    const age = c.last_scanned_at ? Date.now() - new Date(c.last_scanned_at).getTime() : Infinity;
    const ratio = age / INTERVALS.config;
    if (ratio < 1) continue;
    targets.push({
      type: 'config', userId: c.user_id, key: String(c.id),
      cost: Math.min(c.n_types, 9), score: ratio,
      boosted: false,
    });
  }

  // Sociétés du CRM (une cible par société et par utilisateur)
  const companies = await db.query(
    `SELECT o.user_id, lower(trim(o.company)) AS company_key,
            max(o.churn_score) AS churn, max(o.deal_value) AS deal_value,
            s.last_scanned_at, s.boost_until
     FROM opportunities o
     JOIN users u ON u.id = o.user_id AND u.onboarding_complete = true
     LEFT JOIN signal_scan_state s ON s.user_id = o.user_id AND s.target_type = 'company' AND s.target_key = lower(trim(o.company))
     WHERE o.company IS NOT NULL AND trim(o.company) <> '' AND o.status <> 'lost'
     GROUP BY o.user_id, lower(trim(o.company)), s.last_scanned_at, s.boost_until`
  );
  for (const c of companies.rows) {
    const boosted = c.boost_until && new Date(c.boost_until).getTime() > Date.now();
    const hot = boosted || (c.churn != null && c.churn >= AT_RISK_THRESHOLD) || (Number(c.deal_value) >= HOT_DEAL_VALUE);
    const interval = hot ? INTERVALS.companyHot : INTERVALS.companyStandard;
    const age = c.last_scanned_at ? Date.now() - new Date(c.last_scanned_at).getTime() : Infinity;
    const ratio = age / interval;
    if (!boosted && ratio < 1) continue;
    targets.push({
      type: 'company', userId: c.user_id, key: c.company_key,
      cost: 1, score: boosted ? 1000 + ratio : ratio,
      boosted: !!boosted,
    });
  }

  // Infinity (jamais scanné) d'abord, puis par urgence
  targets.sort((a, b) => b.score - a.score);
  return targets;
}

/**
 * Un tick du scheduler : consomme au plus tickCap requêtes du budget du jour.
 */
async function runTick() {
  const report = { scanned: 0, detected: 0, queriesUsed: 0, skipped: null, errors: [] };

  const remaining = await getRemainingBudget();
  if (remaining <= 0) {
    report.skipped = 'budget quotidien consommé';
    return report;
  }
  // Lissé : ~1/8e du budget jour par tick (48 ticks/jour), le budget global clamp.
  const tickCap = Math.min(remaining, Math.max(2, Math.ceil(DAILY_BUDGET / 8)));

  const targets = await collectDueTargets();
  if (targets.length === 0) {
    report.skipped = 'aucune cible due';
    return report;
  }

  const signalAgent = require('./agents/signal-agent');
  // Caches par user pour ne pas recharger les sets de dédup à chaque cible
  const configSets = new Map();
  const companySets = new Map();

  let budgetLeft = tickCap;
  for (const target of targets) {
    if (target.cost > budgetLeft) continue; // essaie une cible moins chère plus bas dans la file
    try {
      if (target.type === 'config') {
        const cfg = await db.query(`SELECT * FROM signal_configs WHERE id = $1 AND enabled = true`, [target.key]);
        if (!cfg.rows[0]) { await markScanned(target.userId, 'config', target.key); continue; }
        if (!configSets.has(target.userId)) configSets.set(target.userId, await signalAgent.loadConfigRecentSet(target.userId));
        const { detected, queriesUsed } = await signalAgent.scanConfig(target.userId, cfg.rows[0], configSets.get(target.userId));
        report.detected += detected;
        report.queriesUsed += queriesUsed;
        budgetLeft -= queriesUsed;
      } else {
        const acct = await signalAgent.loadCompanyAccount(target.userId, target.key);
        if (!acct) { await markScanned(target.userId, 'company', target.key); continue; }
        if (!companySets.has(target.userId)) companySets.set(target.userId, await signalAgent.loadCrmWatchRecentSet(target.userId));
        const { detected, queriesUsed } = await signalAgent.scanCompanyAccount(target.userId, acct, companySets.get(target.userId));
        report.detected += detected;
        report.queriesUsed += queriesUsed;
        budgetLeft -= queriesUsed;
      }
      await markScanned(target.userId, target.type, target.key);
      report.scanned++;
    } catch (err) {
      // Clé Brave absente / quota amont : inutile d'insister ce tick
      report.errors.push(`${target.type}:${target.key}: ${err.message}`);
      if (err.code === 'BRAVE_KEY_MISSING') break;
    }
    if (budgetLeft <= 0) break;
  }

  await consumeBudget(report.queriesUsed);
  if (report.scanned > 0 || report.errors.length > 0) {
    logger.info('signal-scheduler',
      `Tick: ${report.scanned} cibles, ${report.detected} signaux, ${report.queriesUsed} requêtes (budget jour ${DAILY_BUDGET})${report.errors.length ? `, ${report.errors.length} erreurs` : ''}`);
  }
  return report;
}

module.exports = { runTick, boostCompany, collectDueTargets, DAILY_BUDGET };
