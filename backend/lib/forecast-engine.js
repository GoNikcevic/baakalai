/**
 * Forecast Engine — probabilités par deal calibrées sur l'historique réel.
 *
 * Remplace la projection « probabilité par stage » par une probabilité PAR
 * DEAL dérivée de ce que le système sait déjà du tenant :
 *   - taux de conversion historique réel (base)
 *   - âge du deal vs cycle de vente appris (un deal à 1.5× le cycle moyen
 *     n'a objectivement plus ses chances d'origine)
 *   - activité réelle récente (last_activity_at, pas updated_at)
 *   - lead score persisté quand il existe
 *   - facteur de calibration appris : chaque photo hebdo est comparée aux
 *     résultats réels 30+ jours plus tard, l'écart corrige les suivants.
 *
 * Catégories dirigeant : Commit (>= 0.7) / Probable (0.4-0.7) / Possible (< 0.4).
 * Scénarios : prudent (commit seul), pondéré (Σ valeur × prob × calibration),
 * optimiste (commit + probable à pleine valeur).
 */

const db = require('../db');
const logger = require('./logger');

const DAY_MS = 86400000;
const COMMIT_THRESHOLD = 0.7;
const PROBABLE_THRESHOLD = 0.4;
const CALIBRATION_SOURCE = 'forecast_calibration';

/**
 * Probabilité d'un deal ouvert — fonction pure, testée unitairement.
 * ctx : { winRate, avgCycleDays, calibration } (calibration appliquée par
 * l'appelant sur le scénario pondéré, pas ici — les catégories restent brutes).
 */
function computeDealProbability(deal, ctx = {}) {
  const now = Date.now();
  const winRate = ctx.winRate != null ? ctx.winRate : 0.35;

  // Base : le taux de conversion réel du tenant, relevé par le lead score
  // quand il existe (score 80 → nettement au-dessus de la base).
  let p = winRate;
  if (deal.score != null && !isNaN(Number(deal.score))) {
    const s = Math.max(0, Math.min(100, Number(deal.score)));
    p = winRate * 0.5 + (s / 100) * 0.7;
  }

  // Âge vs cycle appris : passé le cycle moyen, chaque demi-cycle
  // supplémentaire dégrade fortement (le pattern « les deals perdus stagnent
  // ~1 cycle avant d'être clos » est la réalité mesurée du produit).
  const avgCycle = Math.max(14, ctx.avgCycleDays || 90);
  const ageDays = deal.created_at ? (now - new Date(deal.created_at).getTime()) / DAY_MS : 0;
  const cycleRatio = ageDays / avgCycle;
  if (cycleRatio >= 2) p *= 0.25;
  else if (cycleRatio >= 1.5) p *= 0.45;
  else if (cycleRatio >= 1) p *= 0.7;

  // Activité réelle : un deal qui vit récemment vaut plus que son âge ne le
  // laisse croire ; un deal muet depuis 30+ jours vaut moins.
  const lastActivity = deal.last_activity_at || deal.created_at;
  const quietDays = lastActivity ? (now - new Date(lastActivity).getTime()) / DAY_MS : 999;
  if (quietDays <= 7) p *= 1.2;
  else if (quietDays > 45) p *= 0.5;
  else if (quietDays > 21) p *= 0.75;

  // Date de relance planifiée dans le futur = deal vivant et piloté.
  if (deal.planned_followup_date && new Date(deal.planned_followup_date).getTime() > now) p *= 1.1;

  return Math.round(Math.min(0.95, Math.max(0.03, p)) * 100) / 100;
}

function categorize(probability) {
  if (probability >= COMMIT_THRESHOLD) return 'commit';
  if (probability >= PROBABLE_THRESHOLD) return 'probable';
  return 'possible';
}

/**
 * Contexte appris du tenant : cycle réel, taux de conversion réel,
 * calibration mémorisée. Calculé depuis la base (pas depuis le texte des
 * patterns — plus robuste), fallbacks neutres si l'historique manque.
 */
async function getLearnedContext(userId) {
  const ctx = { winRate: null, avgCycleDays: null, calibration: 1.0, wonSample: 0 };
  try {
    const hist = await db.query(
      `SELECT
         count(*) FILTER (WHERE status = 'won') AS won,
         count(*) FILTER (WHERE status = 'lost') AS lost,
         AVG(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400)
           FILTER (WHERE status = 'won' AND won_date IS NOT NULL AND won_date > created_at) AS avg_cycle
       FROM opportunities
       WHERE user_id = $1 AND COALESCE(won_date, lost_date, updated_at) > now() - interval '365 days'`,
      [userId]
    );
    const h = hist.rows[0];
    const won = parseInt(h.won, 10) || 0;
    const lost = parseInt(h.lost, 10) || 0;
    ctx.wonSample = won;
    if (won + lost >= 5) ctx.winRate = Math.round((won / (won + lost)) * 100) / 100;
    if (h.avg_cycle != null && won >= 3) ctx.avgCycleDays = Math.round(Number(h.avg_cycle));
  } catch { /* fallbacks neutres */ }

  try {
    const cal = await db.query(
      `SELECT data FROM memory_patterns
       WHERE source = $1 AND dismissed_at IS NULL
         AND (user_id = $2 OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $2))
       ORDER BY COALESCE(last_confirmed_at, created_at) DESC LIMIT 1`,
      [CALIBRATION_SOURCE, userId]
    );
    const factor = cal.rows[0]?.data?.factor;
    // Garde-fou : une calibration hors [0.4, 1.5] signale un échantillon
    // dégénéré, pas un biais réel — on ne l'applique pas.
    if (factor != null && factor >= 0.4 && factor <= 1.5) ctx.calibration = factor;
  } catch { /* neutre */ }

  return ctx;
}

/**
 * Forecast complet d'un utilisateur.
 */
async function computeForecast(userId) {
  const ctx = await getLearnedContext(userId);
  const open = await db.query(
    `SELECT id, name, company, status, deal_value, score, created_at, last_activity_at, planned_followup_date
     FROM opportunities
     WHERE user_id = $1 AND status NOT IN ('won', 'lost') AND deal_value IS NOT NULL AND deal_value > 0`,
    [userId]
  );

  const deals = open.rows.map(d => {
    const probability = computeDealProbability(d, ctx);
    return {
      id: d.id, name: d.name, company: d.company, value: Number(d.deal_value),
      probability, category: categorize(probability),
    };
  }).sort((a, b) => b.value * b.probability - a.value * a.probability);

  const sum = (arr, fn) => Math.round(arr.reduce((acc, d) => acc + fn(d), 0));
  const commitDeals = deals.filter(d => d.category === 'commit');
  const probableDeals = deals.filter(d => d.category === 'probable');

  return {
    deals,
    scenarios: {
      commit: sum(commitDeals, d => d.value),
      weighted: Math.round(deals.reduce((acc, d) => acc + d.value * d.probability, 0) * ctx.calibration),
      optimistic: sum([...commitDeals, ...probableDeals], d => d.value),
    },
    counts: {
      commit: commitDeals.length,
      probable: probableDeals.length,
      possible: deals.length - commitDeals.length - probableDeals.length,
    },
    context: {
      winRate: ctx.winRate, avgCycleDays: ctx.avgCycleDays,
      calibration: ctx.calibration, wonSample: ctx.wonSample,
      // Honnêteté d'affichage : sans historique suffisant, le front doit le dire.
      reliable: ctx.winRate != null && ctx.avgCycleDays != null,
    },
  };
}

/**
 * Photo hebdomadaire (lundi, job digest) — matière première de la calibration.
 */
async function takeSnapshot(userId) {
  const f = await computeForecast(userId);
  if (f.deals.length === 0) return null;
  await db.query(
    `INSERT INTO forecast_snapshots (user_id, commit_value, weighted_value, optimistic_value, calibration_applied, deals)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, f.scenarios.commit, f.scenarios.weighted, f.scenarios.optimistic,
     f.context.calibration, JSON.stringify(f.deals.map(d => ({ id: d.id, value: d.value, probability: d.probability })))]
  );
  return f.scenarios;
}

/**
 * Calibration (dimanche, Memory Agent) : photos de 30 à 180 jours comparées
 * aux résultats réels. factor = réalisé / prédit sur les deals RÉSOLUS
 * (won ou lost) — les deals encore ouverts ne comptent ni au numérateur ni
 * au dénominateur, sinon un cycle long lirait comme une surestimation.
 */
async function calibrate(userId, tenant = {}) {
  const snaps = await db.query(
    `SELECT id, deals FROM forecast_snapshots
     WHERE user_id = $1 AND evaluated_at IS NULL
       AND taken_at BETWEEN now() - interval '180 days' AND now() - interval '30 days'`,
    [userId]
  );
  if (snaps.rows.length === 0) return null;

  let predicted = 0;
  let realized = 0;
  let resolved = 0;
  for (const snap of snaps.rows) {
    const ids = (snap.deals || []).map(d => d.id);
    if (ids.length === 0) continue;
    const outcomes = await db.query(
      `SELECT id, status, deal_value FROM opportunities WHERE id = ANY($1) AND status IN ('won', 'lost')`,
      [ids]
    );
    const byId = new Map(outcomes.rows.map(o => [o.id, o]));
    for (const d of snap.deals) {
      const o = byId.get(d.id);
      if (!o) continue; // toujours ouvert — hors du calcul
      resolved++;
      predicted += d.value * d.probability;
      if (o.status === 'won') realized += Number(o.deal_value || d.value);
    }
  }
  if (resolved < 5 || predicted <= 0) return null; // pas assez de matière pour juger

  const factor = Math.round((realized / predicted) * 100) / 100;
  await db.query(
    `UPDATE forecast_snapshots SET evaluated_at = now()
     WHERE user_id = $1 AND evaluated_at IS NULL
       AND taken_at BETWEEN now() - interval '180 days' AND now() - interval '30 days'`,
    [userId]
  );

  const direction = factor < 0.95 ? `surestiment de ${Math.round((1 - factor) * 100)} %`
    : factor > 1.05 ? `sous-estiment de ${Math.round((factor - 1) * 100)} %`
    : 'sont bien calibrés';
  await db.memoryPatterns.replaceOrCreate({
    ...tenant,
    pattern: `Forecast : vos prévisions pondérées ${direction} (mesuré sur ${resolved} deals résolus) — facteur de correction x${factor} appliqué automatiquement.`,
    category: 'Pipeline',
    confidence: resolved >= 15 ? 'Haute' : 'Moyenne',
    source: CALIBRATION_SOURCE,
    data: { factor, resolved, predicted: Math.round(predicted), realized: Math.round(realized) },
  }).catch(err => logger.warn('forecast-engine', `Pattern calibration non écrit: ${err.message}`));

  logger.info('forecast-engine', `User ${userId}: calibration x${factor} (${resolved} deals résolus)`);
  return { factor, resolved };
}

module.exports = { computeForecast, computeDealProbability, takeSnapshot, calibrate, getLearnedContext };
