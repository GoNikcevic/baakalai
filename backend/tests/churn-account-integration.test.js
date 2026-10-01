/**
 * Le scoring de churn par COMPTE, de bout en bout (lot 5, migration 131).
 *
 * Les tests unitaires de churn-account.test.js verrouillent le BAREME. Ceux-ci
 * verrouillent le SQL, qui est la partie la plus facile a casser en silence :
 * les placeholders de l UPDATE groupe, le COALESCE qui ne doit pas effacer
 * last_activity_at, et l insertion d un historique de compte, impossible avant
 * que la 131 rende churn_score_history.opportunity_id facultative.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function poserCompte(db, userId, nom, over = {}) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source, crm_created_at, last_activity_at)
     VALUES ($1, $2, $3, 'crm', $4, $5) RETURNING id`,
    [userId, nom, nom.toLowerCase(), over.crmCreatedAt || ago(400), over.lastActivityAt || null]
  );
  return r.rows[0].id;
}

/**
 * Deux emails restes sans reponse. Sans eux, un client muet depuis 150 jours
 * plafonne a 55 (30 inactivite + 20 client silencieux + 5 aucun email) et reste
 * SOUS le seuil de 60 : c est le bareme du contact, repris tel quel, et c est
 * exactement ce que l arbitrage du 01/10 demandait. Le cas realiste d un client
 * qui part comporte des relances sans reponse.
 */
async function poserEmailsSansReponse(db, userId, email) {
  for (let i = 0; i < 2; i++) {
    await db.query(
      `INSERT INTO nurture_emails (user_id, to_email, subject, body, status, created_at)
       VALUES ($1, $2, 'Relance', 'Corps', 'sent', $3)`,
      [userId, email, new Date(Date.now() - (5 + i) * DAY).toISOString()]
    );
  }
}

async function poserContact(db, userId, accountId, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, company, status,
                                last_activity_at, is_primary_contact)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, accountId, over.name || 'Contact', over.email || `c${Math.random()}@client.fr`,
     'Client SARL', over.status || 'won', over.lastActivityAt || ago(5), over.primary || false]
  );
  return r.rows[0].id;
}

test('un compte muet est score, horodate et historise', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { scoreAccountsForUser, AT_RISK_THRESHOLD } = require('../lib/churn-scoring');
  const { user } = await registerAndLogin();

  const compteId = await poserCompte(db, user.id, 'Silencieuse');
  await poserContact(db, user.id, compteId, { email: 'muet@client.fr', lastActivityAt: ago(150) });
  await poserEmailsSansReponse(db, user.id, 'muet@client.fr');

  const rapport = await scoreAccountsForUser(user.id);
  assert.strictEqual(rapport.scored, 1);

  const { rows } = await db.query('SELECT * FROM accounts WHERE id = $1', [compteId]);
  const compte = rows[0];

  assert.ok(compte.churn_score >= AT_RISK_THRESHOLD,
    `un client muet depuis 150 jours devrait etre a risque, score ${compte.churn_score}`);
  assert.ok(compte.churn_scored_at, 'churn_scored_at doit etre horodate');
  assert.ok(compte.churn_flagged_at, 'le franchissement du seuil doit etre date');
  assert.ok(compte.last_activity_at, 'la recence du compte doit etre renseignee (lot 5)');

  // L historique de COMPTE : impossible avant la 131, opportunity_id etait NOT NULL.
  const hist = await db.query(
    'SELECT * FROM churn_score_history WHERE account_id = $1', [compteId]
  );
  assert.strictEqual(hist.rows.length, 1, 'une ligne d historique par compte et par run');
  assert.strictEqual(hist.rows[0].opportunity_id, null, 'une ligne de compte ne porte pas de contact');
});

test('un seul contact actif suffit a maintenir tout le compte en vie', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { scoreAccountsForUser, AT_RISK_THRESHOLD } = require('../lib/churn-scoring');
  const { user } = await registerAndLogin();

  // C est l arbitrage du 01/10, verifie sur la vraie requete : quatre contacts
  // dorment, un seul a bouge il y a trois jours.
  const compteId = await poserCompte(db, user.id, 'Vivante');
  for (let i = 0; i < 4; i++) {
    await poserContact(db, user.id, compteId, { lastActivityAt: ago(200) });
  }
  await poserContact(db, user.id, compteId, { lastActivityAt: ago(3) });

  await scoreAccountsForUser(user.id);
  const { rows } = await db.query('SELECT churn_score, churn_flagged_at, churn_factors FROM accounts WHERE id = $1', [compteId]);

  assert.ok(rows[0].churn_score < AT_RISK_THRESHOLD,
    `le compte ne doit pas etre signale, score ${rows[0].churn_score}`);
  assert.strictEqual(rows[0].churn_flagged_at, null);

  // La trace de QUI a maintenu le compte en vie, qui rend l arbitrage revisable.
  // Postgres rend du jsonb deja decode, le miroir SQLite une chaine : on couvre
  // les deux, et un JSON illisible doit faire echouer le test en le DISANT,
  // jamais exploser sur un parse nu.
  let facteurs = rows[0].churn_factors;
  if (typeof facteurs === 'string') {
    try {
      facteurs = JSON.parse(facteurs);
    } catch (err) {
      assert.fail(`churn_factors illisible : ${err.message}`);
    }
  }
  assert.ok(Array.isArray(facteurs), 'churn_factors doit etre une liste de facteurs');
  assert.ok(facteurs.some(f => f.signal === 'activity_source'),
    'le facteur activity_source doit nommer le contact porteur');
});

test('le franchissement du seuil n est date qu une fois', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { scoreAccountsForUser } = require('../lib/churn-scoring');
  const { user } = await registerAndLogin();

  const compteId = await poserCompte(db, user.id, 'Repetitive');
  await poserContact(db, user.id, compteId, { lastActivityAt: ago(150) });

  await scoreAccountsForUser(user.id);
  const premier = (await db.query('SELECT churn_flagged_at FROM accounts WHERE id = $1', [compteId])).rows[0].churn_flagged_at;

  await scoreAccountsForUser(user.id);
  const second = (await db.query('SELECT churn_flagged_at FROM accounts WHERE id = $1', [compteId])).rows[0].churn_flagged_at;

  // Sans cette garde, le declencheur reproposerait le meme client a chaque run.
  assert.deepStrictEqual(new Date(second).getTime(), new Date(premier).getTime(),
    'churn_flagged_at date le franchissement, pas l etat');
});

test('loadAccountChurn ne rend que les comptes reellement signales', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { scoreAccountsForUser, loadAccountChurn } = require('../lib/churn-scoring');
  const { user } = await registerAndLogin();

  const aRisque = await poserCompte(db, user.id, 'ARisque');
  await poserContact(db, user.id, aRisque, { email: 'perdu@client.fr', lastActivityAt: ago(150) });
  await poserEmailsSansReponse(db, user.id, 'perdu@client.fr');
  const sain = await poserCompte(db, user.id, 'Saine');
  await poserContact(db, user.id, sain, { email: 'ok@client.fr', lastActivityAt: ago(2) });

  await scoreAccountsForUser(user.id);
  const map = await loadAccountChurn(user.id);

  assert.ok(map.has(aRisque), 'le compte signale doit etre dans la Map');
  assert.ok(!map.has(sain), 'un compte sain n a rien a y faire');
  assert.ok(map.get(aRisque).flaggedAt && map.get(aRisque).score >= 60);
});

test('un compte sans aucun contact rattache n est PAS score', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { scoreAccountsForUser } = require('../lib/churn-scoring');
  const { user } = await registerAndLogin();

  // Le cas mesure sur staging le 01/10 : 54 comptes sur 103 sans contact
  // rattache, dette du lot 2. Les scorer les faisait passer pour sains (score
  // calcule sur la date de creation du compte) tout en leur collant +10 de
  // « injoignable ». Inconnu ne vaut pas zero.
  const orphelin = await poserCompte(db, user.id, 'SansPersonne');
  const peuple = await poserCompte(db, user.id, 'AvecDuMonde');
  await poserContact(db, user.id, peuple, { lastActivityAt: ago(5) });

  const rapport = await scoreAccountsForUser(user.id);

  assert.strictEqual(rapport.scored, 1, 'un seul compte est scorable');
  assert.strictEqual(rapport.notScored, 1, 'le compte orphelin doit etre compte a part');

  const o = (await db.query('SELECT churn_score, churn_factors FROM accounts WHERE id = $1', [orphelin])).rows[0];
  assert.strictEqual(o.churn_score, null, 'un compte sans contact reste a NULL, jamais a un chiffre');
  assert.strictEqual(o.churn_factors, null);

  const p = (await db.query('SELECT churn_score FROM accounts WHERE id = $1', [peuple])).rows[0];
  assert.notStrictEqual(p.churn_score, null, 'le compte peuple, lui, est bien score');
});

test('le comptage des sieges lit les trois niveaux', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { computeIcpSignals } = require('../lib/icp-signals');
  const { user } = await registerAndLogin();

  // Le cas de la production : les contacts ne portent AUCUN owner, seuls le
  // compte et l affaire en ont un. Avant le lot 5, le signal restait NULL.
  const compteId = await poserCompte(db, user.id, 'AvecOwners');
  await db.query(`UPDATE accounts SET crm_owner_id = 'u-100' WHERE id = $1`, [compteId]);
  await poserContact(db, user.id, compteId, { status: 'won' });
  await db.query(
    `INSERT INTO deals (user_id, account_id, status, crm_owner_id) VALUES ($1, $2, 'open', 'u-200')`,
    [user.id, compteId]
  );

  await computeIcpSignals(user.id);
  const { rows } = await db.query('SELECT icp_crm_seat_count FROM user_profiles WHERE user_id = $1', [user.id]);

  assert.strictEqual(rows[0].icp_crm_seat_count, 2,
    'deux owners distincts, un sur le compte et un sur l affaire');
});
