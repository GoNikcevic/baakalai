const test = require('node:test');
const assert = require('node:assert');
const { computeDealProbability } = require('../lib/forecast-engine');

const DAY_MS = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
const ctx = { winRate: 0.4, avgCycleDays: 90, calibration: 1.0 };

test('un deal frais et actif vaut plus que le taux de conversion de base', () => {
  const p = computeDealProbability({ created_at: daysAgo(10), last_activity_at: daysAgo(2) }, ctx);
  assert.ok(p > 0.4, `attendu > 0.4, obtenu ${p}`);
});

test('un deal à 2x le cycle moyen est fortement dégradé', () => {
  const fresh = computeDealProbability({ created_at: daysAgo(20), last_activity_at: daysAgo(5) }, ctx);
  const stale = computeDealProbability({ created_at: daysAgo(200), last_activity_at: daysAgo(5) }, ctx);
  assert.ok(stale < fresh * 0.5, `stale ${stale} devrait être < moitié de fresh ${fresh}`);
});

test('le silence prolongé pèse plus que l âge seul', () => {
  const active = computeDealProbability({ created_at: daysAgo(60), last_activity_at: daysAgo(3) }, ctx);
  const silent = computeDealProbability({ created_at: daysAgo(60), last_activity_at: daysAgo(60) }, ctx);
  assert.ok(silent < active, `silencieux ${silent} devrait être < actif ${active}`);
});

test('un lead score élevé relève la probabilité', () => {
  const noScore = computeDealProbability({ created_at: daysAgo(30), last_activity_at: daysAgo(10) }, ctx);
  const highScore = computeDealProbability({ created_at: daysAgo(30), last_activity_at: daysAgo(10), score: 85 }, ctx);
  assert.ok(highScore > noScore);
});

test('bornes respectées : jamais < 0.03 ni > 0.95', () => {
  const worst = computeDealProbability({ created_at: daysAgo(400), last_activity_at: daysAgo(300), score: 0 }, ctx);
  const best = computeDealProbability({ created_at: daysAgo(5), last_activity_at: daysAgo(1), score: 100, planned_followup_date: daysAgo(-10) }, ctx);
  assert.ok(worst >= 0.03 && best <= 0.95, `bornes violées: ${worst} / ${best}`);
});

test('sans contexte appris, les fallbacks neutres tiennent', () => {
  const p = computeDealProbability({ created_at: daysAgo(30), last_activity_at: daysAgo(10) }, {});
  assert.ok(p > 0 && p < 1);
});
