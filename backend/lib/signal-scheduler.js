/**
 * Signal Scheduler — file tournante continue, sous quota.
 *
 * Remplace le batch unique du matin : un tick toutes les 30 minutes prend les
 * cibles les plus « dues » (priorité × ancienneté) dans une file unifiée
 * configs actives + sociétés du CRM, et s'arrête quand le budget Brave du
 * jour est consommé. Plus d'utilisateurs = la file tourne moins vite au lieu
 * d'exploser le quota au pic de 8 h.
 *
 * Cadences cibles (l'ancienneté fait monter tout le monde — pas de famine),
 * dérivées de users.signal_scan_frequency ('off' = jamais scanné auto) :
 *   - société chaude : 24 h (hebdo) / 12 h (quotidien) — l'urgence temps réel
 *     reste couverte par le boost webhook, Brave cherche sur la semaine écoulée
 *   - config active : ~12 h (2×/jour — avant : jamais scannée automatiquement)
 *   - société standard : 7 j (hebdo) / 3 j (quotidien)
 *
 * Compte « chaud » : boost webhook, churn >= seuil à risque, lead score >= 70,
 * ou deal ouvert dormant 30 j+ dans le top 30 % des valeurs du pipeline DE CE
 * user (le seuil absolu 10 k€ sur-scannait les gros comptes et ignorait les
 * pipelines modestes).
 */

const db = require('../db');
const logger = require('./logger');
const { AT_RISK_THRESHOLD } = require('./churn-scoring');

const MONTHLY_QUOTA = parseInt(process.env.BRAVE_MONTHLY_QUOTA || '2000', 10);
// 80 % du quota pour le scheduler — la réserve couvre les scans manuels
// (bouton « Lancer le scan ») et le scan hebdo churn du dimanche.
const DAILY_BUDGET = Math.max(5, Math.floor((MONTHLY_QUOTA / 31) * 0.8));

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CADENCES = {
  weekly: { companyHot: 24 * HOUR_MS, companyStandard: 7 * DAY_MS, config: 12 * HOUR_MS },
  daily: { companyHot: 12 * HOUR_MS, companyStandard: 3 * DAY_MS, config: 12 * HOUR_MS },
};
const HOT_LEAD_SCORE = 70;
const HOT_DORMANT_DAYS = 30;
const HOT_VALUE_RANK = 0.7; // percent_rank >= 0.7 = top 30 % du pipeline du user

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

async function loadUserBudgets() {
  const r = await db.query(`SELECT user_id, used FROM signal_scan_user_budget WHERE day = CURRENT_DATE`);
  return new Map(r.rows.map(row => [row.user_id, row.used]));
}

async function consumeUserBudget(userId, queries) {
  if (queries <= 0) return;
  await db.query(
    `INSERT INTO signal_scan_user_budget (day, user_id, used) VALUES (CURRENT_DATE, $1, $2)
     ON CONFLICT (day, user_id) DO UPDATE SET used = signal_scan_user_budget.used + $2`,
    [userId, queries]
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

  // Configs actives des utilisateurs onboardés (veille auto non coupée)
  const configs = await db.query(
    `SELECT c.id, c.user_id, u.signal_scan_frequency AS frequency,
            s.last_scanned_at, s.boost_until,
            COALESCE(array_length(c.signal_types, 1), 3) AS n_types
     FROM signal_configs c
     JOIN users u ON u.id = c.user_id AND u.onboarding_complete = true
       AND u.signal_scan_frequency <> 'off'
     LEFT JOIN signal_scan_state s ON s.user_id = c.user_id AND s.target_type = 'config' AND s.target_key = c.id::text
     WHERE c.enabled = true`
  );
  for (const c of configs.rows) {
    const cadence = CADENCES[c.frequency] || CADENCES.weekly;
    const age = c.last_scanned_at ? Date.now() - new Date(c.last_scanned_at).getTime() : Infinity;
    const ratio = age / cadence.config;
    if (ratio < 1) continue;
    targets.push({
      type: 'config', userId: c.user_id, key: String(c.id),
      cost: Math.min(c.n_types, 9), score: ratio,
      boosted: false,
    });
  }

  // Sociétés du CRM (une cible par société et par utilisateur).
  // value_rank : position de la société dans les valeurs de deals de SON user
  // (percent_rank sur l'agrégat — fenêtre évaluée après le GROUP BY).
  const companies = await db.query(
    `SELECT o.user_id, lower(trim(o.company)) AS company_key,
            u.signal_scan_frequency AS frequency,
            max(o.churn_score) AS churn, max(o.deal_value) AS deal_value,
            max(o.score) AS lead_score,
            bool_or(o.status <> 'won') AS has_open,
            (EXTRACT(EPOCH FROM (now() - max(COALESCE(o.last_activity_at, o.created_at)))) / 86400)::int AS days_dormant,
            percent_rank() OVER (PARTITION BY o.user_id ORDER BY max(o.deal_value) ASC NULLS FIRST) AS value_rank,
            s.last_scanned_at, s.boost_until
     FROM opportunities o
     JOIN users u ON u.id = o.user_id AND u.onboarding_complete = true
       AND u.signal_scan_frequency <> 'off'
     LEFT JOIN signal_scan_state s ON s.user_id = o.user_id AND s.target_type = 'company' AND s.target_key = lower(trim(o.company))
     WHERE o.company IS NOT NULL AND trim(o.company) <> '' AND o.status <> 'lost'
     GROUP BY o.user_id, lower(trim(o.company)), u.signal_scan_frequency, s.last_scanned_at, s.boost_until`
  );
  for (const c of companies.rows) {
    const cadence = CADENCES[c.frequency] || CADENCES.weekly;
    const boosted = c.boost_until && new Date(c.boost_until).getTime() > Date.now();
    const dormantValuable = c.has_open && c.days_dormant >= HOT_DORMANT_DAYS && Number(c.value_rank) >= HOT_VALUE_RANK;
    const hot = boosted
      || (c.churn != null && c.churn >= AT_RISK_THRESHOLD)
      || (c.lead_score != null && c.lead_score >= HOT_LEAD_SCORE)
      || dormantValuable;
    const interval = hot ? cadence.companyHot : cadence.companyStandard;
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

  // Équité : plafond quotidien par user = part proportionnelle × 2 (marge).
  // Un CRM de 500 sociétés ne peut plus affamer les autres comptes ; le
  // budget qu'un user ne consomme pas reste disponible pour la file globale.
  const activeUsers = new Set(targets.map(t => t.userId)).size;
  const userDailyCap = Math.max(3, Math.ceil((DAILY_BUDGET / activeUsers) * 2));
  const userUsed = await loadUserBudgets();
  const userSpentThisTick = new Map();

  const signalAgent = require('./agents/signal-agent');
  // Caches par user pour ne pas recharger les sets de dédup à chaque cible
  const configSets = new Map();
  const companySets = new Map();

  let budgetLeft = tickCap;
  for (const target of targets) {
    if (target.cost > budgetLeft) continue; // essaie une cible moins chère plus bas dans la file
    if ((userUsed.get(target.userId) || 0) + target.cost > userDailyCap) continue; // plafond user atteint
    try {
      if (target.type === 'config') {
        const cfg = await db.query(`SELECT * FROM signal_configs WHERE id = $1 AND enabled = true`, [target.key]);
        if (!cfg.rows[0]) { await markScanned(target.userId, 'config', target.key); continue; }
        if (!configSets.has(target.userId)) configSets.set(target.userId, await signalAgent.loadConfigRecentSet(target.userId));
        const { detected, queriesUsed } = await signalAgent.scanConfig(target.userId, cfg.rows[0], configSets.get(target.userId));
        report.detected += detected;
        report.queriesUsed += queriesUsed;
        budgetLeft -= queriesUsed;
        userUsed.set(target.userId, (userUsed.get(target.userId) || 0) + queriesUsed);
        userSpentThisTick.set(target.userId, (userSpentThisTick.get(target.userId) || 0) + queriesUsed);
      } else {
        const acct = await signalAgent.loadCompanyAccount(target.userId, target.key);
        if (!acct) { await markScanned(target.userId, 'company', target.key); continue; }
        if (!companySets.has(target.userId)) companySets.set(target.userId, await signalAgent.loadCrmWatchRecentSet(target.userId));
        const { detected, queriesUsed } = await signalAgent.scanCompanyAccount(target.userId, acct, companySets.get(target.userId));
        report.detected += detected;
        report.queriesUsed += queriesUsed;
        budgetLeft -= queriesUsed;
        userUsed.set(target.userId, (userUsed.get(target.userId) || 0) + queriesUsed);
        userSpentThisTick.set(target.userId, (userSpentThisTick.get(target.userId) || 0) + queriesUsed);
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
  for (const [userId, queries] of userSpentThisTick) {
    await consumeUserBudget(userId, queries).catch(err =>
      logger.warn('signal-scheduler', `budget user ${userId}: ${err.message}`));
  }
  if (report.scanned > 0 || report.errors.length > 0) {
    logger.info('signal-scheduler',
      `Tick: ${report.scanned} cibles, ${report.detected} signaux, ${report.queriesUsed} requêtes (budget jour ${DAILY_BUDGET})${report.errors.length ? `, ${report.errors.length} erreurs` : ''}`);
  }
  return report;
}

module.exports = { runTick, boostCompany, collectDueTargets, DAILY_BUDGET };
