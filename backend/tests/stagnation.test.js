/**
 * Tests du seuil de dormance.
 *
 * Deux autorités concurrentes coexistaient : un seuil réglable par trigger côté
 * Activation et un 14 en dur partagé par la file de réactivation et le Deal
 * Coach. Un deal silencieux depuis 20 jours était donc dormant sur un écran et
 * pas sur l'autre. Ces tests verrouillent la définition unique.
 */

const test = require('node:test');
const assert = require('node:assert');

const { clampDays, DEFAULT_STAGNANT_DAYS, MIN_DAYS, MAX_DAYS } = require('../lib/stagnation');
const { matchContacts } = require('../lib/trigger-matching');

const DAY = 86400000;
const NOW = Date.parse('2026-09-10T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

test('le seuil par defaut est celui de la file de reactivation', () => {
  assert.strictEqual(DEFAULT_STAGNANT_DAYS, 14);
});

test('clampDays ramene les valeurs hors bornes dans l intervalle', () => {
  assert.strictEqual(clampDays(0), MIN_DAYS);
  assert.strictEqual(clampDays(-5), MIN_DAYS);
  assert.strictEqual(clampDays(10000), MAX_DAYS);
  assert.strictEqual(clampDays(21), 21);
});

test('clampDays accepte une chaine et retombe sur le defaut si illisible', () => {
  assert.strictEqual(clampDays('21'), 21);
  assert.strictEqual(clampDays('abc'), DEFAULT_STAGNANT_DAYS);
  assert.strictEqual(clampDays(undefined), DEFAULT_STAGNANT_DAYS);
});

test('clampDays arrondit une valeur decimale', () => {
  assert.strictEqual(clampDays(20.6), 21);
});

// ── Le repli du trigger part de la meme valeur ─────────────────────────────

const deals = [
  { id: 'muet-20j', campaign_id: null, status: 'open', last_activity_at: daysAgo(20) },
  { id: 'actif-3j', campaign_id: null, status: 'open', last_activity_at: daysAgo(3) },
];

test('sans seuil explicite, le trigger deal_stagnant suit le reglage utilisateur', () => {
  const matched = matchContacts(
    { trigger_type: 'deal_stagnant', conditions: {} },
    deals, NOW, { stagnantDays: 14 }
  );
  // A 14 jours le deal muet depuis 20 jours ressort — comme dans la file.
  assert.deepStrictEqual(matched.map(o => o.id), ['muet-20j']);
});

test('un trigger portant son propre seuil le garde', () => {
  const matched = matchContacts(
    { trigger_type: 'deal_stagnant', conditions: { days: 30 } },
    deals, NOW, { stagnantDays: 14 }
  );
  // Ecrire automatiquement plus tard qu'on ne regarde reste un choix legitime.
  assert.deepStrictEqual(matched.map(o => o.id), []);
});

test('sans reglage transmis, le comportement historique est preserve', () => {
  const matched = matchContacts(
    { trigger_type: 'deal_stagnant', conditions: {} },
    deals, NOW
  );
  // Repli sur 30 comme avant : aucun appelant non migre ne change de sens.
  assert.deepStrictEqual(matched.map(o => o.id), []);
});
