/**
 * La bascule des lecteurs vers `deals` (lot 5, lib/deal-reads.js).
 *
 * Le defaut repare, mesure sur staging le 2026-10-01 : `opportunities` voyait
 * 109 affaires et 2 644 400 €, `deals` 121 et 3 008 000 €. Deux affaires ne
 * tiennent pas sur la ligne d une personne, la plus recemment modifiee reclame
 * la ligne et les autres sont jetees. 13,8 % du pipeline etait absent de tout
 * ce que l assistant analytique affirmait.
 *
 * Ces tests verrouillent les deux proprietes qui comptent : on voit DAVANTAGE
 * qu avant, et un tenant sans `deals` ne tombe JAMAIS a zero.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function poserContact(db, userId, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, name, email, company, status, deal_value, crm_stage, last_activity_at)
     VALUES ($1, 'Contact', $2, 'Client SARL', $3, $4, $5, $6) RETURNING id`,
    [userId, over.email || `c${Math.random()}@client.fr`, over.status || 'open',
     over.dealValue ?? null, over.stage ?? null, over.lastActivityAt || ago(5)]
  );
  return r.rows[0].id;
}

test('deux affaires sur le MEME contact sont enfin vues toutes les deux', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { dealTotals } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  // Le contact ne peut porter qu UN montant : c est la limite structurelle.
  const contactId = await poserContact(db, user.id, { dealValue: 10000, stage: 'Negociation' });

  // La table deals, elle, en porte deux.
  await db.query(
    `INSERT INTO deals (user_id, primary_contact_id, status, deal_value, crm_stage)
     VALUES ($1, $2, 'open', 10000, 'Negociation'), ($1, $2, 'open', 25000, 'Proposition')`,
    [user.id, contactId]
  );

  const r = await dealTotals(user.id);
  assert.strictEqual(r.source, 'deals');
  assert.strictEqual(r.open_deals, 2, 'les deux affaires du contact doivent compter');
  assert.strictEqual(r.open_value, 35000,
    'le montant doit etre la somme des deux, pas celui de la ligne du contact');
});

test('un tenant sans aucune affaire dans deals ne tombe pas a zero', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { dealTotals, hasDeals } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  await poserContact(db, user.id, { dealValue: 7000, stage: 'Devis' });

  assert.strictEqual(await hasDeals(user.id), false);
  const r = await dealTotals(user.id);

  // C est tout l interet du repli : un chiffre qui DISPARAIT fait perdre
  // confiance, un chiffre incomplet se corrige.
  assert.strictEqual(r.source, 'opportunities');
  assert.strictEqual(r.open_value, 7000);
  assert.strictEqual(r.open_deals, 1);
});

test('les etapes se comptent par affaire, pas par personne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { openDealsByStage } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  const contactId = await poserContact(db, user.id, { dealValue: 10000, stage: 'Negociation' });
  await db.query(
    `INSERT INTO deals (user_id, primary_contact_id, status, deal_value, crm_stage)
     VALUES ($1, $2, 'open', 10000, 'Negociation'), ($1, $2, 'open', 25000, 'Proposition')`,
    [user.id, contactId]
  );

  const r = await openDealsByStage(user.id);
  assert.strictEqual(r.source, 'deals');
  // Un contact a deux affaires dans deux etapes n apparaissait que dans une.
  assert.strictEqual(r.stages.length, 2, 'les deux etapes doivent apparaitre');
  const parNom = new Map(r.stages.map(s => [s.stage, s.value]));
  assert.strictEqual(parNom.get('Negociation'), 10000);
  assert.strictEqual(parNom.get('Proposition'), 25000);
});

test('une etape chez Salesforce, ou le libelle EST l identifiant, remonte bien', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { openDealsByStage } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  // Le piege qui a fait retirer un garde-fou : chez Salesforce, StageName sert
  // a la fois de libelle et d identifiant. Une heuristique du type « ce n est un
  // libelle que s il differe de l id » aurait donc retrograde le seul provider
  // qui n a jamais eu le probleme.
  const contactId = await poserContact(db, user.id, { dealValue: 10000, stage: 'Negociation' });
  await db.query(
    `INSERT INTO deals (user_id, primary_contact_id, status, deal_value, crm_stage, crm_stage_id)
     VALUES ($1, $2, 'open', 10000, 'Negociation', 'Negociation')`,
    [user.id, contactId]
  );

  const r = await openDealsByStage(user.id);
  assert.strictEqual(r.source, 'deals');
  assert.strictEqual(r.stages[0].stage, 'Negociation');
});

test('les affaires closes sortent du pipeline ouvert', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { dealTotals } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  const contactId = await poserContact(db, user.id, { dealValue: 1000 });
  await db.query(
    `INSERT INTO deals (user_id, primary_contact_id, status, deal_value, won_date, lost_date)
     VALUES ($1, $2, 'open', 5000, NULL, NULL),
            ($1, $2, 'won', 8000, $3, NULL),
            ($1, $2, 'lost', 3000, NULL, $3)`,
    [user.id, contactId, ago(10)]
  );

  const r = await dealTotals(user.id);
  assert.strictEqual(r.open_value, 5000, 'seule l affaire ouverte pese dans le pipeline');
  assert.strictEqual(r.open_deals, 1);
  assert.strictEqual(r.won_90d, 1);
  assert.strictEqual(r.lost_90d, 1);
});

test('le perimetre filtre par contacts porte bien sur les affaires de ces contacts', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { dealTotals } = require('../lib/deal-reads');
  const { user } = await registerAndLogin();

  const a = await poserContact(db, user.id, { email: 'a@client.fr' });
  const b = await poserContact(db, user.id, { email: 'b@client.fr' });
  await db.query(
    `INSERT INTO deals (user_id, primary_contact_id, status, deal_value)
     VALUES ($1, $2, 'open', 1000), ($1, $3, 'open', 9000)`,
    [user.id, a, b]
  );

  const tous = await dealTotals(user.id);
  assert.strictEqual(tous.open_value, 10000);

  const seulementA = await dealTotals(user.id, { contactIds: [a] });
  assert.strictEqual(seulementA.open_value, 1000, 'le filtre doit retenir la seule affaire de A');
});
