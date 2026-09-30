/**
 * Le snapshot d'audit et les lignes produit · une perte de données silencieuse.
 *
 * `undoGroup` teste `before.productLineIds !== undefined`, et quand la clé est là il
 * commence par un DELETE de toutes les affectations avant de réinsérer celles du
 * snapshot. Écrire `[]` là où il fallait ne rien dire revient donc à ordonner un
 * effacement.
 *
 * Le chemin réel était : corriger l'email d'un client (le snapshot d'enrichissement
 * passe null pour les lignes produit), puis annuler depuis l'onglet Historique. Le
 * client perdait toutes ses lignes produit, ce qui le sort DÉFINITIVEMENT du
 * détecteur d'upsell, qui compare lignes affectées et lignes disponibles. Rien dans
 * l'interface ne reliait « j'ai annulé une correction d'email » à « ce client ne
 * remonte plus jamais en upsell ».
 *
 * Ces tests tiennent les trois cas distincts. Le deuxième est le plus important :
 * un tableau vide doit rester un tableau vide, parce que la fusion, elle, a
 * légitimement besoin de dire « ce contact n'avait aucune ligne produit ».
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: { query: async () => ({ rows: [] }) },
};

const audit = require('../lib/data-quality-audit');

const opp = { id: 'opp-1', name: 'Laura Jacquet', email: 'laura@acme.fr' };

test('des lignes produit reelles sont conservees telles quelles', () => {
  const snap = audit.snapshotContact('pipedrive', null, opp, ['pl-1', 'pl-2']);
  assert.deepStrictEqual(snap.productLineIds, ['pl-1', 'pl-2']);
});

test('un tableau vide reste un tableau vide, il veut dire « aucune »', () => {
  const snap = audit.snapshotContact('pipedrive', null, opp, []);
  assert.deepStrictEqual(snap.productLineIds, [],
    'la fusion a besoin de pouvoir affirmer qu\'un contact n\'avait aucune ligne produit');
  assert.ok('productLineIds' in snap);
});

test('null veut dire « ce changement ne touche pas aux lignes produit », et la cle disparait', () => {
  for (const absent of [null, undefined]) {
    const snap = audit.snapshotContact('pipedrive', null, opp, absent);
    assert.strictEqual(snap.productLineIds, undefined);

    // C'est la forme SÉRIALISÉE qui compte : c'est elle qui est stockée dans
    // data_quality_changes.before_data, et undoGroup teste ensuite
    // `before.productLineIds !== undefined` avant d'appeler restoreProductLines, dont la
    // première instruction est un DELETE. Une clé présente vaut donc ordre d'effacement.
    assert.ok(
      !JSON.stringify(snap).includes('productLineIds'),
      'la cle doit disparaitre a la serialisation, sinon undoGroup efface des lignes produit intactes'
    );
  }
});

test('le reste du snapshot ne bouge pas', () => {
  const snap = audit.snapshotContact('pipedrive', { email: 'a@b.fr' }, opp, null, { relinkedChildren: ['e1'] });
  assert.deepStrictEqual(snap.crm, { email: 'a@b.fr' });
  assert.deepStrictEqual(snap.local, opp);
  assert.deepStrictEqual(snap.relinkedChildren, ['e1'], 'les extras passent toujours');
  assert.strictEqual(audit.snapshotContact('pipedrive', null, null, null).crm, null);
  assert.strictEqual(audit.snapshotContact('pipedrive', null, null, null).local, null);
});
