/**
 * Tests du budget d envoi du moteur natif.
 *
 * Le plafond journalier se comptait par UTILISATEUR : connecter une deuxieme
 * boite ne donnait pas un deuxieme budget, elle se contentait de partager les
 * 40 envois de la premiere. C est l inverse du besoin des commerciaux, qui
 * repartissent justement leurs envois sur plusieurs adresses pour ne pas se
 * faire bannir (migration 112).
 *
 * Ce que ces tests verrouillent : le plafond journalier suit la BOITE, le
 * quota par passage reste global a l utilisateur. Confondre les deux, c est
 * soit bruler une adresse, soit envoyer toute la journee d un coup.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  createEmailBudget,
  NATIVE_EMAIL_DAILY_CAP,
  NATIVE_EMAILS_PER_RUN,
} = require('../lib/native-sequence-engine');

const BOITE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const BOITE_B = 'bbbbbbbb-0000-0000-0000-000000000002';

test('deux boites ont chacune leur plafond journalier', () => {
  // La boite A a deja brule sa journee, la boite B n a rien envoye : une
  // campagne qui part de B doit pouvoir envoyer.
  const budget = createEmailBudget(new Map([[BOITE_A, NATIVE_EMAIL_DAILY_CAP]]), BOITE_A);
  assert.strictEqual(budget.budgetFor(BOITE_A), 0);
  assert.ok(budget.budgetFor(BOITE_B) > 0);
});

test('le quota par passage reste global, meme avec plusieurs boites', () => {
  const budget = createEmailBudget(new Map(), BOITE_A);
  // Le passage s epuise sur A...
  for (let i = 0; i < NATIVE_EMAILS_PER_RUN; i++) budget.consume(BOITE_A);
  // ...et B n a plus rien non plus : c est le cron horaire qui etale, pas la
  // multiplication des boites.
  assert.strictEqual(budget.budgetFor(BOITE_B), 0);
});

test('un envoi sans boite explicite pese sur la boite par defaut', () => {
  // Relances CRM et workflows ne choisissent pas d expediteur : ils partent de
  // la boite par defaut, ils doivent donc compter dessus.
  const budget = createEmailBudget(new Map(), BOITE_A);
  budget.consume(null);
  assert.strictEqual(budget.sentTodayByAccount.get(BOITE_A), 1);
});

test('le plafond journalier se rapproche a chaque envoi', () => {
  const budget = createEmailBudget(new Map([[BOITE_B, NATIVE_EMAIL_DAILY_CAP - 2]]), BOITE_A);
  assert.strictEqual(budget.budgetFor(BOITE_B), 2);
  budget.consume(BOITE_B);
  assert.strictEqual(budget.budgetFor(BOITE_B), 1);
  budget.consume(BOITE_B);
  assert.strictEqual(budget.budgetFor(BOITE_B), 0);
});

test('un depassement deja en base ne rend jamais un budget negatif', () => {
  // Une journee ou le plafond a ete change a la baisse, par exemple.
  const budget = createEmailBudget(new Map([[BOITE_A, NATIVE_EMAIL_DAILY_CAP + 15]]), BOITE_A);
  assert.strictEqual(budget.budgetFor(BOITE_A), 0);
});

test('sans aucune boite connue, on n envoie rien', () => {
  // Pas de boite par defaut et pas de boite demandee : envoyer reviendrait a
  // choisir une adresse au hasard.
  const budget = createEmailBudget(new Map(), null);
  assert.strictEqual(budget.budgetFor(null), 0);
});
