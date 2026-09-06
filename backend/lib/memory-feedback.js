/**
 * Memory Feedback Loops — phase 2 de l'audit mémoire du 02/09.
 *
 * Transforme trois gisements de résultats RÉELS en apprentissage :
 *   1. Les verdicts churn humains (churn_outcomes) recalibrent les poids
 *      sectoriels — le « future work » annoncé dans churn-scoring.js.
 *   2. Les réactivations attribuées (deal mort → email causal → gagné)
 *      deviennent des patterns tactiques par tenant.
 *   3. Les signaux registres corrélés au churn effectif deviennent un
 *      pattern global quand la corrélation est établie.
 *
 * Tout est hebdomadaire (Memory Agent du dimanche), volontairement
 * conservateur (échantillons minimaux, pas variés bornés) : un poids qui
 * oscille au gré de 3 verdicts ferait plus de mal que l'absence de réglage.
 */

const db = require('../db');
const logger = require('./logger');

// ── 1. Recalibrage des poids sectoriels depuis les verdicts churn ──

const MIN_VERDICTS_PER_SECTOR = 5;
const WEIGHT_STEP = 0.05;
const WEIGHT_MIN = 0.7;
const WEIGHT_MAX = 1.3;

/**
 * Décision de réglage pour un secteur — fonction pure, testée unitairement.
 * fpRate élevé = on crie au loup → baisser le multiplicateur ;
 * des churns ratés (FN) avec peu de faux positifs = trop timide → monter.
 */
function computeWeightNudge({ truePositives, falsePositives, falseNegatives, current }) {
  const verdicts = truePositives + falsePositives + falseNegatives;
  if (verdicts < MIN_VERDICTS_PER_SECTOR) return null;

  const alarms = truePositives + falsePositives;
  const fpRate = alarms > 0 ? falsePositives / alarms : 0;

  let next = current;
  if (alarms >= MIN_VERDICTS_PER_SECTOR && fpRate >= 0.6) next = current - WEIGHT_STEP;
  else if (fpRate <= 0.2 && falseNegatives >= 2) next = current + WEIGHT_STEP;
  else return null;

  next = Math.round(Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, next)) * 100) / 100;
  return next === current ? null : next;
}

/**
 * Verdicts (180 j) → secteur normalisé du client → ajustement du multiplicateur.
 * Les poids sont GLOBAUX (design de la table sector_churn_weights) : le
 * recalibrage agrège donc tous les tenants — c'est un fait de marché, pas
 * une donnée client, et les seuils d'échantillon le protègent du bruit.
 */
async function recalibrateSectorWeights() {
  const result = { adjusted: [], skipped: 0 };

  const verdicts = await db.query(
    `SELECT co.outcome_type, snc.normalized_sector AS sector
     FROM churn_outcomes co
     JOIN opportunities o ON o.id = co.opportunity_id
     JOIN sector_normalization_cache snc
       ON lower(snc.raw_text) = lower(o.data->>'sector') AND snc.scope = 'client_industry'
     WHERE co.created_at > now() - interval '180 days'
       AND snc.normalized_sector <> 'non_determine'`
  );
  if (verdicts.rows.length === 0) return result;

  const bySector = new Map();
  for (const v of verdicts.rows) {
    if (!bySector.has(v.sector)) bySector.set(v.sector, { truePositives: 0, falsePositives: 0, falseNegatives: 0 });
    const s = bySector.get(v.sector);
    if (v.outcome_type === 'true_positive') s.truePositives++;
    else if (v.outcome_type === 'false_positive') s.falsePositives++;
    else if (v.outcome_type === 'false_negative') s.falseNegatives++;
  }

  for (const [sector, counts] of bySector) {
    const row = await db.query(
      `SELECT multiplier FROM sector_churn_weights WHERE sector = $1 AND scope = 'client_industry'`,
      [sector]
    );
    const current = row.rows[0] ? parseFloat(row.rows[0].multiplier) : 1.0;
    const next = computeWeightNudge({ ...counts, current });
    if (next == null) { result.skipped++; continue; }

    await db.query(
      `INSERT INTO sector_churn_weights (sector, scope, multiplier) VALUES ($1, 'client_industry', $2)
       ON CONFLICT (sector, scope) DO UPDATE SET multiplier = $2`,
      [sector, next]
    );
    result.adjusted.push({ sector, from: current, to: next, ...counts });
    logger.info('memory-feedback',
      `Poids secteur « ${sector} » : ${current} → ${next} (TP:${counts.truePositives} FP:${counts.falsePositives} FN:${counts.falseNegatives})`);

    // Trace le réglage en mémoire (fait global, sans tenant — pool partagé
    // uniquement s'il passe l'anonymiseur ; les noms de secteur sont normalisés).
    try {
      await db.memoryPatterns.replaceOrCreate({
        pattern: `Churn secteur « ${sector} » : pondération ajustée à x${next} d'après les verdicts utilisateurs (${counts.falsePositives} faux positifs, ${counts.truePositives} confirmés, ${counts.falseNegatives} ratés sur 180 j).`,
        category: 'Secteur',
        confidence: 'Moyenne',
        source: 'churn_feedback',
        sectors: [sector],
        data: { sector, from: current, to: next, ...counts },
      });
    } catch (err) {
      logger.warn('memory-feedback', `Pattern churn_feedback non écrit: ${err.message}`);
    }
  }

  return result;
}

// ── 2. Patterns tactiques depuis les réactivations attribuées ──

const MIN_REACTIVATIONS = 3;

async function learnFromReactivations(userId, tenant) {
  const rows = await db.query(
    `SELECT o.deal_value, o.data->>'sector' AS sector, o.reactivated_at, ne.sent_at
     FROM opportunities o
     JOIN nurture_emails ne ON ne.id = o.reactivated_from_email_id
     WHERE o.user_id = $1 AND o.reactivated_at > now() - interval '90 days'
       AND ne.sent_at IS NOT NULL`,
    [userId]
  );
  if (rows.rows.length < MIN_REACTIVATIONS) return null;

  const n = rows.rows.length;
  const values = rows.rows.map(r => Number(r.deal_value)).filter(v => !isNaN(v) && v > 0);
  const avgValue = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const delays = rows.rows
    .map(r => (new Date(r.reactivated_at) - new Date(r.sent_at)) / 86400000)
    .filter(d => d >= 0);
  const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;
  const sectors = [...new Set(rows.rows.map(r => r.sector).filter(Boolean))];

  const pattern = `Réactivation : ${n} deals gagnés après relance sur 90 j`
    + (avgDelay != null ? ` — conversion en moyenne ${avgDelay} j après l'email` : '')
    + (avgValue != null ? `, valeur moyenne ${avgValue.toLocaleString('fr-FR')} €` : '')
    + '. Les deals dormants de ce profil méritent une relance systématique.';

  return db.memoryPatterns.replaceOrCreate({
    ...tenant,
    pattern,
    category: 'Timing',
    confidence: n >= 10 ? 'Haute' : 'Moyenne',
    source: 'reactivation_outcomes',
    sectors,
    data: { count: n, avgValue, avgDelayDays: avgDelay, windowDays: 90 },
  });
}

// ── 3. Corrélation signaux registres ↔ churn effectif ──

const MIN_SIGNAL_OUTCOMES = 5;

async function learnFromRegistrySignals() {
  // Signaux assez vieux pour que l'issue soit observable (30 j), fenêtre 180 j.
  const rows = await db.query(
    `SELECT DISTINCT ON (s.opportunity_id) s.opportunity_id, o.status,
       EXISTS (SELECT 1 FROM churn_outcomes co WHERE co.opportunity_id = s.opportunity_id
               AND co.outcome_type = 'true_positive' AND co.created_at > s.detected_at) AS confirmed_churn
     FROM churn_external_signals s
     JOIN opportunities o ON o.id = s.opportunity_id
     WHERE s.source LIKE 'registry_%'
       AND s.detected_at BETWEEN now() - interval '180 days' AND now() - interval '30 days'`
  );
  if (rows.rows.length < MIN_SIGNAL_OUTCOMES) return null;

  const total = rows.rows.length;
  const churned = rows.rows.filter(r => r.status === 'lost' || r.confirmed_churn).length;
  const rate = churned / total;
  if (rate < 0.5) return null; // corrélation pas (encore) probante — ne rien affirmer

  return db.memoryPatterns.replaceOrCreate({
    pattern: `Signaux registres : ${churned}/${total} clients avec procédure ou insolvabilité détectée ont churné dans les mois suivants — traiter ces alertes en priorité absolue.`,
    category: 'Cible',
    confidence: total >= 15 ? 'Haute' : 'Moyenne',
    source: 'registry_feedback',
    data: { total, churned, rate: Math.round(rate * 100) / 100, windowDays: 180 },
  });
}

module.exports = { recalibrateSectorWeights, learnFromReactivations, learnFromRegistrySignals, computeWeightNudge };
