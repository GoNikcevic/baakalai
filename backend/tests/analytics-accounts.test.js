/**
 * L'analytics au niveau SOCIETE · lot 7.
 *
 * Tout le reste de la page Analytics compte des CONTACTS, et c'est juste pour un
 * funnel de personnes. Mais le pipeline, le cycle de vente et le risque sont des
 * faits d'entreprise : les lire sur la ligne du contact est ce qui rendait
 * 659 800 EUR invisibles sous Deals.
 *
 * Ce qui est verrouille ici : les montants viennent des affaires, les bandes de
 * risque ont les memes frontieres que partout ailleurs, et un chiffre non
 * mesurable est NULL et non zero.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function compte(db, userId, nom, score = null) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source, churn_score)
     VALUES ($1, $2, $3, 'crm', $4) RETURNING id`,
    [userId, nom, nom.toLowerCase(), score]
  );
  return r.rows[0].id;
}

async function contact(db, userId, accountId, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, status, deal_value, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, accountId, over.name || 'C', over.email || `c${Math.random()}@cli.fr`,
     over.status || 'won', over.dealValue ?? null, over.lastActivityAt || ago(5)]
  );
  return r.rows[0].id;
}

async function affaire(db, userId, accountId, contactId, over = {}) {
  await db.query(
    `INSERT INTO deals (user_id, account_id, primary_contact_id, status, deal_value,
                        crm_stage, won_date, lost_date, crm_created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [userId, accountId, contactId, over.status || 'open', over.value ?? null,
     over.stage || null, over.wonDate || null, over.lostDate || null, over.crmCreatedAt || null]
  );
}

test('le pipeline vient des affaires, pas de la ligne du contact', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const id = await compte(db, user.id, 'Deux Affaires', 10);
  // La ligne du contact ne porte qu'un montant : c'est la limite structurelle.
  const c = await contact(db, user.id, id, { dealValue: 10000, status: 'interested' });
  await affaire(db, user.id, id, c, { status: 'open', value: 10000, stage: 'Negociation' });
  await affaire(db, user.id, id, c, { status: 'open', value: 25000, stage: 'Proposition' });

  const r = await request('GET', '/api/analytics/accounts', { token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.source, 'deals', 'la reponse DIT de quelle table elle vient');
  assert.strictEqual(r.body.pipeline.openValue, 35000);
  assert.strictEqual(r.body.pipeline.openDeals, 2);
  assert.strictEqual(r.body.pipeline.avgTicket, 17500);
  // Les deux etapes apparaissent : un contact a deux affaires dans deux etapes
  // n'apparaissait que dans une.
  assert.strictEqual(r.body.stages.length, 2);
});

test('un taux de reussite non mesurable est NULL, jamais zero', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const id = await compte(db, user.id, 'Que De L Ouvert', 5);
  const c = await contact(db, user.id, id, { status: 'interested' });
  await affaire(db, user.id, id, c, { status: 'open', value: 5000 });

  const r = await request('GET', '/api/analytics/accounts', { token });
  // Zero pour cent se lit « on ne gagne jamais ». Aucun denouement se lit
  // « on ne sait pas encore ». Ce ne sont pas les memes nouvelles.
  assert.strictEqual(r.body.pipeline.winRate365d, null);
  assert.strictEqual(r.body.pipeline.avgCycleDays, null);
});

test('le taux de reussite se calcule sur les denouements de l annee', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const id = await compte(db, user.id, 'Denouements', 5);
  const c = await contact(db, user.id, id);
  await affaire(db, user.id, id, c, { status: 'won', value: 10000, wonDate: ago(30), crmCreatedAt: ago(90) });
  await affaire(db, user.id, id, c, { status: 'won', value: 10000, wonDate: ago(60), crmCreatedAt: ago(120) });
  await affaire(db, user.id, id, c, { status: 'lost', value: 5000, lostDate: ago(40) });

  const r = await request('GET', '/api/analytics/accounts', { token });
  assert.strictEqual(r.body.pipeline.won365d, 2);
  assert.strictEqual(r.body.pipeline.lost365d, 1);
  assert.strictEqual(r.body.pipeline.winRate365d, 67);
  // Cycle mesure sur la date de creation CRM, pas sur notre date d insertion.
  assert.strictEqual(r.body.pipeline.avgCycleDays, 60);
});

test('les bandes de risque ont les memes frontieres que partout ailleurs', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  // Frontieres de getChurnBand : 26, 51, 76. Une bande qui change de frontiere
  // selon l ecran est une bande a laquelle personne ne croit.
  await compte(db, user.id, 'Sain', 10);
  await compte(db, user.id, 'Limite Sain', 25);
  await compte(db, user.id, 'Moyen', 26);
  await compte(db, user.id, 'Limite Moyen', 50);
  await compte(db, user.id, 'Eleve', 51);
  await compte(db, user.id, 'Limite Eleve', 75);
  await compte(db, user.id, 'Critique', 76);
  await compte(db, user.id, 'Jamais Score', null);

  const r = await request('GET', '/api/analytics/accounts', { token });
  assert.deepStrictEqual(r.body.risk.bands, { healthy: 2, medium: 2, high: 2, critical: 1 });
  assert.strictEqual(r.body.risk.scored, 7);
  // Un compte jamais score est compte A PART, pas rangé dans « sain ».
  assert.strictEqual(r.body.risk.notScored, 1);
  assert.strictEqual(r.body.risk.threshold, 60);
  // Au seuil produit, seuls 75 et 76 sont au-dessus de 60.
  //
  // Et ce 2 met a nu une incoherence du vocabulaire, anterieure a ce lot : la
  // bande « eleve » de getChurnBand commence a 51, alors que le seuil « a
  // risque » du produit est 60. Un compte a 55 s affiche donc en « eleve » sans
  // etre compte parmi les clients a risque. Les deux chiffres sont justes, ils
  // ne repondent pas a la meme question, et l ecran doit les nommer autrement.
  // A trancher a part : deplacer la frontiere de bande toucherait la fiche
  // compte, la page A risque et le digest.
  assert.strictEqual(r.body.risk.atRisk, 2);
});

test('l upsell se compte sur les societes qui portent un gagne ET un ouvert', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const up = await compte(db, user.id, 'En Upsell', 10);
  const cu = await contact(db, user.id, up);
  await affaire(db, user.id, up, cu, { status: 'won', value: 30000, wonDate: ago(100) });
  await affaire(db, user.id, up, cu, { status: 'open', value: 20000 });

  const seulGagne = await compte(db, user.id, 'Que Gagne', 10);
  const cg = await contact(db, user.id, seulGagne);
  await affaire(db, user.id, seulGagne, cg, { status: 'won', value: 9000, wonDate: ago(200) });

  const r = await request('GET', '/api/analytics/accounts', { token });
  assert.strictEqual(r.body.accounts.upsell, 1, 'un gagne seul n est pas un upsell');
});

test('les comptes sans interlocuteur sont comptes a part', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const peuple = await compte(db, user.id, 'Peuple', 10);
  await contact(db, user.id, peuple);
  await contact(db, user.id, peuple);
  await contact(db, user.id, peuple);

  const unSeul = await compte(db, user.id, 'Un Seul', 10);
  await contact(db, user.id, unSeul);

  await compte(db, user.id, 'Fantome Un', null);
  await compte(db, user.id, 'Fantome Deux', null);

  const r = await request('GET', '/api/analytics/accounts', { token });
  const a = r.body.accounts;
  assert.strictEqual(a.total, 4);
  assert.strictEqual(a.withContact, 2);
  // C'est la dette de rattachement du lot 2, et elle doit se VOIR au lieu de se
  // deguiser en moyenne.
  assert.strictEqual(a.withoutContact, 2);
  assert.strictEqual(a.maxContacts, 3);
  assert.strictEqual(a.medianContacts, 1, 'la mediane de 0,0,1,3');
  assert.strictEqual(a.avgContacts, 1);
});

test('un tenant sans aucune affaire lit encore le contact, et le dit', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();

  const id = await compte(db, user.id, 'Sans Deals', 10);
  await contact(db, user.id, id, { status: 'interested', dealValue: 7000 });

  const r = await request('GET', '/api/analytics/accounts', { token });
  // Un chiffre qui DISPARAIT fait perdre confiance, un chiffre incomplet se
  // corrige. Et l ecran peut dire laquelle des deux sources a repondu.
  assert.strictEqual(r.body.source, 'opportunities');
  assert.strictEqual(r.body.pipeline.openValue, 7000);
});
