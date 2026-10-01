/**
 * La file « A relancer », groupee par SOCIETE · lot 7.
 *
 * Elle rendait un CONTACT par ligne. Une societe a trois interlocuteurs
 * dormants y apparaissait donc trois fois, et un envoi groupe faisait partir
 * trois messages au meme domaine le meme jour : le motif de spam exact que la
 * regle du lot 5 interdit.
 *
 * Arbitrage tenu ici : une ligne par AFFAIRE, parce que c'est l'affaire qu'on
 * relance et qu'elle porte le montant, mais GROUPEES par societe avec un seul
 * envoi. Ce que ces tests verrouillent, c'est que la SELECTION ne change pas :
 * une societe entre dans la file si l'un de ses contacts est du, exactement
 * comme avant.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function compte(db, userId, nom) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`,
    [userId, nom, nom.toLowerCase()]
  );
  return r.rows[0].id;
}

async function contact(db, userId, accountId, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, company, status,
                                deal_value, last_activity_at, is_primary_contact, email_bounced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [userId, accountId, over.name || 'Contact', over.email ?? `c${Math.random()}@cli.fr`,
     over.company || 'Cli', over.status || 'interested', over.dealValue ?? null,
     over.lastActivityAt || ago(120), over.primary || false, over.bouncedAt || null]
  );
  return r.rows[0].id;
}

async function affaire(db, userId, accountId, over = {}) {
  await db.query(
    `INSERT INTO deals (user_id, account_id, name, status, deal_value, crm_stage, crm_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, accountId, over.name || 'Affaire', over.status || 'open',
     over.value ?? null, over.stage || null, over.updatedAt || ago(90)]
  );
}

test('trois interlocuteurs dormants d une meme societe font UNE carte', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const id = await compte(db, user.id, 'Dunelia');
  await contact(db, user.id, id, { name: 'Un', lastActivityAt: ago(100) });
  await contact(db, user.id, id, { name: 'Deux', primary: true, lastActivityAt: ago(150) });
  await contact(db, user.id, id, { name: 'Trois', lastActivityAt: ago(90) });

  const file = await listDealsToReactivate(user.id);
  assert.strictEqual(file.length, 1, 'trois contacts dormants, une seule carte');
  assert.strictEqual(file[0].contactsCount, 3);
  // L'envoi part vers le principal, parce qu'on ecrit a une personne.
  assert.strictEqual(file[0].name, 'Deux');
  // Le retard affiche est celui du contact LE PLUS en retard : c'est lui qui a
  // fait entrer la societe dans la file.
  assert.ok(file[0].overdueDays >= 150, `retard ${file[0].overdueDays} devrait venir du plus muet`);
});

test('les affaires ouvertes de la societe sont listees, les closes non', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const id = await compte(db, user.id, 'Trois Affaires');
  await contact(db, user.id, id, { primary: true, lastActivityAt: ago(120) });
  await affaire(db, user.id, id, { name: 'Refonte', value: 210400, stage: 'Qualified', updatedAt: ago(94) });
  await affaire(db, user.id, id, { name: 'Maintenance', value: 98000, stage: 'Contact Made' });
  await affaire(db, user.id, id, { name: 'Deja gagnee', value: 50000, status: 'won' });

  const [c] = await listDealsToReactivate(user.id);
  assert.strictEqual(c.deals.length, 2, 'une affaire gagnee n a plus rien a relancer');
  // Triees par montant : on relance d'abord ce qui pese.
  assert.strictEqual(c.deals[0].name, 'Refonte');
  assert.strictEqual(c.deals[0].stalledDays >= 94, true);
  // Le montant de la carte est la SOMME des affaires ouvertes, pas celui d'une
  // ligne de contact qui n'en porte qu'une.
  assert.strictEqual(c.dealValue, 308400);
});

test('un contact sans societe reste sa propre carte', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  // `account_id` NULL veut dire « societe inconnue », pas « meme societe » :
  // les fusionner n'en garderait qu'un pour tout le reste de la base.
  await contact(db, user.id, null, { name: 'Solo Un', company: 'Maison A', dealValue: 4000, lastActivityAt: ago(100) });
  await contact(db, user.id, null, { name: 'Solo Deux', company: 'Maison B', dealValue: 6000, lastActivityAt: ago(110) });

  const file = await listDealsToReactivate(user.id);
  assert.strictEqual(file.length, 2, 'deux contacts sans societe sont deux sujets distincts');
  assert.deepStrictEqual(file.map(c => c.deals.length), [0, 0],
    'sans societe rattachee, aucune affaire a lister');
  // Le repli sur la ligne du contact reste la seule reponse possible.
  assert.deepStrictEqual(file.map(c => c.dealValue).sort((a, b) => a - b), [4000, 6000]);
});

test('on n ecrit jamais a une adresse qui a rebondi', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const id = await compte(db, user.id, 'Adresses Mortes');
  await contact(db, user.id, id, { name: 'Principal Parti', primary: true, bouncedAt: ago(20), lastActivityAt: ago(130) });
  await contact(db, user.id, id, { name: 'Encore La', lastActivityAt: ago(100) });

  const [c] = await listDealsToReactivate(user.id);
  assert.strictEqual(c.name, 'Encore La', 'la cible passe au suivant joignable');
  assert.strictEqual(c.injoignable, false);
});

test('une societe dont toutes les adresses ont rebondi reste listee, et le DIT', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const id = await compte(db, user.id, 'Plus Personne');
  await contact(db, user.id, id, { name: 'Parti', primary: true, bouncedAt: ago(10), lastActivityAt: ago(140) });
  await affaire(db, user.id, id, { name: 'Contrat en suspens', value: 65900 });

  const [c] = await listDealsToReactivate(user.id);
  // La masquer ferait disparaitre une affaire ouverte de 65 900 EUR. L'ecran
  // doit pouvoir dire pourquoi rien ne partira.
  assert.ok(c, 'la carte existe');
  assert.strictEqual(c.injoignable, true);
  assert.strictEqual(c.email, null, 'aucune adresse a proposer, et ce null est la reponse juste');
  assert.strictEqual(c.deals.length, 1);
});

test('la selection ne change pas : un contact a jour ne fait pas entrer sa societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listDealsToReactivate } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const frais = await compte(db, user.id, 'Tout Frais');
  await contact(db, user.id, frais, { lastActivityAt: ago(2) });
  await affaire(db, user.id, frais, { value: 90000 });

  const vieux = await compte(db, user.id, 'Endormi');
  await contact(db, user.id, vieux, { lastActivityAt: ago(200) });

  const file = await listDealsToReactivate(user.id);
  assert.deepStrictEqual(file.map(c => c.company === 'Cli' ? c.name : c.company).length, 1,
    'une seule societe entre dans la file');
  assert.strictEqual(file.length, 1);
  assert.ok(file[0].overdueDays >= 200);
});
