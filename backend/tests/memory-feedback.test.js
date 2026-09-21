const test = require('node:test');
const assert = require('node:assert');
const { computeWeightNudge } = require('../lib/memory-feedback');

test('pas de réglage sous le seuil d échantillon', () => {
  assert.strictEqual(computeWeightNudge({ truePositives: 2, falsePositives: 2, falseNegatives: 0, current: 1.0 }), null);
});

test('trop de faux positifs → multiplicateur abaissé', () => {
  assert.strictEqual(computeWeightNudge({ truePositives: 2, falsePositives: 4, falseNegatives: 0, current: 1.0 }), 0.95);
});

test('churns ratés avec peu de faux positifs → multiplicateur relevé', () => {
  assert.strictEqual(computeWeightNudge({ truePositives: 5, falsePositives: 1, falseNegatives: 2, current: 1.0 }), 1.05);
});

test('zone neutre → aucun réglage', () => {
  // fpRate 0.4 : ni assez alarmiste ni assez timide
  assert.strictEqual(computeWeightNudge({ truePositives: 3, falsePositives: 2, falseNegatives: 1, current: 1.0 }), null);
});

test('borné : ne descend jamais sous 0.7, ne monte jamais au-dessus de 1.3', () => {
  assert.strictEqual(computeWeightNudge({ truePositives: 1, falsePositives: 9, falseNegatives: 0, current: 0.7 }), null);
  assert.strictEqual(computeWeightNudge({ truePositives: 8, falsePositives: 0, falseNegatives: 3, current: 1.3 }), null);
  assert.strictEqual(computeWeightNudge({ truePositives: 1, falsePositives: 9, falseNegatives: 0, current: 0.72 }), 0.7);
});
