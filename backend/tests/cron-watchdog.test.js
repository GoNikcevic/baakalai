/**
 * Dead-man's switch des crons — logique pure de détection.
 * Contexte : les crons ont été éteints ~3 mois (variable Railway avec espace)
 * sans aucun signal. findStaleJobs est la détection de cette absence.
 */

const test = require('node:test');
const assert = require('node:assert');
const { findStaleJobs, EXPECTED_JOBS } = require('../lib/cron-watchdog');

const NOW = new Date('2026-08-04T12:00:00Z');
const hoursAgo = h => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test('un quotidien qui a tourne cette nuit n est pas en retard', () => {
  const stale = findStaleJobs([{ job: 'crm-agent', last_started: hoursAgo(3) }], NOW);
  assert.deepStrictEqual(stale, []);
});

test('un quotidien silencieux depuis 30h est signale', () => {
  const stale = findStaleJobs([{ job: 'crm-agent', last_started: hoursAgo(30) }], NOW);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].job, 'crm-agent');
  assert.strictEqual(stale[0].expectedHours, 26);
  assert.strictEqual(stale[0].hoursLate, 4);
});

test('la marge de 26h tolere un redeploy sur le creneau', () => {
  // 25h de silence = un run quotidien décalé d'une heure, pas une panne.
  const stale = findStaleJobs([{ job: 'prospection', last_started: hoursAgo(25) }], NOW);
  assert.deepStrictEqual(stale, []);
});

test('un hebdomadaire n est signale qu au-dela de 8 jours', () => {
  assert.deepStrictEqual(
    findStaleJobs([{ job: 'memory-agent', last_started: hoursAgo(6 * 24) }], NOW), []);
  const stale = findStaleJobs([{ job: 'memory-agent', last_started: hoursAgo(9 * 24) }], NOW);
  assert.strictEqual(stale.length, 1);
});

test('un job absent du catalogue est trace mais jamais surveille', () => {
  const stale = findStaleJobs([{ job: 'job-experimental', last_started: hoursAgo(500) }], NOW);
  assert.deepStrictEqual(stale, []);
});

test('un job qui n a jamais tourne n apparait pas (staging sans orchestrateur)', () => {
  // fetchLastRuns ne renvoie que les jobs présents dans cron_runs : une base
  // sans exécution ne produit aucune ligne, donc aucune alerte.
  assert.deepStrictEqual(findStaleJobs([], NOW), []);
});

test('tolere les dates invalides et les entrees nulles', () => {
  assert.deepStrictEqual(findStaleJobs(null, NOW), []);
  assert.deepStrictEqual(
    findStaleJobs([{ job: 'crm-agent', last_started: 'pas une date' }], NOW), []);
});

test('le catalogue couvre les 9 jobs de l orchestrateur', () => {
  assert.strictEqual(Object.keys(EXPECTED_JOBS).length, 9);
});
