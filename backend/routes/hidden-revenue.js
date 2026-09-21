/**
 * Hidden Revenue Score · lecture et recalcul à la demande.
 *
 * GET  /api/hidden-revenue           dernier snapshot + historique pour la courbe
 * POST /api/hidden-revenue/refresh   recalcule maintenant et renvoie le résultat
 *
 * Le calcul quotidien reste le fait de l'agent CRM (Step 5d) : ces routes ne
 * font que lire ce qu'il a posé, et offrir un recalcul manuel pour les cas où
 * l'utilisateur vient de synchroniser et ne veut pas attendre le lendemain.
 *
 * Le détail ligne à ligne n'est pas exposé ici. Il vit dans les écrans qui
 * agissent dessus (deals à relancer, clients), et les servir une seconde fois
 * sous une autre forme créerait une deuxième vérité à maintenir.
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');

const router = Router();

/** Nombre de photos renvoyées pour la courbe. Une par passage de l'agent, donc
 *  environ trois mois de recul quotidien. */
const HISTORY_LIMIT = 90;

/** Met un snapshot en base au format attendu par le front. */
function toPayload(row) {
  if (!row) return null;
  return {
    scoreVersion: row.score_version,
    snapshotAt: row.snapshot_at,
    hrs: row.hrs,
    confidence: row.confidence,
    quantifiable: Number(row.revenue_base) > 0 && row.confidence >= 35,
    qualifiedValue: Number(row.qualified_value),
    expectedValue: Number(row.expected_value),
    expectedLow: Number(row.expected_low),
    expectedHigh: Number(row.expected_high),
    revenueBase: Number(row.revenue_base),
    opportunityCount: row.opportunity_count,
    dimensions: row.dimensions,
    confidenceFactors: row.confidence_factors,
    context: row.context,
  };
}

/**
 * Delta par rapport à la photo la plus proche d'une semaine en arrière.
 *
 * Le sens de lecture n'est pas celui d'un tableau de bord habituel : un score
 * qui BAISSE est une bonne nouvelle, la réserve se vide parce qu'on l'a
 * travaillée. Le front a besoin de l'écart brut, il choisit les mots.
 */
function weekDelta(history) {
  if (history.length < 2) return null;
  const latest = history[0];
  const target = new Date(latest.snapshot_at).getTime() - 7 * 86400000;
  let closest = null;
  for (const row of history.slice(1)) {
    const gap = Math.abs(new Date(row.snapshot_at).getTime() - target);
    if (!closest || gap < closest.gap) closest = { row, gap };
  }
  if (!closest) return null;
  return {
    since: closest.row.snapshot_at,
    hrs: latest.hrs - closest.row.hrs,
    expectedValue: Math.round(Number(latest.expected_value) - Number(closest.row.expected_value)),
  };
}

/**
 * Revenu réellement récupéré · le seul chiffre qui valide rétroactivement tout
 * l'édifice.
 *
 * Définition volontairement stricte : un deal signé APRÈS que baakalai l'a
 * relancé. `reactivated_at` est posé au moment de l'envoi de la relance, et on
 * exige que la signature lui soit postérieure. Sans cette condition d'ordre, on
 * s'attribuerait des deals que le commercial avait déjà conclus.
 */
async function recoveredRevenue(userId) {
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS deals,
              COALESCE(SUM(deal_value), 0)::float AS value
       FROM opportunities
       WHERE user_id = $1
         AND status = 'won'
         AND reactivated_at IS NOT NULL
         AND won_date IS NOT NULL
         AND won_date > reactivated_at`,
      [userId]
    );
    return { deals: r.rows[0].deals, value: Math.round(r.rows[0].value) };
  } catch {
    return { deals: 0, value: 0 };
  }
}

router.get('/', async (req, res, next) => {
  try {
    const history = await db.query(
      `SELECT id, score_version, snapshot_at, hrs, confidence, qualified_value, expected_value,
              expected_low, expected_high, revenue_base, opportunity_count,
              dimensions, confidence_factors, context
       FROM hidden_revenue_snapshots
       WHERE user_id = $1
       ORDER BY snapshot_at DESC
       LIMIT $2`,
      [req.user.id, HISTORY_LIMIT]
    );

    res.json({
      latest: toPayload(history.rows[0]),
      delta: weekDelta(history.rows),
      recovered: await recoveredRevenue(req.user.id),
      history: history.rows.map(r => ({
        snapshotAt: r.snapshot_at,
        hrs: r.hrs,
        expectedValue: Number(r.expected_value),
      })).reverse(),
    });
  } catch (err) {
    // La migration 104 peut ne pas être jouée sur cet environnement : le front
    // doit pouvoir masquer la section plutôt que d'afficher une erreur.
    if (err.code === '42P01') return res.json({ latest: null, delta: null, recovered: { deals: 0, value: 0 }, history: [] });
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { computeHiddenRevenue } = require('../lib/hidden-revenue');
    const result = await computeHiddenRevenue(req.user.id, { snapshotAt: new Date() });
    logger.info('hidden-revenue', `Recalcul manuel user ${req.user.id} : HRS ${result.hrs}, ${result.opportunityCount} opportunités`);
    res.json({
      latest: {
        scoreVersion: result.scoreVersion,
        snapshotAt: result.snapshotAt,
        hrs: result.hrs,
        confidence: result.confidence,
        quantifiable: result.quantifiable,
        qualifiedValue: result.qualifiedValue,
        expectedValue: result.expectedValue,
        expectedLow: result.expectedLow,
        expectedHigh: result.expectedHigh,
        revenueBase: result.revenueBase,
        opportunityCount: result.opportunityCount,
        dimensions: result.dimensions,
        confidenceFactors: result.confidenceFactors,
        context: result.context,
      },
      persisted: result.persisted !== false,
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.toPayload = toPayload;
module.exports.weekDelta = weekDelta;
