/**
 * La file de correction de l'onglet Général · ce qu'on propose, et dans quel
 * ordre on le propose.
 *
 * L'écran d'avant posait 169 champs vides à plat. Deux choses le rendaient
 * inutilisable, et ce sont exactement les deux que cette fonction règle :
 *
 *  1. L'ORDRE. À plat, personne ne descend au-delà de la deuxième page. Si les
 *     contacts qui portent un deal ouvert ne remontent pas en tête, la seule
 *     partie du travail qui rapporte quelque chose est celle qu'on ne fait
 *     jamais. Le tri est donc une décision produit, pas une commodité.
 *
 *  2. LA PROPOSITION. Elle sera acceptée en masse par un « Tout accepter »,
 *     donc une valeur fausse mais plausible finit écrite dans le CRM du client.
 *     D'où la règle : dans le doute, ne rien proposer, le champ reste vide et
 *     l'utilisateur tape, comme avant. Ne jamais proposer coûte une frappe ;
 *     proposer faux coûte une donnée corrompue et personne ne le voit passer.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// routes/data-quality.js monte un Router et tire la base au chargement · la
// base simulée n'a rien à rendre ici, la fonction testée est pure, mais le
// require doit aboutir.
const dbPath = require.resolve('../db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [],
  exports: { query: async () => ({ rows: [] }), crmCleaningReports: {} },
};

const { buildFixQueueRows } = require('../routes/data-quality');
const { buildDomainCompanyMap } = require('../lib/company-from-email');

const ctx = (rows) => new Map(rows.map(r => [String(r.key), r]));

test('l\'entreprise se propose depuis le domaine, et reprend la graphie du CRM', () => {
  const domainMap = buildDomainCompanyMap([{ email: 'deja@acme.fr', company: 'Acme SAS' }]);
  const rows = buildFixQueueRows({
    field: 'company',
    domainMap,
    contextById: ctx([]),
    flagged: [
      { id: 1, name: 'Laura Jacquet', email: 'laura@acme.fr' },
      { id: 2, name: 'Thomas Guerin', email: 'thomas@kerveil-industries.fr' },
      { id: 3, name: 'Sandrine Berger', email: 'sandrine.berger@gmail.com' },
      { id: 4, name: 'Mehdi Benali', email: null },
    ],
  });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));

  assert.strictEqual(by[1].suggestion, 'Acme SAS');
  assert.strictEqual(by[1].suggestionSource, 'crm', 'la graphie du CRM prime sur celle du domaine');
  assert.strictEqual(by[2].suggestion, 'Kerveil Industries');
  assert.strictEqual(by[2].suggestionSource, 'domain');
  assert.strictEqual(by[3].suggestion, null, 'gmail.com ne dit rien de l\'employeur');
  assert.strictEqual(by[4].suggestion, null, 'sans adresse, rien à déduire');
});

test('une faute de frappe d\'adresse arrive déjà corrigée', () => {
  const rows = buildFixQueueRows({
    field: 'email',
    domainMap: new Map(),
    contextById: ctx([]),
    flagged: [
      { id: 1, name: 'Laura Jacquet', email: 'laura@gmial.com', suggestedFix: 'laura@gmail.com' },
      { id: 2, name: 'Thomas Guerin', email: 'thomas@@acme.fr' },
    ],
  });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));

  assert.deepStrictEqual(
    [by[1].suggestion, by[1].suggestionSource],
    ['laura@gmail.com', 'typo']
  );
  assert.strictEqual(by[2].suggestion, null, 'une adresse mal formée n\'a pas de correction déductible');
  assert.strictEqual(by[2].currentValue, 'thomas@@acme.fr',
    'la valeur actuelle est renvoyée pour que le champ parte de l\'adresse à réparer');
});

/**
 * Trois niveaux, dans cet ordre : le pipeline ouvert, puis le poids du compte,
 * puis la fraîcheur. Le deuxième niveau compte le montant d'un deal même gagné,
 * et c'est voulu : un client à 90 000 euros reste un client, donc une base
 * d'upsell et de rétention, là où une fiche sans aucun deal ne pèse rien même
 * si quelqu'un l'a touchée la semaine dernière.
 */
test('les contacts qui portent un deal ouvert passent devant', () => {
  const rows = buildFixQueueRows({
    field: 'company',
    domainMap: new Map(),
    contextById: ctx([
      { key: '1', status: 'new', deal_value: 4000, last_activity_at: '2026-01-01' },
      { key: '2', status: 'new', deal_value: 42000, last_activity_at: '2026-01-01' },
      { key: '3', status: 'won', deal_value: 90000, last_activity_at: '2026-09-01' },
      { key: '4', status: 'new', deal_value: 0, last_activity_at: '2026-09-20' },
    ]),
    flagged: [
      { id: 4, name: 'Fiche sans montant mais active', email: 'd@d.fr' },
      { id: 3, name: 'Deal deja gagne', email: 'c@c.fr' },
      { id: 1, name: 'Petit deal ouvert', email: 'a@a.fr' },
      { id: 2, name: 'Gros deal ouvert', email: 'b@b.fr' },
    ],
  });

  assert.deepStrictEqual(rows.map(r => r.id), [2, 1, 3, 4],
    'les deux deals ouverts d\'abord, du plus gros au plus petit, puis le client gagné, '
    + 'puis la fiche sans montant');
  assert.strictEqual(rows[0].hasOpenDeal, true);
  assert.strictEqual(rows.find(r => r.id === 3).hasOpenDeal, false,
    'un deal gagné n\'est plus un deal ouvert, même à 90 000 euros : il passe derrière '
    + 'un deal ouvert à 4 000, mais devant une fiche sans montant');
});

test('un contact introuvable en base reste dans la file, signalé comme tel', () => {
  const rows = buildFixQueueRows({
    field: 'company',
    domainMap: new Map(),
    contextById: ctx([]),
    flagged: [{ id: 7, name: 'Contact du CRM seulement', email: 'x@acme-test.fr' }],
  });

  assert.strictEqual(rows.length, 1, 'ne jamais perdre un contact signalé par le scan');
  assert.strictEqual(rows[0].known, false);
  assert.strictEqual(rows[0].dealValue, 0);
  assert.strictEqual(rows[0].suggestion, 'Acme Test');
});

test('une file vide ne fait pas planter', () => {
  assert.deepStrictEqual(
    buildFixQueueRows({ field: 'company', domainMap: new Map(), contextById: ctx([]), flagged: [] }),
    []
  );
  assert.deepStrictEqual(
    buildFixQueueRows({ field: 'company', domainMap: new Map(), contextById: ctx([]), flagged: null }),
    []
  );
});
