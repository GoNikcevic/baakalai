/**
 * Hidden Revenue Score sur une lecture directe du CRM, sans compte.
 *
 * L'audit public lit les deals par l'API du fournisseur, calcule, et jette le
 * token. Rien n'est importé en base, donc le moteur ne peut pas passer par ses
 * requêtes habituelles. Ce module fait l'adaptation, puis appelle exactement le
 * même assemblage que le produit (`assemble` dans ./index.js).
 *
 * C'est la contrainte structurante : l'audit et l'application doivent annoncer
 * le même chiffre. Un écart entre la page qui a convaincu quelqu'un et le
 * produit qu'il découvre juste après détruirait la confiance au pire moment.
 *
 * Deux choses que cette surface ne sait PAS lire, et qu'elle déclare comme
 * telles plutôt que de les compter à zéro :
 *
 *   - la contactabilité : l'audit ne récupère aucune adresse email. Compter
 *     tout le monde injoignable appliquerait une décote de 0,35 à chaque
 *     ligne, et l'audit annoncerait le tiers du montant que le produit montre
 *     pour le même CRM.
 *   - les raisons de perte : même raisonnement, sur le critère de confiance.
 *
 * Les deux sont retirés du calcul de confiance, qui se renormalise sur ce qui
 * reste mesurable.
 */

const { DEFAULT_STAGNANT_DAYS } = require('../stagnation');
const { SILENT_CLIENT_DAYS, LOST_LOOKBACK_MONTHS, HISTORY_TARGET_MONTHS, VOLUME_TARGET_CLOSED } = require('./detect');

const DAY_MS = 86400000;
const MONTH_DAYS = 30.44;

/** Critères de confiance qu'une lecture par API du CRM peut réellement mesurer. */
const MEASURABLE_CONFIDENCE = [
  'amountCoverage',
  'activityCoverage',
  'historyDepth',
  'volume',
  'statusCoherence',
];

/** Volume maximal analysé · au delà, le total affiché devient un plancher. */
const MAX_DEALS = 5000;

/**
 * Passe du deal renvoyé par l'API du CRM à la ligne que le moteur attend.
 * `listDealsForDiagnostic` donne la même forme chez les trois fournisseurs :
 * { name, company, value, currency, status, addTime, lastActivity }.
 */
function toRow(deal, index) {
  const created = deal.addTime ? new Date(deal.addTime) : null;
  const lastTouch = deal.lastActivity ? new Date(deal.lastActivity) : created;
  const value = Number(deal.value);
  return {
    id: `public-${index}`,
    name: deal.name || null,
    company: deal.company || null,
    status: deal.status || 'open',
    deal_value: Number.isFinite(value) && value > 0 ? value : null,
    // Aucune de ces trois informations n'est récupérée par l'audit public.
    // `contactable: null` dit explicitement « je ne sais pas », ce qui évite la
    // décote automatique d'un champ simplement absent.
    crm_stage: null,
    lost_reason: null,
    contactable: null,
    created_at: created,
    last_touch: lastTouch,
  };
}

/** Médiane, pour la valeur de repli des deals que le CRM laisse vides. */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const isOpen = (r) => r.status !== 'won' && r.status !== 'lost';
const olderThan = (date, at, days) => date != null && (at.getTime() - new Date(date).getTime()) / DAY_MS >= days;
const within = (date, at, months) =>
  date != null && (at.getTime() - new Date(date).getTime()) / DAY_MS <= months * MONTH_DAYS;

/**
 * Base de revenu et couvertures, mêmes définitions que `detect.loadBase` mais
 * calculées en mémoire. Les trois populations couvrent exactement celles d'où
 * les candidats sont tirés, sans quoi l'intensité n'est une part de rien.
 */
function buildBase(rows, at) {
  const inWindow = (r) => within(r.last_touch, at, LOST_LOOKBACK_MONTHS);
  const open = rows.filter(isOpen);
  const lost = rows.filter(r => r.status === 'lost' && inWindow(r));
  const won = rows.filter(r => r.status === 'won' && inWindow(r));

  const sumValues = (list) => list.reduce((s, r) => s + (r.deal_value || 0), 0);
  const countValueless = (list) => list.filter(r => r.deal_value == null).length;

  const wonAll = rows.filter(r => r.status === 'won');
  const lostAll = rows.filter(r => r.status === 'lost');
  const closed = wonAll.length + lostAll.length;
  const total = rows.length;
  const ratio = (n) => (total > 0 ? n / total : 0);

  const oldest = rows.reduce((min, r) => {
    const d = r.last_touch || r.created_at;
    if (!d) return min;
    const t = new Date(d).getTime();
    return min == null || t < min ? t : min;
  }, null);
  const historyMonths = oldest ? (at.getTime() - oldest) / DAY_MS / MONTH_DAYS : 0;

  return {
    total,
    openValue: sumValues(open),
    lostValue: sumValues(lost),
    wonValue: sumValues(won),
    wonValue12m: sumValues(rows.filter(r => r.status === 'won' && within(r.last_touch, at, 12))),
    valuelessCount: countValueless(open) + countValueless(lost) + countValueless(won),
    wonCount: wonAll.length,
    lostCount: lostAll.length,
    historyMonths: Math.round(historyMonths * 10) / 10,
    coverage: {
      amountCoverage: ratio(rows.filter(r => r.deal_value != null).length),
      activityCoverage: ratio(rows.filter(r => r.last_touch != null).length),
      historyDepth: Math.min(1, historyMonths / HISTORY_TARGET_MONTHS),
      volume: Math.min(1, closed / VOLUME_TARGET_CLOSED),
      statusCoherence: total > 0
        ? Math.max(0, 1 - open.filter(r => olderThan(r.created_at, at, 365 * 3)).length / total)
        : 0,
    },
  };
}

/**
 * Score complet depuis une liste de deals lue par API.
 *
 * `stagnantDays` vaut le défaut produit : l'audit public n'a pas d'utilisateur,
 * donc pas de seuil réglé. C'est la même valeur de départ que celle proposée
 * dans l'application, si bien qu'un visiteur qui crée son compte retrouve le
 * même chiffre tant qu'il ne touche pas au réglage.
 */
function computeFromDeals(deals, { snapshotAt = new Date(), stagnantDays = DEFAULT_STAGNANT_DAYS } = {}) {
  const { buildCandidate, assemble } = require('./index');
  const at = new Date(snapshotAt);

  const truncated = deals.length > MAX_DEALS;
  const rows = deals.slice(0, MAX_DEALS).map(toRow);

  const wonValues = rows
    .filter(r => r.status === 'won' && r.deal_value != null)
    .map(r => r.deal_value);
  const medians = {
    sample: wonValues.length,
    global: median(wonValues),
    // Aucun libellé d'étape n'est récupéré, donc pas de médiane par étape.
    byBucket: { late: null, early: null, unknown: null },
  };

  const base = buildBase(rows, at);

  // Contexte appris, en mémoire : le taux de conversion réel du CRM lu. Sous
  // cinq deals conclus, on reste sur le taux par défaut plutôt que d'ériger
  // trois anecdotes en statistique.
  const closed = base.wonCount + base.lostCount;
  const ctx = {
    winRate: closed >= 5 ? Math.round((base.wonCount / closed) * 100) / 100 : null,
    // Le cycle de vente ne se calcule pas ici : l'audit n'a pas de date de
    // signature distincte de la dernière activité. Le moteur retombe sur son
    // défaut, comme il le fait déjà pour les CRM importés.
    avgCycleDays: null,
    wonSample: base.wonCount,
  };

  const shared = { snapshotAt: at, ctx, medians, profile: null, engagement: null };

  const dormant = rows.filter(r =>
    (isOpen(r) && olderThan(r.last_touch, at, stagnantDays))
    || (r.status === 'lost' && olderThan(r.last_touch, at, stagnantDays) && within(r.last_touch, at, LOST_LOOKBACK_MONTHS))
  );
  const silentClients = rows.filter(r =>
    r.status === 'won'
    && olderThan(r.last_touch, at, SILENT_CLIENT_DAYS)
    && within(r.last_touch, at, LOST_LOOKBACK_MONTHS)
  );

  const raw = [
    ...dormant.map(r => buildCandidate(r, 'dormant_pipeline', shared)),
    ...silentClients.map(r => buildCandidate(r, 'customer_reactivation', shared)),
  ];

  return assemble(raw, {
    snapshotAt: at, ctx, base, medians, profile: null,
    measurableConfidence: MEASURABLE_CONFIDENCE,
    truncated,
    extraContext: { stagnantDays, surface: 'public', dealsRead: rows.length },
  });
}

module.exports = { computeFromDeals, toRow, buildBase, MEASURABLE_CONFIDENCE, MAX_DEALS };
