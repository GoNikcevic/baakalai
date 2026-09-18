const test = require('node:test');
const assert = require('node:assert');

const { recoveryProbability, stageBucket, lostReasonBucket, P_MAX, P_MIN } = require('../lib/hidden-revenue/probability');
const scoring = require('../lib/hidden-revenue/scoring');
const { buildCandidate, dedupeAndCap, aggregate, accountKeyOf, resolveValue } = require('../lib/hidden-revenue');

const DAY_MS = 86400000;
const SNAPSHOT = new Date('2026-09-18T09:00:00Z');
const daysBefore = (n) => new Date(SNAPSHOT.getTime() - n * DAY_MS).toISOString();
const ctx = { winRate: 0.32, avgCycleDays: 90 };
const medians = { sample: 40, global: 20000, byBucket: { late: 30000, early: null, unknown: null } };

// ── P(récupération) ──

test('la base est le taux de conversion réel du tenant', () => {
  const { probability } = recoveryProbability({ daysQuiet: 5 }, ctx);
  assert.strictEqual(probability, 0.32);
});

test('sans historique, le taux par défaut prend le relais', () => {
  const { probability } = recoveryProbability({ daysQuiet: 5 }, {});
  assert.strictEqual(probability, 0.3);
});

test('le silence se mesure en cycles de vente, pas en jours absolus', () => {
  const candidate = { daysQuiet: 120 };
  const longCycle = recoveryProbability(candidate, { winRate: 0.32, avgCycleDays: 270 }).probability;
  const shortCycle = recoveryProbability(candidate, { winRate: 0.32, avgCycleDays: 21 }).probability;
  assert.ok(longCycle > shortCycle, `cycle long ${longCycle} devrait battre cycle court ${shortCycle}`);
});

test('un deal arrêté après la proposition vaut plus qu un deal arrêté en découverte', () => {
  const late = recoveryProbability({ daysQuiet: 60, stage: 'Proposition envoyée' }, ctx).probability;
  const early = recoveryProbability({ daysQuiet: 60, stage: 'Découverte' }, ctx).probability;
  assert.ok(late > early, `${late} devrait être > ${early}`);
});

test('un budget reporté vaut plus qu une perte au profit d un concurrent', () => {
  const postponed = recoveryProbability({ daysQuiet: 60, status: 'lost', lostReason: 'Budget reporté à 2027' }, ctx).probability;
  const competitor = recoveryProbability({ daysQuiet: 60, status: 'lost', lostReason: 'Parti chez un concurrent' }, ctx).probability;
  assert.ok(postponed > competitor * 2, `${postponed} devrait largement battre ${competitor}`);
});

test('la raison de perte ne s applique qu aux deals perdus', () => {
  const open = recoveryProbability({ daysQuiet: 60, status: 'open', lostReason: 'Budget reporté' }, ctx).probability;
  const neutral = recoveryProbability({ daysQuiet: 60, status: 'open' }, ctx).probability;
  assert.strictEqual(open, neutral);
});

test('un contact injoignable est fortement décoté sans être écarté', () => {
  const p = recoveryProbability({ daysQuiet: 10, contactable: false }, ctx).probability;
  assert.ok(p > 0 && p < 0.32 * 0.4, `attendu une forte décote, obtenu ${p}`);
});

test('le plafond tient même en empilant tous les facteurs favorables', () => {
  const { probability, factors } = recoveryProbability({
    daysQuiet: 1, stage: 'Négociation', status: 'lost', lostReason: 'budget reporté',
    positiveReply: true, contactable: true, icpFit: true,
  }, { winRate: 0.9, avgCycleDays: 90 });
  assert.ok(probability <= P_MAX, `${probability} dépasse le plafond ${P_MAX}`);
  assert.ok(factors.some(f => f.signal === 'capped_max'), 'le plafonnement doit être tracé dans les facteurs');
});

test('le plancher tient sur le pire cas', () => {
  const { probability } = recoveryProbability({
    daysQuiet: 2000, stage: 'Lead', status: 'lost', lostReason: 'concurrent',
    unansweredCount: 9, contactable: false, icpFit: false,
  }, { winRate: 0.05, avgCycleDays: 30 });
  assert.ok(probability >= P_MIN, `${probability} sous le plancher ${P_MIN}`);
});

test('chaque facteur appliqué porte sa justification', () => {
  const { factors } = recoveryProbability({ daysQuiet: 400, stage: 'Devis' }, ctx);
  assert.ok(factors.length >= 3);
  for (const f of factors) {
    assert.ok(f.signal && f.detail, `facteur incomplet : ${JSON.stringify(f)}`);
  }
});

test('les libellés d étape sont reconnus avec et sans accents, FR et EN', () => {
  assert.strictEqual(stageBucket('Négociation en cours'), 'late');
  assert.strictEqual(stageBucket('NEGOTIATION'), 'late');
  assert.strictEqual(stageBucket('Qualification'), 'early');
  assert.strictEqual(stageBucket('Étape 4'), 'unknown');
  assert.strictEqual(stageBucket(null), 'unknown');
});

test('une raison de perte inconnue ne produit aucun multiplicateur', () => {
  assert.strictEqual(lostReasonBucket('raison interne 42'), null);
  assert.strictEqual(lostReasonBucket(''), null);
});

// ── Sous-scores et agrégation ──

test('les paliers d intensité interpolent linéairement', () => {
  assert.strictEqual(scoring.subScore(0), 0);
  assert.strictEqual(scoring.subScore(0.05), 25);
  assert.strictEqual(scoring.subScore(0.12), 50);
  assert.strictEqual(scoring.subScore(0.25), 75);
  assert.strictEqual(scoring.subScore(0.40), 100);
  assert.strictEqual(scoring.subScore(0.085), 38);
  assert.strictEqual(scoring.subScore(2), 100);
  assert.strictEqual(scoring.subScore(-1), 0);
});

test('les poids sont renormalisés sur les seules dimensions évaluées', () => {
  const full = scoring.aggregateScore({
    dormant_pipeline: 80, customer_expansion: 80, customer_reactivation: 80, lead_reactivation: 80,
  });
  const partial = scoring.aggregateScore({ dormant_pipeline: 80, customer_reactivation: 80 });
  assert.strictEqual(full.hrs, 80);
  assert.strictEqual(partial.hrs, 80, 'un score partiel doit rester sur la même échelle');
  assert.strictEqual(Math.round((partial.weights.dormant_pipeline + partial.weights.customer_reactivation) * 100), 100);
});

test('une dimension absente ne compte pas pour zéro', () => {
  const withZero = scoring.aggregateScore({ dormant_pipeline: 80, customer_reactivation: 0 });
  const without = scoring.aggregateScore({ dormant_pipeline: 80 });
  assert.ok(without.hrs > withZero.hrs, `${without.hrs} devrait être > ${withZero.hrs}`);
  assert.strictEqual(without.hrs, 80);
});

test('sans aucune dimension évaluée, le score est nul et non cassé', () => {
  assert.deepStrictEqual(scoring.aggregateScore({}), { hrs: 0, weights: {} });
});

// ── Confiance et fourchette ──

test('une couverture parfaite donne 100, une couverture vide donne 0', () => {
  const full = {};
  for (const { key } of scoring.CONFIDENCE_WEIGHTS) full[key] = 1;
  assert.strictEqual(scoring.confidenceScore(full).confidence, 100);
  assert.strictEqual(scoring.confidenceScore({}).confidence, 0);
});

test('une couverture manquante compte pour zéro, pas pour neutre', () => {
  const partial = { amountCoverage: 1, activityCoverage: 1 };
  assert.strictEqual(scoring.confidenceScore(partial).confidence, 45);
});

test('la confiance élargit la fourchette au lieu de s afficher à côté', () => {
  const sure = scoring.expectedRange(157000, 86);
  const unsure = scoring.expectedRange(157000, 45);
  assert.ok(sure.high - sure.low < unsure.high - unsure.low);
  // 0,6 x (1 - 0,86) = 8,4 % de part et d'autre
  assert.strictEqual(sure.low, 143812);
  assert.strictEqual(sure.high, 170188);
});

test('à confiance nulle la fourchette ne dépasse pas la largeur maximale', () => {
  const r = scoring.expectedRange(100000, 0);
  assert.strictEqual(r.low, 40000);
  assert.strictEqual(r.high, 160000);
});

test('sous le seuil de quantification, on ne prétend pas chiffrer', () => {
  assert.strictEqual(scoring.isQuantifiable(34), false);
  assert.strictEqual(scoring.isQuantifiable(35), true);
});

test('les bandes de lecture couvrent toute l échelle', () => {
  assert.strictEqual(scoring.scoreBand(0), 'low');
  assert.strictEqual(scoring.scoreBand(61), 'high');
  assert.strictEqual(scoring.scoreBand(100), 'very_high');
  assert.strictEqual(scoring.confidenceBand(86), 'high');
  assert.strictEqual(scoring.confidenceBand(49), 'low');
});

// ── Candidats ──

const dormantRow = {
  id: 'opp-1', name: 'Paul Lantier', company: 'Groupe Lantier', email: 'paul@lantier.fr',
  status: 'open', deal_value: 48000, crm_stage: 'Proposition', lost_reason: null,
  created_at: daysBefore(400), last_touch: daysBefore(187), email_bounced_at: null,
};

test('un candidat porte sa valeur, sa probabilité et sa justification', () => {
  const c = buildCandidate(dormantRow, 'dormant_pipeline', { snapshotAt: SNAPSHOT, ctx, medians, engagement: null });
  assert.strictEqual(c.qualifiedValue, 48000);
  assert.strictEqual(c.valueEstimated, false);
  assert.strictEqual(c.daysQuiet, 187);
  assert.strictEqual(c.expectedValue, Math.round(48000 * c.recoveryProbability));
  assert.ok(c.reasonCodes.includes('STALE_PROPOSAL'));
  assert.strictEqual(c.recommendedAction, 'reactivate_deal');
});

test('un deal sans montant est estimé sur la médiane de son étape et signalé', () => {
  const c = buildCandidate({ ...dormantRow, deal_value: null }, 'dormant_pipeline', {
    snapshotAt: SNAPSHOT, ctx, medians, engagement: null,
  });
  assert.strictEqual(c.qualifiedValue, 30000, 'médiane de l étape « late »');
  assert.strictEqual(c.valueEstimated, true);
  assert.strictEqual(c.originalValue, null);
  assert.ok(c.reasonCodes.includes('LOW_DATA_QUALITY'));
});

test('sans aucune médiane disponible, le deal se compte mais ne se chiffre pas', () => {
  const empty = { sample: 0, global: null, byBucket: { late: null, early: null, unknown: null } };
  const c = buildCandidate({ ...dormantRow, deal_value: 0 }, 'dormant_pipeline', {
    snapshotAt: SNAPSHOT, ctx, medians: empty, engagement: null,
  });
  assert.strictEqual(c.qualifiedValue, null);
  assert.strictEqual(c.expectedValue, 0);
  assert.strictEqual(c.valueEstimated, false);
});

test('un client silencieux relève de la réactivation, pas du pipeline', () => {
  const c = buildCandidate(
    { ...dormantRow, status: 'won', crm_stage: 'Closed Won' },
    'customer_reactivation',
    { snapshotAt: SNAPSHOT, ctx, medians, engagement: null }
  );
  assert.ok(c.reasonCodes.includes('DORMANT_CUSTOMER'));
  assert.strictEqual(c.recommendedAction, 'reengage_customer');
});

test('l horloge gelée rend le candidat reproductible', () => {
  const a = buildCandidate(dormantRow, 'dormant_pipeline', { snapshotAt: SNAPSHOT, ctx, medians, engagement: null });
  const b = buildCandidate(dormantRow, 'dormant_pipeline', { snapshotAt: SNAPSHOT, ctx, medians, engagement: null });
  assert.deepStrictEqual(a, b);
  const later = buildCandidate(dormantRow, 'dormant_pipeline', {
    snapshotAt: new Date(SNAPSHOT.getTime() + 200 * DAY_MS), ctx, medians, engagement: null,
  });
  assert.notStrictEqual(later.daysQuiet, a.daysQuiet);
});

test('la clé de compte regroupe par société avant tout', () => {
  assert.strictEqual(accountKeyOf({ company: ' Groupe Lantier ', email: 'a@b.fr' }), 'c:groupe lantier');
  assert.strictEqual(accountKeyOf({ email: 'A@B.fr' }), 'e:a@b.fr');
  assert.strictEqual(accountKeyOf({ id: 'x' }), 'o:x');
});

test('une valeur négative ou nulle du CRM n est jamais prise pour argent comptant', () => {
  assert.strictEqual(resolveValue({ deal_value: -5 }, medians).qualifiedValue, 20000);
  assert.strictEqual(resolveValue({ deal_value: -5 }, medians).estimated, true);
});

// ── Dédup et plafonnement ──

const candidate = (accountKey, dimension, expectedValue) => ({
  accountKey, dimension, expectedValue, qualifiedValue: expectedValue * 4,
  factors: [], reasonCodes: [], valueEstimated: false,
});

test('un même compte ne pèse qu une fois par dimension', () => {
  const { candidates, duplicatesDropped } = dedupeAndCap([
    candidate('c:acme', 'dormant_pipeline', 1000),
    candidate('c:acme', 'dormant_pipeline', 4000),
    candidate('c:acme', 'customer_reactivation', 2000),
  ]);
  assert.strictEqual(candidates.length, 2, 'deux dimensions, une ligne chacune');
  assert.strictEqual(duplicatesDropped, 1);
  assert.strictEqual(candidates.find(c => c.dimension === 'dormant_pipeline').expectedValue, 4000);
});

test('un compte dominant est écrêté et la ligne porte la raison', () => {
  const list = [candidate('c:whale', 'dormant_pipeline', 100000)];
  for (let i = 0; i < 12; i++) list.push(candidate(`c:pme${i}`, 'dormant_pipeline', 1000));
  const { candidates, cappedAccounts, topAccountShare } = dedupeAndCap(list);
  const whale = candidates.find(c => c.accountKey === 'c:whale');
  assert.strictEqual(cappedAccounts, 1);
  assert.ok(whale.expectedValue < 100000, 'le compte dominant doit être écrêté');
  assert.ok(whale.reasonCodes.includes('CONCENTRATION_CAPPED'));
  assert.ok(whale.factors.some(f => f.signal === 'account_cap'));
  assert.ok(topAccountShare <= 0.62, `concentration résiduelle trop forte : ${topAccountShare}`);
});

test('un petit CRM concentré n est pas écrêté', () => {
  const { candidates, cappedAccounts } = dedupeAndCap([
    candidate('c:un', 'dormant_pipeline', 100000),
    candidate('c:deux', 'dormant_pipeline', 1000),
  ]);
  assert.strictEqual(cappedAccounts, 0);
  assert.strictEqual(candidates.find(c => c.accountKey === 'c:un').expectedValue, 100000);
});

test('la somme des lignes reste égale au total affiché après écrêtage', () => {
  const list = [candidate('c:whale', 'dormant_pipeline', 100000)];
  for (let i = 0; i < 12; i++) list.push(candidate(`c:pme${i}`, 'dormant_pipeline', 1000));
  const { candidates } = dedupeAndCap(list);
  const dims = aggregate(candidates, 1000000);
  const sumOfLines = candidates.reduce((s, c) => s + c.expectedValue, 0);
  assert.strictEqual(dims.dormant_pipeline.expectedValue, Math.round(sumOfLines));
});

// ── Agrégation par dimension ──

test('les dimensions non évaluées sont déclarées, pas comptées zéro', () => {
  const dims = aggregate([candidate('c:a', 'dormant_pipeline', 5000)], 1000000);
  assert.strictEqual(dims.dormant_pipeline.evaluated, true);
  assert.strictEqual(dims.customer_expansion.evaluated, false);
  assert.strictEqual(dims.customer_expansion.subScore, undefined);
});

test('l intensité rapporte la réserve à la base de revenu', () => {
  const dims = aggregate([candidate('c:a', 'dormant_pipeline', 30000)], 1000000);
  assert.strictEqual(dims.dormant_pipeline.qualifiedValue, 120000);
  assert.strictEqual(dims.dormant_pipeline.intensity, 0.12);
  assert.strictEqual(dims.dormant_pipeline.subScore, 50);
});

test('sans base de revenu, l intensité vaut zéro au lieu de diverger', () => {
  const dims = aggregate([candidate('c:a', 'dormant_pipeline', 30000)], 0);
  assert.strictEqual(dims.dormant_pipeline.intensity, 0);
  assert.strictEqual(dims.dormant_pipeline.subScore, 0);
});

test('les deals sans montant se comptent dans le volume, pas dans la valeur', () => {
  const withoutValue = { ...candidate('c:a', 'dormant_pipeline', 0), qualifiedValue: null };
  const dims = aggregate([withoutValue, candidate('c:b', 'dormant_pipeline', 10000)], 500000);
  assert.strictEqual(dims.dormant_pipeline.count, 2);
  assert.strictEqual(dims.dormant_pipeline.countWithoutValue, 1);
  assert.strictEqual(dims.dormant_pipeline.qualifiedValue, 40000);
});
