const test = require('node:test');
const assert = require('node:assert');
const { RATES, computeMinutes, formatDuration, variation } = require('../lib/activity-digest');

test('le barème applique bien une minute par compte relu', () => {
  assert.strictEqual(computeMinutes({ accountsReviewed: 412 }), 412);
});

test('le total additionne toutes les lignes du barème', () => {
  const counters = {
    accountsReviewed: 412, signals: 38, followUps: 17, issuesFound: 63, analyses: 4,
  };
  const expected = 412 * RATES.accountsReviewed + 38 * RATES.signals + 17 * RATES.followUps
    + 63 * RATES.issuesFound + 4 * RATES.analyses;
  assert.strictEqual(computeMinutes(counters), expected);
});

test('les compteurs hors barème ne gonflent pas le total', () => {
  const base = computeMinutes({ signals: 10 });
  const withUncounted = computeMinutes({ signals: 10, scoresRecalculated: 318, followUpsSent: 12 });
  assert.strictEqual(withUncounted, base, 'les scores recalculés ne doivent rien ajouter');
});

test('compteurs absents, négatifs ou aberrants : total à zéro, jamais NaN', () => {
  assert.strictEqual(computeMinutes(null), 0);
  assert.strictEqual(computeMinutes({}), 0);
  assert.strictEqual(computeMinutes({ signals: -5 }), 0);
  assert.strictEqual(computeMinutes({ signals: 'beaucoup' }), 0);
});

test('la durée est arrondie vers le bas : 14 h 46 réelles affichent 14 h', () => {
  assert.strictEqual(formatDuration(886), '14 h');
  assert.strictEqual(formatDuration(59), '59 min');
  assert.strictEqual(formatDuration(60), '1 h');
  assert.strictEqual(formatDuration(0), '0 min');
});

test('la variation reste nulle quand la semaine précédente est vide', () => {
  assert.strictEqual(variation(10, 0), null, 'pas de hausse infinie affichable');
  assert.strictEqual(variation(14, 10), 40);
  assert.strictEqual(variation(5, 10), -50);
});
