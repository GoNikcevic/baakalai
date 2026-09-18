const test = require('node:test');
const assert = require('node:assert');
const { buildThreadTitle, MAX_LEN } = require('../lib/chat-title');

test('un message qui tient dans le budget sert de titre tel quel', () => {
  const msg = "Quels clients n'ont pas été contactés depuis 30 jours ?";
  assert.strictEqual(buildThreadTitle(msg), msg);
});

test('la première lettre est mise en capitale', () => {
  assert.strictEqual(buildThreadTitle('montre-moi les deals stagnants'), 'Montre-moi les deals stagnants');
});

test("l'amorce ne saute que si le message déborde, au profit du sujet", () => {
  const title = buildThreadTitle(
    'Prépare une relance pour le deal Mercier Industries qui traîne depuis trois mois'
  );
  assert.ok(title.startsWith('Relance pour le deal Mercier'), title);
  assert.ok(title.length <= MAX_LEN, `${title.length} > ${MAX_LEN}`);
});

test('aucun titre ne dépasse la limite, ellipse comprise', () => {
  const long = 'a'.repeat(300);
  assert.ok(buildThreadTitle(long).length <= MAX_LEN);
  assert.ok(buildThreadTitle('Analyse ' + 'très '.repeat(60) + 'longue').length <= MAX_LEN);
});

test("l'interrogatif reste quand une inversion sujet-verbe le suit", () => {
  // « Quels sont les deals » amputé donnerait « Sont les deals », illisible.
  const title = buildThreadTitle(
    'Quels sont les deals qui ont le plus de chances de se conclure avant la fin du trimestre selon le scoring ?'
  );
  assert.ok(title.startsWith('Quels sont les deals'), title);
});

test('une abréviation ne coupe pas la phrase en deux', () => {
  const title = buildThreadTitle(
    "Le contrat de M. Dupont arrive à échéance le 30.09 et je ne sais pas comment aborder le renouvellement"
  );
  assert.ok(title.includes('M. Dupont'), title);
});

test('une première ligne trop courte va chercher le sujet sur la suivante', () => {
  const title = buildThreadTitle('Voici mon fichier.\nPeux-tu analyser les colonnes ?');
  assert.ok(title.includes('colonnes'), title);
});

test('politesse et tournure de requête libèrent de la place', () => {
  const title = buildThreadTitle(
    "Bonjour, peux-tu me donner la liste des clients à risque de churn avec leur score et leur dernier contact ?"
  );
  assert.ok(title.startsWith('Liste des clients'), title);
});

test('un message vide ou absent ne produit jamais de titre vide', () => {
  for (const input of ['', '   ', null, undefined]) {
    assert.strictEqual(buildThreadTitle(input), 'Nouvelle conversation');
  }
});

test('un message entièrement fait d\'amorces garde son texte', () => {
  assert.strictEqual(buildThreadTitle('Bonjour'), 'Bonjour');
});

test('le balisage et les guillemets ne remontent pas dans la liste', () => {
  assert.strictEqual(buildThreadTitle('**Relance** du deal `Vertigo`'), 'Relance du deal Vertigo');
  assert.strictEqual(buildThreadTitle('"Relance du deal Vertigo"'), 'Relance du deal Vertigo');
});
