/**
 * Le rattachement contact -> compte, qui est la promesse du lot 2.
 *
 * Constat qui a motivé ces tests, mesuré sur staging le 30/09 : sur le tenant
 * Pipedrive, 100 comptes existent, 169 contacts, et seulement 26 rattachés.
 * Sur les 43 contacts qui portent un nom de société sans être rattachés, 35
 * ont pourtant DÉJÀ un compte au bon nom normalisé. Le rattachement aurait dû
 * les prendre.
 *
 * Un compte qui existe mais auquel personne n'est rattaché ne sert à rien : au
 * lot 5 les écrans liront les comptes, et ces 35 contacts deviendraient
 * invisibles alors qu'ils sont visibles aujourd'hui par leur nom de société.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

test('un contact rejoint le compte REEL qui porte deja son nom de societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { syncAccountsForUser } = require('../lib/accounts');
  const { normalizeAccountName } = require('../lib/account-name');
  const { user } = await registerAndLogin();

  // Un compte reel, tel que importCrmAccounts le pose depuis le CRM.
  const compte = await db.query(
    `INSERT INTO accounts (user_id, crm_provider, crm_account_id, name, name_normalized, source)
     VALUES ($1, 'pipedrive', '77', 'Astria Industries', $2, 'crm') RETURNING id`,
    [user.id, normalizeAccountName('Astria Industries')]
  );
  const compteId = compte.rows[0].id;

  // Deux contacts de cette societe, importes sans lien vers elle · c'est l'etat
  // de 35 lignes de staging.
  const a = await db.opportunities.create({
    userId: user.id, name: 'Lea Martin', email: 'lea@astria.io',
    company: 'Astria Industries', crmProvider: 'pipedrive', crmContactId: 'c1',
  });
  const b = await db.opportunities.create({
    userId: user.id, name: 'Paul Roy', email: 'paul@astria.io',
    // Meme societe ecrite autrement · c'est precisement ce que la
    // normalisation doit absorber.
    company: 'ASTRIA INDUSTRIES SAS', crmProvider: 'pipedrive', crmContactId: 'c2',
  });

  const res = await syncAccountsForUser(user.id, { provider: 'pipedrive' });

  const relus = await db.query(
    'SELECT id, account_id FROM opportunities WHERE user_id = $1 ORDER BY crm_contact_id', [user.id]
  );
  assert.strictEqual(relus.rows[0].account_id, compteId, 'le premier contact rejoint le compte reel');
  assert.strictEqual(relus.rows[1].account_id, compteId, 'le second aussi, malgre la forme juridique');
  assert.strictEqual(res.linked, 2, 'et la passe le compte');

  // Aucun compte derive ne doit avoir ete cree a cote du reel : ce serait la
  // meme societe en double, et le CA se couperait en deux.
  const comptes = await db.query('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [user.id]);
  assert.strictEqual(Number(comptes.rows[0].n), 1, 'un seul compte, le reel');

  assert.ok(a.id && b.id);
});

test('rejouer la passe ne deplace rien et ne duplique rien', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { syncAccountsForUser } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  await db.opportunities.create({
    userId: user.id, name: 'Seul', email: 's@globex.io',
    company: 'Globex', crmProvider: 'pipedrive', crmContactId: 'g1',
  });

  const un = await syncAccountsForUser(user.id, { provider: 'pipedrive' });
  assert.strictEqual(un.created, 1, 'un compte derive est cree');
  assert.strictEqual(un.linked, 1);

  const deux = await syncAccountsForUser(user.id, { provider: 'pipedrive' });
  assert.strictEqual(deux.created, 0, 'la seconde passe ne cree rien');
  assert.strictEqual(deux.linked, 0, 'et ne reecrit aucune ligne deja juste');

  const comptes = await db.query('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [user.id]);
  assert.strictEqual(Number(comptes.rows[0].n), 1);
});

test('un contact cree HORS import rejoint sa societe tout de suite', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { attachContactToAccount, syncAccountsForUser } = require('../lib/accounts');
  const { normalizeAccountName } = require('../lib/account-name');
  const { user } = await registerAndLogin();

  // Une societe deja connue, et un contact deja rattache.
  const compte = await db.query(
    `INSERT INTO accounts (user_id, crm_provider, crm_account_id, name, name_normalized, source)
     VALUES ($1, 'pipedrive', '77', 'Astria Industries', $2, 'crm') RETURNING id`,
    [user.id, normalizeAccountName('Astria Industries')]
  );
  const compteId = compte.rows[0].id;
  await db.opportunities.create({
    userId: user.id, name: 'Deja la', email: 'deja@astria.io', company: 'Astria Industries',
    crmProvider: 'pipedrive', crmContactId: 'c1',
  });
  await syncAccountsForUser(user.id, { provider: 'pipedrive' });

  // Puis un contact ne d'un webhook, de l'extension ou d'une saisie manuelle ·
  // aucun de ces chemins ne declenche la reconstruction des comptes.
  const nouveau = await db.opportunities.create({
    userId: user.id, name: 'Nouveau', email: 'n@astria.io', company: 'Astria Industries',
    status: 'new',
  });
  assert.strictEqual(nouveau.account_id ?? null, null, 'il nait sans compte, c est le point de depart');

  await attachContactToAccount(user.id, { contactId: nouveau.id, company: 'Astria Industries' });

  const relu = await db.query('SELECT account_id FROM opportunities WHERE id = $1', [nouveau.id]);
  assert.strictEqual(relu.rows[0].account_id, compteId, 'il rejoint le compte REEL, pas un derive');

  // Et surtout : la societe ne se coupe pas en deux. Sans le rattachement, elle
  // apparaitrait une fois sous son compte et une fois sous son nom.
  const comptes = await db.query('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [user.id]);
  assert.strictEqual(Number(comptes.rows[0].n), 1, 'une seule societe, pas deux');
});

test('un rattachement ne vole jamais un contact deja rattache ailleurs', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { attachContactToAccount } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const autre = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, 'Deja Choisi', 'dejachoisi', 'derived') RETURNING id`, [user.id]
  );
  const contact = await db.opportunities.create({
    userId: user.id, name: 'Lie', email: 'l@x.io', company: 'Astria Industries', status: 'new',
  });
  await db.opportunities.update(contact.id, { accountId: autre.rows[0].id });

  await attachContactToAccount(user.id, { contactId: contact.id, company: 'Astria Industries' });

  const relu = await db.query('SELECT account_id FROM opportunities WHERE id = $1', [contact.id]);
  assert.strictEqual(
    relu.rows[0].account_id, autre.rows[0].id,
    'le rattachement ne touche qu une ligne dont le compte est NULL'
  );
});

test('un contact sans societe exploitable n est rattache a rien', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { syncAccountsForUser } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  await db.opportunities.create({
    userId: user.id, name: 'Sans boite', email: 'x@perso.io',
    company: '   ', crmProvider: 'pipedrive', crmContactId: 'n1',
  });

  const res = await syncAccountsForUser(user.id, { provider: 'pipedrive' });
  assert.strictEqual(res.skipped, 1, 'compte comme sans societe');
  // Surtout pas un compte « inconnu » partage : ce serait des dizaines
  // d'entreprises sans lien dans le meme dossier (ecarte au 8.3 du plan).
  const comptes = await db.query('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [user.id]);
  assert.strictEqual(Number(comptes.rows[0].n), 0);
});
