/**
 * Tests du declencheur « client a risque » (churn_risk).
 *
 * Le churn est un ETAT, pas un evenement : une regle lue sur
 * `churn_score >= seuil` aurait repropose la meme population a chaque run, et
 * seule la dedup 7 jours l aurait retenue. Le declencheur s ancre donc sur
 * `churn_flagged_at`, la date de franchissement du seuil (migration 109), avec
 * la meme fenetre de 7 jours que deal_won. Ces tests verrouillent cette
 * semantique : sans elle, activer la regle revient a ecrire tous les jours aux
 * memes clients.
 */

const test = require('node:test');
const assert = require('node:assert');

const { matchContacts } = require('../lib/trigger-matching');
const { AT_RISK_THRESHOLD } = require('../lib/churn-scoring');

const DAY = 86400000;
const NOW = Date.parse('2026-09-22T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const client = (over = {}) => ({
  id: over.id || 'c1',
  status: 'won',
  email: 'contact@exemple.fr',
  campaign_id: null,
  created_at: daysAgo(400),
  churn_score: 70,
  churn_flagged_at: daysAgo(1),
  ...over,
});

const ids = (opps, conditions = {}) =>
  matchContacts({ trigger_type: 'churn_risk', conditions }, opps, NOW).map(o => o.id);

test('un client signale la veille est relance des le premier run', () => {
  assert.deepStrictEqual(ids([client({ id: 'signale-hier' })]), ['signale-hier']);
});

test('un client signale il y a plus de 7 jours sort de la fenetre', () => {
  // C est ce qui empeche la regle de reproposer indefiniment la meme
  // population : passe la fenetre, le contact n est plus un evenement.
  assert.deepStrictEqual(ids([client({ id: 'vieux', churn_flagged_at: daysAgo(9) })]), []);
});

test('le delai de courtoisie decale la fenetre au lieu de la rallonger', () => {
  const opps = [
    client({ id: 'j1', churn_flagged_at: daysAgo(1) }),
    client({ id: 'j10', churn_flagged_at: daysAgo(10) }),
    client({ id: 'j20', churn_flagged_at: daysAgo(20) }),
  ];
  assert.deepStrictEqual(ids(opps, { days: 7 }), ['j10']);
});

test('un client jamais signale n est jamais relance', () => {
  // Garde-fou : ageDays() retombe sur created_at quand la date manque, ce qui
  // ferait matcher de vieux clients qui n ont jamais franchi le seuil.
  assert.deepStrictEqual(ids([client({ id: 'jamais', churn_flagged_at: null })]), []);
});

test('un score repasse sous le seuil ne declenche plus', () => {
  const sous = AT_RISK_THRESHOLD - 1;
  assert.deepStrictEqual(ids([client({ id: 'gueri', churn_score: sous })]), []);
});

test('un deal encore ouvert n est pas un client a retenir', () => {
  // La retention ne parle qu aux clients gagnes : un deal ouvert se reactive.
  assert.deepStrictEqual(ids([client({ id: 'deal-ouvert', status: 'open' })]), []);
});

test('un prospect froid de campagne reste hors du perimetre CRM', () => {
  // Meme regle que tous les autres triggers d Automatisations (crm-scope).
  assert.deepStrictEqual(ids([client({ id: 'prospect', campaign_id: 'camp-1' })]), []);
});
