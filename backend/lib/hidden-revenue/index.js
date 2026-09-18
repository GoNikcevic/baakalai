/**
 * Hidden Revenue Score · orchestration.
 *
 * Répond à une seule question : « combien de chiffre d'affaires ce CRM
 * contient-il aujourd'hui, qui existe déjà et que personne ne va chercher ».
 *
 * Le moteur est déterministe et sans LLM. L'IA générative n'intervient qu'en
 * aval, pour rédiger et coacher, jamais pour produire un montant ou une
 * probabilité : un chiffre qu'on ne peut pas refaire à la main est un chiffre
 * qu'on ne peut pas défendre devant un prospect qui a son CRM ouvert.
 *
 * Périmètre V1 : pipeline dormant et réactivation client, les deux dimensions
 * calculables sur les 7 CRM sans configuration préalable. Expansion et
 * réactivation de leads sont déclarées mais non évaluées, et leur poids est
 * retiré de la moyenne plutôt que compté à zéro (cf. scoring.aggregateScore).
 */

const db = require('../../db');
const logger = require('../logger');
const { getStagnantDays } = require('../stagnation');
const { getLearnedContext } = require('../forecast-engine');
const { recoveryProbability, stageBucket, lostReasonBucket } = require('./probability');
const scoring = require('./scoring');
const detect = require('./detect');

const DAY_MS = 86400000;

/** Part maximale du montant total qu'un seul compte peut représenter. */
const ACCOUNT_CAP_SHARE = 0.15;

/** En dessous de ce nombre de comptes distincts, plafonner déforme plus qu'il
 *  ne protège : un CRM de 6 comptes a le droit d'être concentré. */
const ACCOUNT_CAP_MIN_ACCOUNTS = 10;

/** Nombre de lignes de détail persistées par snapshot. Les agrégats portent
 *  toujours le volume réel, jamais le volume tronqué. */
const MAX_PERSISTED_LINES = 500;

const DIMENSIONS_V1 = ['dormant_pipeline', 'customer_reactivation'];
const DIMENSIONS_DECLARED = Object.keys(scoring.DIMENSION_WEIGHTS);

/**
 * Clé de regroupement d'un compte. La société d'abord : deux contacts de la
 * même société sur le même deal ne sont pas deux opportunités.
 */
function accountKeyOf(row) {
  const company = (row.company || '').trim().toLowerCase();
  if (company) return `c:${company}`;
  const email = (row.email || '').trim().toLowerCase();
  if (email) return `e:${email}`;
  const name = (row.name || '').trim().toLowerCase();
  if (name) return `n:${name}`;
  return `o:${row.id}`;
}

/** Valeur retenue pour un deal · celle du CRM, sinon la médiane des gagnés. */
function resolveValue(row, medians) {
  const original = Number(row.deal_value);
  if (Number.isFinite(original) && original > 0) {
    return { qualifiedValue: original, originalValue: original, estimated: false };
  }
  const bucket = stageBucket(row.crm_stage);
  const fallback = medians.byBucket[bucket] ?? medians.global;
  if (fallback == null || !(fallback > 0)) {
    // Aucun repère : le deal existe et se compte, mais il n'entre dans aucun
    // montant. Mieux vaut un volume honnête qu'un euro inventé.
    return { qualifiedValue: null, originalValue: null, estimated: false };
  }
  return { qualifiedValue: fallback, originalValue: null, estimated: true };
}

/** Un motif de perte reconnu donne son code. Une raison vide ou inconnue en
 *  donne un aussi : toute opportunité doit porter au moins un motif traçable,
 *  et « on ne sait pas pourquoi ce deal est mort » est une information utile,
 *  pas un trou à laisser vide. */
const LOST_REASON_CODES = {
  postponed: 'BUDGET_POSTPONED',
  no_decision: 'NO_DECISION',
  competitor: 'LOST_TO_COMPETITOR',
  price: 'LOST_ON_PRICE',
};

function reasonCodesFor(row, dimension, { estimated, engagement }) {
  const codes = [];
  const bucket = stageBucket(row.crm_stage);

  if (dimension === 'dormant_pipeline') {
    if (row.status === 'lost') {
      const reason = lostReasonBucket(row.lost_reason);
      codes.push(reason ? LOST_REASON_CODES[reason.key] : 'LOST_REASON_UNKNOWN');
      if (bucket === 'late') codes.push('HIGH_STAGE_LOSS');
    } else {
      codes.push(bucket === 'late' ? 'STALE_PROPOSAL' : 'NO_DECISION');
    }
  } else if (dimension === 'customer_reactivation') {
    codes.push('DORMANT_CUSTOMER');
  }

  if (engagement?.positiveReply) codes.push('CONTACT_STILL_ACTIVE');
  else if ((engagement?.unansweredCount || 0) > 0) codes.push('HISTORICAL_ENGAGEMENT');
  if (estimated) codes.push('LOW_DATA_QUALITY');

  return codes;
}

function recommendedActionFor(row, dimension) {
  if (dimension === 'customer_reactivation') return 'reengage_customer';
  return row.status === 'lost' ? 'revive_lost_deal' : 'reactivate_deal';
}

/**
 * Transforme une ligne CRM en candidat scoré. Fonction pure : toutes les
 * dépendances (horloge, contexte appris, médianes, engagement) sont injectées,
 * ce qui la rend testable sans base.
 */
function buildCandidate(row, dimension, { snapshotAt, ctx, medians, engagement }) {
  const lastTouch = row.last_touch || row.created_at;
  const daysQuiet = lastTouch
    ? Math.max(0, (new Date(snapshotAt).getTime() - new Date(lastTouch).getTime()) / DAY_MS)
    : 0;

  const { qualifiedValue, originalValue, estimated } = resolveValue(row, medians);
  const contactable = Boolean(row.email) && !row.email_bounced_at;

  const { probability, factors } = recoveryProbability({
    daysQuiet,
    stage: row.crm_stage,
    status: row.status,
    lostReason: row.lost_reason,
    contactable,
    unansweredCount: engagement?.unansweredCount || 0,
    positiveReply: Boolean(engagement?.positiveReply),
    // Le fit ICP reste non renseigné en V1 : le produit ne stocke aucune
    // définition structurée de la cible, seulement du texte produit par
    // l'agent ICP. Le déduire d'une sortie LLM contaminerait un moteur qui
    // doit rester reproductible.
    icpFit: null,
  }, ctx);

  return {
    opportunityId: row.id,
    accountKey: accountKeyOf(row),
    name: row.name || null,
    company: row.company || null,
    dimension,
    daysQuiet: Math.round(daysQuiet),
    originalValue,
    qualifiedValue,
    valueEstimated: estimated,
    recoveryProbability: probability,
    expectedValue: qualifiedValue != null ? Math.round(qualifiedValue * probability) : 0,
    reasonCodes: reasonCodesFor(row, dimension, { estimated, engagement }),
    factors,
    recommendedAction: recommendedActionFor(row, dimension),
  };
}

/**
 * Dédup et plafonnement de concentration.
 *
 * Un même compte ressort en deal dormant, en client silencieux et en risque de
 * churn : sans dédup le montant affiché compte trois fois le même argent. On
 * garde la meilleure ligne par couple compte-dimension, puis on plafonne ce
 * qu'un seul compte peut peser dans le total, pour qu'un gros deal isolé ne
 * fasse pas à lui seul le chiffre de la page.
 *
 * Le plafond est appliqué SUR LA LIGNE, pas sur l'agrégat : la somme des
 * lignes persistées reste exactement égale au montant affiché, et la ligne
 * porte la raison de son écrêtage.
 */
function dedupeAndCap(candidates, {
  capShare = ACCOUNT_CAP_SHARE,
  minAccounts = ACCOUNT_CAP_MIN_ACCOUNTS,
} = {}) {
  const best = new Map();
  for (const c of candidates) {
    const key = `${c.accountKey}|${c.dimension}`;
    const kept = best.get(key);
    if (!kept || c.expectedValue > kept.expectedValue) best.set(key, c);
  }
  const deduped = [...best.values()];

  const byAccount = new Map();
  for (const c of deduped) {
    byAccount.set(c.accountKey, (byAccount.get(c.accountKey) || 0) + c.expectedValue);
  }

  const total = [...byAccount.values()].reduce((s, v) => s + v, 0);
  let cappedAccounts = 0;

  if (byAccount.size >= minAccounts && total > 0) {
    const cap = total * capShare;
    for (const c of deduped) {
      const accountTotal = byAccount.get(c.accountKey);
      if (accountTotal <= cap) continue;
      const ratio = cap / accountTotal;
      c.expectedValue = Math.round(c.expectedValue * ratio);
      c.factors = [...c.factors, {
        signal: 'account_cap',
        multiplier: Math.round(ratio * 1000) / 1000,
        detail: `Écrêté : un compte ne peut peser plus de ${Math.round(capShare * 100)} % du total`,
      }];
      if (!c.reasonCodes.includes('CONCENTRATION_CAPPED')) c.reasonCodes.push('CONCENTRATION_CAPPED');
    }
    cappedAccounts = [...byAccount.values()].filter(v => v > cap).length;
  }

  // Concentration mesurée APRÈS écrêtage : c'est la part réellement affichée
  // qui intéresse le lecteur, pas celle qu'on a corrigée.
  const finalByAccount = new Map();
  for (const c of deduped) {
    finalByAccount.set(c.accountKey, (finalByAccount.get(c.accountKey) || 0) + c.expectedValue);
  }
  const finalTotal = [...finalByAccount.values()].reduce((s, v) => s + v, 0);
  const topAccount = [...finalByAccount.values()].reduce((m, v) => Math.max(m, v), 0);

  return {
    candidates: deduped,
    duplicatesDropped: candidates.length - deduped.length,
    accountCount: byAccount.size,
    cappedAccounts,
    topAccountShare: finalTotal > 0 ? Math.round((topAccount / finalTotal) * 100) / 100 : 0,
  };
}

/** Agrège les candidats par dimension et en déduit sous-scores et montants. */
function aggregate(candidates, revenueBase) {
  const dimensions = {};

  for (const dim of DIMENSIONS_DECLARED) {
    if (!DIMENSIONS_V1.includes(dim)) {
      // Déclarée mais pas encore mesurée. Son poids est retiré de la moyenne,
      // elle n'est pas comptée zéro : afficher 0 sur une dimension qu'on ne
      // regarde pas ferait croire à une absence d'opportunité.
      dimensions[dim] = { evaluated: false };
      continue;
    }
    const items = candidates.filter(c => c.dimension === dim);
    const qualifiedValue = items.reduce((s, c) => s + (c.qualifiedValue || 0), 0);
    const expectedValue = items.reduce((s, c) => s + c.expectedValue, 0);
    // Les candidats sont contenus dans la base par construction, mais ils sont
    // estimés à la médiane de LEUR étape quand le montant manque, là où la base
    // applique la médiane globale. L'écart est marginal, le plafond le rend
    // impossible à voir.
    const intensity = revenueBase > 0 ? Math.min(1, qualifiedValue / revenueBase) : 0;

    dimensions[dim] = {
      evaluated: true,
      count: items.length,
      countWithoutValue: items.filter(c => c.qualifiedValue == null).length,
      countEstimatedValue: items.filter(c => c.valueEstimated).length,
      qualifiedValue: Math.round(qualifiedValue),
      expectedValue: Math.round(expectedValue),
      intensity: Math.round(intensity * 10000) / 10000,
      subScore: scoring.subScore(intensity),
    };
  }

  return dimensions;
}

/**
 * Calcul complet pour un utilisateur.
 *
 * `snapshotAt` gèle l'horloge : passer une date permet de rejouer exactement un
 * score passé, et garantit qu'un même jeu de données donne toujours le même
 * résultat (critère de reproductibilité du cadrage).
 */
async function computeHiddenRevenue(userId, { snapshotAt = new Date(), persist = true } = {}) {
  const at = new Date(snapshotAt);

  const [stagnantDays, ctx] = await Promise.all([
    getStagnantDays(userId),
    getLearnedContext(userId, { asOf: at }),
  ]);

  const [base, medians, engagementByOpp] = await Promise.all([
    detect.loadBase(userId, at),
    detect.loadWonMedians(userId, at),
    detect.loadEngagement(userId, at),
  ]);

  const [dormant, reactivation] = await Promise.all([
    detect.listDormantPipeline(userId, at, stagnantDays),
    detect.listCustomerReactivation(userId, at),
  ]);

  const shared = { snapshotAt: at, ctx, medians, engagement: null };
  const raw = [
    ...dormant.rows.map(row => buildCandidate(row, 'dormant_pipeline', {
      ...shared, engagement: engagementByOpp.get(row.id),
    })),
    ...reactivation.rows.map(row => buildCandidate(row, 'customer_reactivation', {
      ...shared, engagement: engagementByOpp.get(row.id),
    })),
  ];

  const { candidates, duplicatesDropped, accountCount, cappedAccounts, topAccountShare } = dedupeAndCap(raw);

  // Base de revenu : le volume d'affaires que le CRM porte sur la fenêtre
  // examinée, valorisé avec la même règle que les candidats (montant du CRM,
  // sinon médiane des gagnés). Sans ce dernier terme, un CRM dont la moitié des
  // deals n'ont pas de montant voit son numérateur estimé et son dénominateur
  // amputé, donc une intensité qui dépasse 100 %.
  const revenueBase = base.openValue + base.lostValue + base.wonValue
    + (medians.global > 0 ? base.valuelessCount * medians.global : 0);

  const dimensions = aggregate(candidates, revenueBase);
  const subScores = {};
  for (const [dim, data] of Object.entries(dimensions)) {
    if (data.evaluated) subScores[dim] = data.subScore;
  }
  const { hrs, weights } = scoring.aggregateScore(subScores);
  const { confidence, factors: confidenceFactors } = scoring.confidenceScore(base.coverage);

  const qualifiedValue = candidates.reduce((s, c) => s + (c.qualifiedValue || 0), 0);
  const expectedValue = candidates.reduce((s, c) => s + c.expectedValue, 0);
  const range = scoring.expectedRange(expectedValue, confidence);

  const maxExpected = candidates.reduce((m, c) => Math.max(m, c.expectedValue), 0);
  for (const c of candidates) {
    c.priority = maxExpected > 0 ? Math.max(1, Math.round((c.expectedValue / maxExpected) * 100)) : 0;
  }
  candidates.sort((a, b) => b.expectedValue - a.expectedValue);

  const result = {
    scoreVersion: scoring.SCORE_VERSION,
    snapshotAt: at.toISOString(),
    hrs,
    scoreBand: scoring.scoreBand(hrs),
    confidence,
    confidenceBand: scoring.confidenceBand(confidence),
    // Sous ce seuil de confiance, la page doit parler du trou de données, pas
    // annoncer un montant. Le front décide de l'affichage, le moteur dit ce
    // qu'il sait.
    quantifiable: scoring.isQuantifiable(confidence) && revenueBase > 0,
    qualifiedValue: Math.round(qualifiedValue),
    expectedValue: Math.round(expectedValue),
    expectedLow: range.low,
    expectedHigh: range.high,
    revenueBase: Math.round(revenueBase),
    opportunityCount: candidates.length,
    dimensions,
    confidenceFactors,
    context: {
      winRate: ctx.winRate,
      avgCycleDays: ctx.avgCycleDays,
      wonSample: ctx.wonSample,
      stagnantDays,
      crmContacts: base.total,
      historyMonths: base.historyMonths,
      openValue: Math.round(base.openValue),
      wonValue12m: Math.round(base.wonValue12m),
      dimensionWeights: weights,
      accountCount,
      duplicatesDropped,
      cappedAccounts,
      topAccountShare,
      countWithoutValue: candidates.filter(c => c.qualifiedValue == null).length,
      countEstimatedValue: candidates.filter(c => c.valueEstimated).length,
      spread: range.spread,
      // Vrai si une dimension a buté sur le plafond de volume : le total est
      // alors un plancher, pas un compte exact, et l'écran doit pouvoir le dire.
      truncated: dormant.truncated || reactivation.truncated,
    },
    candidates,
  };

  if (persist) {
    try {
      result.snapshotId = await persistSnapshot(userId, result);
      result.persisted = true;
    } catch (err) {
      if (err.code !== UNDEFINED_TABLE) throw err;
      result.snapshotId = null;
      result.persisted = false;
      logger.warn('hidden-revenue', 'Migration 104 pas encore jouée : score calculé, non persisté');
    }
  }

  return result;
}

/** Code PostgreSQL « la table n'existe pas ». Le moteur peut être déployé avant
 *  que la migration 104 ne soit jouée : dans ce cas il calcule et se tait, au
 *  lieu de remplir les logs d'erreurs jusqu'à l'intervention manuelle. */
const UNDEFINED_TABLE = '42P01';

/** Écrit le snapshot et le détail, puis purge le détail des snapshots précédents. */
async function persistSnapshot(userId, result) {
  const inserted = await db.query(
    `INSERT INTO hidden_revenue_snapshots
       (user_id, score_version, snapshot_at, hrs, confidence, qualified_value, expected_value,
        expected_low, expected_high, revenue_base, opportunity_count, dimensions, confidence_factors, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      userId, result.scoreVersion, result.snapshotAt, result.hrs, result.confidence,
      result.qualifiedValue, result.expectedValue, result.expectedLow, result.expectedHigh,
      result.revenueBase, result.opportunityCount,
      JSON.stringify(result.dimensions), JSON.stringify(result.confidenceFactors),
      JSON.stringify(result.context),
    ]
  );
  const snapshotId = inserted.rows[0].id;

  const lines = result.candidates.slice(0, MAX_PERSISTED_LINES);
  const COLUMNS = 14;
  const BATCH = 100;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH);
    const values = batch.map((_, idx) => {
      const p = idx * COLUMNS;
      return `($${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}::jsonb, $${p + 13}, $${p + 14})`;
    }).join(', ');
    const params = batch.flatMap(c => [
      userId, snapshotId, c.opportunityId, c.accountKey, c.dimension,
      c.originalValue, c.qualifiedValue, c.valueEstimated, c.recoveryProbability,
      c.expectedValue, c.priority, JSON.stringify(c.factors), c.reasonCodes, c.recommendedAction,
    ]);
    await db.query(
      `INSERT INTO hidden_revenue_opportunities
         (user_id, snapshot_id, opportunity_id, account_key, dimension,
          original_value, qualified_value, value_estimated, recovery_probability,
          expected_value, priority, factors, reason_codes, recommended_action)
       VALUES ${values}`,
      params
    );
  }

  if (lines.length < result.candidates.length) {
    logger.info('hidden-revenue', `User ${userId}: ${result.candidates.length} candidats, ${lines.length} lignes de détail persistées (plafond ${MAX_PERSISTED_LINES})`);
  }

  // Le détail n'a aucune valeur historique : il est recalculé à chaque passage
  // depuis les données vivantes. Seuls les agrégats portent la courbe.
  await db.query(
    `DELETE FROM hidden_revenue_opportunities WHERE user_id = $1 AND snapshot_id <> $2`,
    [userId, snapshotId]
  );

  return snapshotId;
}

/** Dernier snapshot connu d'un utilisateur, agrégats seulement. */
async function getLatestSnapshot(userId) {
  const r = await db.query(
    `SELECT * FROM hidden_revenue_snapshots
     WHERE user_id = $1 ORDER BY snapshot_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

module.exports = {
  computeHiddenRevenue,
  getLatestSnapshot,
  buildCandidate,
  dedupeAndCap,
  aggregate,
  accountKeyOf,
  resolveValue,
  ACCOUNT_CAP_SHARE,
  ACCOUNT_CAP_MIN_ACCOUNTS,
  MAX_PERSISTED_LINES,
  DIMENSIONS_V1,
};
