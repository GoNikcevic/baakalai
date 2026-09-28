/**
 * Tests de la source de prospects « Entreprises France » · fonctions pures.
 *
 * Ce qui est verrouillé ici, ce sont les trois endroits où une erreur est
 * invisible mais coûteuse : la résolution des critères (un secteur mal résolu
 * donne une liste hors cible), le tri des dirigeants (une holding n'est pas un
 * interlocuteur) et la normalisation des noms (ce texte part dans un email lu
 * par un prospect).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  resolveNafCodes,
  resolveLocations,
  resolveTranches,
  isUsableDirigeant,
  companiesToContacts,
  toTitleCase,
  firstGivenName,
  ICP_TRANCHES,
} = require('../api/recherche-entreprises');

/* ── Résolution des secteurs ── */

test('code NAF brut accepté avec ou sans point', () => {
  assert.deepStrictEqual(resolveNafCodes(['70.22Z']).nafCodes, ['70.22Z']);
  assert.deepStrictEqual(resolveNafCodes(['7022Z']).nafCodes, ['70.22Z']);
});

test('preset sectoriel étendu en plusieurs codes NAF', () => {
  const { nafCodes } = resolveNafCodes(['informatique']);
  assert.ok(nafCodes.includes('62.02A'));
  assert.ok(nafCodes.length > 1);
});

test('preset reconnu malgré accents et casse', () => {
  assert.deepStrictEqual(resolveNafCodes(['Comptabilité']).nafCodes, ['69.20Z']);
});

test('secteur non résolu remonté à l appelant, jamais jeté en silence', () => {
  const { nafCodes, unresolved } = resolveNafCodes(['B2B']);
  assert.deepStrictEqual(nafCodes, []);
  assert.deepStrictEqual(unresolved, ['B2B']);
});

/* ── Résolution des zones ── */

test('code département conservé, nom de région traduit en code INSEE', () => {
  assert.deepStrictEqual(resolveLocations(['75', '92']).departements, ['75', '92']);
  assert.deepStrictEqual(resolveLocations(['Ile-de-France']).regions, ['11']);
});

test('France ne pose aucun filtre géographique', () => {
  const { departements, regions, unresolved } = resolveLocations(['France']);
  assert.deepStrictEqual([departements, regions, unresolved], [[], [], []]);
});

test('nom de ville non résolu remonté plutôt qu appliqué de travers', () => {
  assert.deepStrictEqual(resolveLocations(['Bordeaux']).unresolved, ['Bordeaux']);
});

/* ── Résolution des effectifs ── */

test('fourchette UI traduite en tranches INSEE', () => {
  assert.deepStrictEqual(resolveTranches(['11-50']), ['11', '12']);
});

test('tranche INSEE passée directement est conservée', () => {
  assert.deepStrictEqual(resolveTranches(['21']), ['21']);
});

test('aucun effectif demandé laisse le défaut ICP à l appelant', () => {
  assert.deepStrictEqual(resolveTranches([]), []);
  assert.ok(ICP_TRANCHES.includes('12'));
});

/* ── Tri des dirigeants ── */

test('personne physique nommée retenue', () => {
  assert.strictEqual(isUsableDirigeant({
    type_dirigeant: 'personne physique', nom: 'DUPONT', qualite: 'Président de SAS',
  }), true);
});

test('holding présidente écartée : aucun nom à contacter', () => {
  assert.strictEqual(isUsableDirigeant({
    type_dirigeant: 'personne morale', denomination: 'HOLDING X', qualite: 'Président de SAS',
  }), false);
});

test('commissaire aux comptes écarté : ce n est pas un interlocuteur commercial', () => {
  assert.strictEqual(isUsableDirigeant({
    type_dirigeant: 'personne physique', nom: 'MARTIN', qualite: 'Commissaire aux comptes titulaire',
  }), false);
});

/* ── Normalisation des noms ── */

test('majuscules du RNE remises en casse de nom propre', () => {
  assert.strictEqual(toTitleCase('JEAN-PIERRE'), 'Jean-Pierre');
});

test('particules de commune en minuscules', () => {
  assert.strictEqual(toTitleCase('ASNIERES-SUR-SEINE'), 'Asnieres-sur-Seine');
});

test('initiales capitalisées sans abîmer un nom de domaine', () => {
  assert.strictEqual(toTitleCase('D.L. DEVELOPPEMENT'), 'D.L. Developpement');
  assert.strictEqual(toTitleCase('ALTRNATIV.COM'), 'Altrnativ.com');
});

test('un seul prénom retenu sur toute la liste d état civil', () => {
  assert.strictEqual(firstGivenName('FRANCOIS CLEMENT OLIVIER HUGO'), 'Francois');
  assert.strictEqual(firstGivenName('JEAN-PIERRE'), 'Jean-Pierre');
});

/* ── Mise au format contact ── */

const COMPANY_FIXTURE = {
  siren: '123456789',
  nom_complet: 'ACME CONSEIL',
  activite_principale: '70.22Z',
  tranche_effectif_salarie: '12',
  date_creation: '2010-04-02',
  siege: { libelle_commune: 'PARIS', departement: '75', region: '11' },
  dirigeants: [
    { type_dirigeant: 'personne physique', nom: 'DUPONT', prenoms: 'MARIE CLAIRE', qualite: 'Président de SAS' },
    { type_dirigeant: 'personne morale', denomination: 'AUDIT SA', qualite: 'Commissaire aux comptes titulaire' },
    { type_dirigeant: 'personne physique', nom: 'BERNARD', prenoms: 'LUC', qualite: 'Directeur Général' },
  ],
};

test('un seul contact par entreprise par défaut', () => {
  const contacts = companiesToContacts([COMPANY_FIXTURE]);
  assert.strictEqual(contacts.length, 1);
  assert.strictEqual(contacts[0].name, 'Marie Dupont');
  assert.strictEqual(contacts[0].title, 'Président de SAS');
  assert.strictEqual(contacts[0].company, 'Acme Conseil');
  assert.strictEqual(contacts[0].location, 'Paris');
});

test('maxPerCompany saute le mandataire de contrôle sans le compter', () => {
  const contacts = companiesToContacts([COMPANY_FIXTURE], { maxPerCompany: 2 });
  assert.deepStrictEqual(contacts.map(c => c.name), ['Marie Dupont', 'Luc Bernard']);
});

test('email toujours nul : le registre publie des noms, pas des adresses', () => {
  const [contact] = companiesToContacts([COMPANY_FIXTURE]);
  assert.strictEqual(contact.email, null);
  assert.strictEqual(contact.source, 'sirene');
  assert.strictEqual(contact.companySizeLabel, '20 à 49 salariés');
  assert.strictEqual(contact.crmCreatedAt, '2010-04-02');
});

test('entreprise sans dirigeant nommé ne produit aucun contact', () => {
  const contacts = companiesToContacts([{
    ...COMPANY_FIXTURE,
    dirigeants: [{ type_dirigeant: 'personne morale', denomination: 'HOLDING', qualite: 'Président de SAS' }],
  }]);
  assert.deepStrictEqual(contacts, []);
});
