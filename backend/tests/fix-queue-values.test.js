/**
 * Ce que la file de correction accepte d'écrire, et surtout ce qu'elle refuse.
 *
 * Ces valeurs arrivent d'un champ libre et partent directement dans `opportunities`,
 * d'où elles alimentent les totaux, les prévisions, le scoring churn et les
 * déclencheurs d'automatisation qui comptent des jours. Une valeur mal formée n'est
 * pas rejetée par le SQL : elle devient un chiffre faux que plus personne ne
 * questionne.
 *
 * Le refus est donc la fonctionnalité. Une ligne refusée ressort dans `failed` et
 * reste à traiter, ce qui est toujours préférable à une donnée inventée.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [],
  exports: { query: async () => ({ rows: [] }), crmCleaningReports: {} },
};

const { normalizeFixValue, sortByImpact } = require('../routes/data-quality');

test('un montant se lit dans les formats que les gens tapent vraiment', () => {
  assert.strictEqual(normalizeFixValue('dealValue', '12000'), 12000);
  assert.strictEqual(normalizeFixValue('dealValue', 12000), 12000);
  assert.strictEqual(normalizeFixValue('dealValue', '12 000'), 12000, 'espace de milliers');
  assert.strictEqual(normalizeFixValue('dealValue', '1250,50'), 1250.5, 'virgule décimale française');
  assert.strictEqual(normalizeFixValue('dealValue', '0'), 0, 'zéro est un montant, pas une absence');
});

test('un montant impossible est refuse plutot qu ecrit', () => {
  assert.strictEqual(normalizeFixValue('dealValue', ''), null);
  assert.strictEqual(normalizeFixValue('dealValue', '   '), null);
  assert.strictEqual(normalizeFixValue('dealValue', 'douze mille'), null);
  assert.strictEqual(normalizeFixValue('dealValue', '-5000'), null,
    'un montant négatif fausserait tous les totaux sans jamais se voir');
  assert.strictEqual(normalizeFixValue('dealValue', null), null);
  assert.strictEqual(normalizeFixValue('dealValue', undefined), null);
});

test('une date de cloture dans le futur est refusee', () => {
  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.ok(normalizeFixValue('wonLostDate', hier), 'une date passée passe');

  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.strictEqual(normalizeFixValue('wonLostDate', demain), null,
    'une affaire ne se clôt pas demain, et « gagné il y a N jours » porte l\'upsell et la rétention');

  assert.strictEqual(normalizeFixValue('wonLostDate', 'la semaine derniere'), null);
  assert.strictEqual(normalizeFixValue('wonLostDate', ''), null);
  assert.strictEqual(normalizeFixValue('wonLostDate', null), null);
});

test('les lignes produit acceptent la liste vide, qui veut dire « retirer tout »', () => {
  assert.deepStrictEqual(normalizeFixValue('productLines', ['a', 'b']), ['a', 'b']);
  assert.deepStrictEqual(normalizeFixValue('productLines', []), [],
    'une liste vide est une intention explicite, pas une valeur manquante');
  assert.deepStrictEqual(normalizeFixValue('productLines', ['a', null, '', 'b']), ['a', 'b']);
  assert.strictEqual(normalizeFixValue('productLines', 'pl-1'), null, 'ce champ attend une liste');
  assert.strictEqual(normalizeFixValue('productLines', null), null);
});

test('un champ texte refuse le vide et se debarrasse des espaces', () => {
  assert.strictEqual(normalizeFixValue('sector', '  BTP  '), 'BTP');
  assert.strictEqual(normalizeFixValue('sector', '   '), null,
    'écrire une chaîne vide effacerait la valeur au lieu de la corriger');
  assert.strictEqual(normalizeFixValue('company', ''), null);
  assert.strictEqual(normalizeFixValue('company', 42), null, 'ce champ attend du texte');
});

test('l ordre de travail remonte le pipeline ouvert, puis le poids du compte', () => {
  const rows = sortByImpact([
    { id: 'd', hasOpenDeal: false, dealValue: 0, lastActivityAt: '2026-09-20' },
    { id: 'c', hasOpenDeal: false, dealValue: 90000, lastActivityAt: '2026-01-01' },
    { id: 'a', hasOpenDeal: true, dealValue: 4000, lastActivityAt: '2026-01-01' },
    { id: 'b', hasOpenDeal: true, dealValue: 42000, lastActivityAt: '2026-01-01' },
  ]);
  assert.deepStrictEqual(rows.map(r => r.id), ['b', 'a', 'c', 'd'],
    'deux deals ouverts du plus gros au plus petit, puis le gros client gagné, puis la fiche sans montant');
});
