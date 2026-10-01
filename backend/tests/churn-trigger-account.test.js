/**
 * Tests du declencheur « client a risque » repointe sur le COMPTE (lot 5).
 *
 * Le defaut que ces tests verrouillent : un client a risque est UNE societe,
 * mais la regle s evaluait sur des contacts. Une societe a huit interlocuteurs
 * declenchait donc huit relances le meme jour, toutes vers le meme domaine,
 * ce qui est le motif de spam que le lot 6 cherche precisement a eviter.
 *
 * La Map `accountChurn` est fournie par lib/churn-scoring loadAccountChurn.
 * Absente, le comportement doit rester EXACTEMENT celui d avant le lot 5 :
 * c est ce qui permet de livrer sans attendre que les comptes soient scores.
 */

const test = require('node:test');
const assert = require('node:assert');

const { matchContacts } = require('../lib/trigger-matching');

const DAY = 86400000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const contact = (over = {}) => ({
  id: over.id || 'c1',
  status: 'won',
  email: `${over.id || 'c1'}@client.fr`,
  campaign_id: null,
  created_at: daysAgo(400),
  last_activity_at: daysAgo(50),
  account_id: 'acc-1',
  is_primary_contact: false,
  // Volontairement SAIN au niveau contact : seul le compte est signale.
  churn_score: 10,
  churn_flagged_at: null,
  ...over,
});

const compteARisque = new Map([
  ['acc-1', { flaggedAt: daysAgo(1), score: 72 }],
]);

const matched = (opps, defaults = {}) =>
  matchContacts({ trigger_type: 'churn_risk', conditions: {} }, opps, NOW, defaults)
    .map(o => o.id);

test('une societe a huit interlocuteurs ne declenche QU UNE relance', () => {
  const opps = Array.from({ length: 8 }, (_, i) => contact({ id: `c${i}` }));
  const r = matched(opps, { accountChurn: compteARisque });
  assert.strictEqual(r.length, 1, `8 contacts d un meme compte ont produit ${r.length} relances`);
});

test('l interlocuteur principal est celui qu on retient', () => {
  const opps = [
    contact({ id: 'operationnel', last_activity_at: daysAgo(2) }),
    contact({ id: 'decideur', is_primary_contact: true, last_activity_at: daysAgo(60) }),
  ];
  // Le principal gagne MEME s il est moins recemment actif : c est l ordre de
  // preference du produit, l election de la migration 125 d abord.
  assert.deepStrictEqual(matched(opps, { accountChurn: compteARisque }), ['decideur']);
});

test('a defaut de principal, le plus recemment actif', () => {
  const opps = [
    contact({ id: 'vieux', last_activity_at: daysAgo(90) }),
    contact({ id: 'recent', last_activity_at: daysAgo(3) }),
  ];
  assert.deepStrictEqual(matched(opps, { accountChurn: compteARisque }), ['recent']);
});

test('le signalement du COMPTE suffit, meme si aucun contact n est signale', () => {
  // C est le renversement du lot 5 : les contacts sont sains individuellement
  // (churn_flagged_at null), c est la societe qui est a risque.
  const opps = [contact({ id: 'seul' })];
  assert.deepStrictEqual(matched(opps, { accountChurn: compteARisque }), ['seul']);
  // Sans la Map, personne ne matche : le contact n a pas de date de
  // franchissement a lui.
  assert.deepStrictEqual(matched(opps), []);
});

test('un compte sous le seuil ne declenche rien, meme signale', () => {
  const tiede = new Map([['acc-1', { flaggedAt: daysAgo(1), score: 40 }]]);
  assert.deepStrictEqual(matched([contact({ id: 'c1' })], { accountChurn: tiede }), []);
});

test('la fenetre de 7 jours tient aussi au niveau compte', () => {
  const vieux = new Map([['acc-1', { flaggedAt: daysAgo(9), score: 80 }]]);
  assert.deepStrictEqual(matched([contact({ id: 'c1' })], { accountChurn: vieux }), []);
});

test('les contacts sans compte rattache ne sont jamais fusionnes entre eux', () => {
  // account_id NULL veut dire « societe inconnue », pas « meme societe ».
  // Les regrouper n en garderait qu un seul pour tout le reste de la base.
  const orphelins = [
    contact({ id: 'o1', account_id: null, churn_flagged_at: daysAgo(1), churn_score: 80 }),
    contact({ id: 'o2', account_id: null, churn_flagged_at: daysAgo(1), churn_score: 80 }),
  ];
  const r = matched(orphelins, { accountChurn: compteARisque });
  assert.strictEqual(r.length, 2, 'deux contacts sans compte sont deux sujets distincts');
});

test('deux societes distinctes produisent deux relances', () => {
  const deux = new Map([
    ['acc-1', { flaggedAt: daysAgo(1), score: 72 }],
    ['acc-2', { flaggedAt: daysAgo(1), score: 90 }],
  ]);
  const opps = [
    contact({ id: 'a1', account_id: 'acc-1' }),
    contact({ id: 'a2', account_id: 'acc-1' }),
    contact({ id: 'b1', account_id: 'acc-2' }),
  ];
  assert.strictEqual(matched(opps, { accountChurn: deux }).length, 2);
});

// ── Non-regression : sans la Map, rien ne change ──
test('sans accountChurn le declencheur se comporte comme avant le lot 5', () => {
  const ancien = [
    contact({ id: 'signale', churn_flagged_at: daysAgo(1), churn_score: 70 }),
    contact({ id: 'sain' }),
    contact({ id: 'hors-fenetre', churn_flagged_at: daysAgo(9), churn_score: 70 }),
  ];
  // Les trois partagent le meme account_id : sans la Map, aucun regroupement
  // ne doit avoir lieu, le filtre reste strictement par contact.
  assert.deepStrictEqual(matched(ancien), ['signale']);
});
