/**
 * Normalisation des noms de société · la clé de dédoublonnage des comptes.
 *
 * Deux risques opposés, et ce sont eux que ces tests tiennent en équilibre.
 *
 * 1. NORMALISER TROP PEU · « Atelier Kerveil SARL » et « atelier kerveil »
 *    deviendraient deux comptes, chacun avec ses deals et ses contacts, et
 *    l'utilisateur verrait son CA coupé en deux.
 *
 * 2. NORMALISER TROP · « Groupe Martin » et « Groupe Martini » fusionneraient,
 *    et là c'est pire : deux vraies sociétés confondues, des relances qui
 *    partent au mauvais client, un CA faux dans l'autre sens. Une erreur de
 *    dédup ne se voit pas, et ne se répare pas toute seule.
 *
 * La mesure du 29/09 sur la production (226 comptes, zéro variante de nom)
 * tranche : le vrai risque est le second. La normalisation retire ce qui
 * n'identifie rien, jamais plus.
 */

const test = require('node:test');
const assert = require('node:assert');
const { normalizeAccountName, isSameAccount } = require('../lib/account-name');

test('la casse, les accents et la ponctuation ne font pas deux sociétés', () => {
  assert.strictEqual(normalizeAccountName('Sté Générale'), 'stegenerale');
  assert.ok(isSameAccount('Sté Générale', 'STE GENERALE'));
  assert.ok(isSameAccount('Saint-Martin', 'Saint Martin'));
  assert.ok(isSameAccount('A.B.C.', 'ABC'));
});

test('la forme juridique en fin de nom est retirée', () => {
  assert.strictEqual(normalizeAccountName('Atelier Kerveil SARL'), 'atelierkerveil');
  assert.strictEqual(normalizeAccountName('Peyrac Development SASU'), 'peyracdevelopment');
  assert.strictEqual(normalizeAccountName('United Oil & Gas Corp.'), 'unitedoilgas');
  assert.ok(isSameAccount('Atelier Kerveil SARL', 'atelier kerveil'));
});

test('une forme juridique en DÉBUT de nom est gardée', () => {
  // « SA Comptoir du Textile » ne s'appelle pas « Comptoir du Textile » : ces
  // deux lettres font partie du nom, elles ne le qualifient pas.
  assert.strictEqual(normalizeAccountName('SA Comptoir du Textile'), 'sacomptoirdutextile');
  assert.ok(!isSameAccount('SA Comptoir du Textile', 'Comptoir du Textile'));
});

test('deux noms réellement différents ne fusionnent jamais', () => {
  // Le risque le plus cher : confondre deux vraies sociétés. Une faute de
  // frappe vaut mieux qu'une fusion à tort, elle au moins se voit.
  assert.ok(!isSameAccount('Groupe Martin', 'Groupe Martini'));
  assert.ok(!isSameAccount('Nexalis Conseil', 'Nexalis Formation'));
  assert.ok(!isSameAccount('Dunelia', 'Dunelia Logistique'));
});

test('un nom sans rien d\'identifiant rend null, jamais une chaîne vide', () => {
  // Chaîne vide, tous ces comptes se dédoubloneraient entre eux : l'index
  // unique les prendrait pour un seul. null les laisse distincts.
  assert.strictEqual(normalizeAccountName(''), null);
  assert.strictEqual(normalizeAccountName('   '), null);
  assert.strictEqual(normalizeAccountName('...'), null);
  assert.strictEqual(normalizeAccountName(null), null);
  assert.strictEqual(normalizeAccountName(undefined), null);
  assert.strictEqual(normalizeAccountName(42), null);
  // Et deux noms vides ne sont pas « la même société ».
  assert.ok(!isSameAccount('', ''));
  assert.ok(!isSameAccount(null, null));
});

test('un nom qui n\'est QUE sa forme juridique se garde', () => {
  // Sinon « SARL » seul deviendrait null et disparaîtrait. Le dépouillement
  // s'arrête tant qu'il reste un seul mot.
  assert.strictEqual(normalizeAccountName('SARL'), 'sarl');
});

test('plusieurs formes juridiques empilées tombent toutes', () => {
  assert.strictEqual(normalizeAccountName('Brumaire Logistique SAS SA'), 'brumairelogistique');
});
