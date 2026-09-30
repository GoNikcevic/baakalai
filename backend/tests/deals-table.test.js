/**
 * Test d'intégration · lot 4, la table `deals`.
 *
 * Ce que ce lot promet tient en une phrase : une affaire n'a plus besoin d'un
 * contact pour exister. Trois situations la faisaient disparaître, et ce sont
 * les trois que ces tests gardent.
 *
 *   1. Le CRM ne nomme aucun interlocuteur · c'est le cas des 308 Opportunity
 *      Salesforce d'un beta testeur, toutes rattachées à un compte
 *      parfaitement renseigné et toutes jetées par un `continue` muet.
 *   2. Le CRM nomme quelqu'un que nous n'avons pas importé.
 *   3. Deux affaires visent la même personne · la ligne d'opportunité n'en
 *      portant qu'une, la seconde était comptée en collision puis perdue.
 *
 * Le quatrième test est celui de la DOUBLE ÉCRITURE : tant que le lot 5 n'a
 * pas basculé les lecteurs, `opportunities` garde l'autorité et doit continuer
 * de se comporter exactement comme avant. Un lot qui répare la perte de
 * données en cassant les écrans n'a rien réparé.
 *
 * Le cinquième garde la devise, parce que c'est elle qui décide si une somme
 * de chiffre d'affaires est juste ou fausse (arbitrage Goran du 30/09 : on ne
 * convertit jamais, donc il faut au minimum savoir en quoi on compte).
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

/** Une société déjà importée, telle que le lot 2 la laisse en base. */
async function creerCompte(db, userId, { crmAccountId, name }) {
  const res = await db.query(
    `INSERT INTO accounts (user_id, crm_provider, crm_account_id, name, name_normalized, source)
     VALUES ($1, 'pipedrive', $2, $3, $4, 'crm') RETURNING id`,
    [userId, crmAccountId, name, name.toLowerCase()]
  );
  return res.rows[0].id;
}

test('une affaire sans interlocuteur existe quand meme, rattachee a sa societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { writeDeals } = require('../lib/deals');
  const { user } = await registerAndLogin();

  const compteId = await creerCompte(db, user.id, { crmAccountId: '10', name: 'Acme' });

  const res = await writeDeals(user.id, 'pipedrive', [
    {
      deal: {
        id: 501, name: 'Renouvellement Acme', status: 'open', value: 12000,
        currency: 'EUR', accountId: '10', createdAt: '2025-02-01T00:00:00.000Z',
        updatedAt: '2025-08-01T00:00:00.000Z',
      },
      contact: null,
    },
  ]);

  assert.strictEqual(res.ecrits, 1, 'l affaire est ecrite');
  assert.strictEqual(res.sansContact, 1, 'et comptee comme sans interlocuteur');

  const ligne = (await db.query('SELECT * FROM deals WHERE user_id = $1', [user.id])).rows[0];
  assert.ok(ligne, 'la ligne existe en base');
  assert.strictEqual(ligne.account_id, compteId, 'rattachee a la societe du deal');
  assert.strictEqual(ligne.primary_contact_id, null, 'sans interlocuteur, et ce NULL est la reponse juste');
  assert.strictEqual(
    ligne.crm_deal_attribution, 'account',
    'l attribution le DIT au lieu de deviner un porteur'
  );
  assert.strictEqual(Number(ligne.deal_value), 12000);
});

test('deux affaires sur la meme personne ont chacune leur ligne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { writeDeals } = require('../lib/deals');
  const { user } = await registerAndLogin();

  await creerCompte(db, user.id, { crmAccountId: '10', name: 'Acme' });
  const contact = await db.opportunities.create({
    userId: user.id, name: 'Lea Martin', email: 'lea@acme.io',
    status: 'imported', crmProvider: 'pipedrive', crmContactId: '900',
  });

  await writeDeals(user.id, 'pipedrive', [
    { deal: { id: 601, name: 'Socle', status: 'won', value: 30000, currency: 'EUR', accountId: '10' }, contact },
    // La seconde : avant le lot 4, comptee en collision puis perdue.
    { deal: { id: 602, name: 'Extension', status: 'open', value: 8000, currency: 'EUR', accountId: '10' }, contact },
  ]);

  const lignes = (await db.query(
    'SELECT * FROM deals WHERE user_id = $1 ORDER BY crm_deal_id', [user.id]
  )).rows;
  assert.strictEqual(lignes.length, 2, 'les DEUX affaires sont en base');
  assert.strictEqual(lignes[0].status, 'won');
  assert.strictEqual(lignes[1].status, 'open');
  assert.strictEqual(lignes[0].primary_contact_id, contact.id);
  assert.strictEqual(lignes[1].primary_contact_id, contact.id);

  // Un compte qui porte un gagne ET un ouvert, c'est la definition de
  // l'upsell · invisible par construction avant ce lot.
  const gagnes = lignes.filter(l => l.status === 'won').length;
  const ouverts = lignes.filter(l => l.status === 'open').length;
  assert.ok(gagnes >= 1 && ouverts >= 1, 'l upsell devient lisible sur le compte');
});

test('une resynchro met a jour sans dupliquer, et ne fait pas rajeunir l affaire', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { writeDeals } = require('../lib/deals');
  const { user } = await registerAndLogin();

  await creerCompte(db, user.id, { crmAccountId: '10', name: 'Acme' });

  const affaire = (recence, etape) => ([{
    deal: {
      id: 701, name: 'Acme', status: 'open', value: 5000, currency: 'EUR',
      accountId: '10', stage: etape, stageId: etape,
      updatedAt: recence, lastActivityAt: recence,
    },
    contact: null,
  }]);

  await writeDeals(user.id, 'pipedrive', affaire('2025-06-01T00:00:00.000Z', 'Qualification'));
  const premier = (await db.query('SELECT * FROM deals WHERE user_id = $1', [user.id])).rows[0];
  assert.strictEqual(
    premier.crm_stage_changed_at, null,
    'voir une etape pour la premiere fois n est pas la voir changer'
  );

  // Une lecture plus ANCIENNE ne doit pas ecraser la recence : sinon une
  // synchro partielle ferait passer une affaire figee pour une affaire active,
  // et la stagnation deviendrait indetectable.
  await writeDeals(user.id, 'pipedrive', affaire('2025-01-01T00:00:00.000Z', 'Qualification'));

  let lignes = (await db.query('SELECT * FROM deals WHERE user_id = $1', [user.id])).rows;
  assert.strictEqual(lignes.length, 1, 'toujours une seule ligne, l upsert ne duplique pas');
  assert.strictEqual(
    new Date(lignes[0].last_activity_at).toISOString().slice(0, 10), '2025-06-01',
    'la recence n avance jamais a reculons'
  );
  assert.strictEqual(lignes[0].crm_stage_changed_at, null, 'etape inchangee, horodatage inchange');

  // Cette fois l'etape bouge vraiment.
  await writeDeals(user.id, 'pipedrive', affaire('2025-09-01T00:00:00.000Z', 'Negociation'));
  lignes = (await db.query('SELECT * FROM deals WHERE user_id = $1', [user.id])).rows;
  assert.strictEqual(lignes[0].crm_stage, 'Negociation');
  assert.ok(lignes[0].crm_stage_changed_at, 'un vrai changement d etape est horodate');
  assert.strictEqual(
    new Date(lignes[0].last_activity_at).toISOString().slice(0, 10), '2025-09-01',
    'et la recence avance quand elle avance'
  );
});

test('la devise est celle du CRM, jamais un repli sur EUR', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { writeDeals } = require('../lib/deals');
  const { user } = await registerAndLogin();

  await creerCompte(db, user.id, { crmAccountId: '10', name: 'Acme' });

  await writeDeals(user.id, 'pipedrive', [
    { deal: { id: 801, status: 'won', value: 1000, currency: 'USD', accountId: '10' }, contact: null },
    // Connecteur muet sur la devise · le montant existe, sa devise est
    // INCONNUE. Supposer EUR ici, c'est fabriquer un total faux plus tard.
    { deal: { id: 802, status: 'won', value: 2000, accountId: '10' }, contact: null },
  ]);

  const lignes = (await db.query(
    'SELECT crm_deal_id, currency FROM deals WHERE user_id = $1 ORDER BY crm_deal_id', [user.id]
  )).rows;
  assert.strictEqual(lignes[0].currency, 'USD');
  assert.strictEqual(lignes[1].currency, null, 'devise inconnue reste NULL, elle ne devient pas EUR');
});

test('double ecriture · opportunities garde l autorite et la date de cloture arrive', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user } = await registerAndLogin();

  // La colonne de la migration 126 doit etre ecrite par le chemin update(),
  // sinon routes/analytics.js:1193 continue de lire une colonne vide et
  // l export renouvellement reste faux. Une colonne absente du mapping se perd
  // sans lever la moindre erreur : c'est le piege deja tombe quatre fois.
  const contact = await db.opportunities.create({
    userId: user.id, name: 'Paul Roy', email: 'paul@acme.io',
    status: 'imported', crmProvider: 'hubspot', crmContactId: '950',
  });
  assert.strictEqual(contact.close_date ?? null, null, 'aucune date de cloture a l import');

  const maj = await db.opportunities.update(contact.id, {
    closeDate: '2026-03-31T00:00:00.000Z',
    cooldownUntil: '2026-02-01T00:00:00.000Z',
  });
  assert.ok(maj, 'update() reconnait closeDate et cooldownUntil');
  assert.strictEqual(
    new Date(maj.close_date).toISOString().slice(0, 10), '2026-03-31',
    'la date de cloture prevue est enfin persistee'
  );
  assert.strictEqual(
    new Date(maj.cooldown_until).toISOString().slice(0, 10), '2026-02-01',
    'le cooldown par personne existe, le lot 6 en depend'
  );
});
