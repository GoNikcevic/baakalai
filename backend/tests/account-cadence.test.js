/**
 * Le PLAFOND D'ENVOI PAR SOCIETE · lot 6.
 *
 * Le lot 6 rend l'envoi multi-threade au niveau du compte. Le plan le classe en
 * risque « tres eleve » pour une raison precise : trois destinataires au meme
 * domaine la meme semaine est un motif de spam, et une reputation d'expediteur
 * met des mois a revenir.
 *
 * Ce fichier existe AVANT le reste du lot 6, et c'est deliberé : on construit
 * le frein avant l'accelerateur. Tant que ces tests ne passent pas, rien ne
 * doit pouvoir ecrire a deux personnes de la meme societe.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function societe(db, userId, nom) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`,
    [userId, nom, nom.toLowerCase()]
  );
  return r.rows[0].id;
}

async function contact(db, userId, accountId, email) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, status)
     VALUES ($1, $2, $3, $4, 'won') RETURNING id`,
    [userId, accountId, email.split('@')[0], email]
  );
  return r.rows[0].id;
}

async function envoiParti(db, userId, opportunityId, email, joursAvant = 1) {
  await db.query(
    `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, subject, body, status, sent_at)
     VALUES ($1, $2, $3, 'Relance', 'Corps', 'sent', $4)`,
    [userId, opportunityId, email, ago(joursAvant)]
  );
}

test('le plafond par defaut est de deux messages par societe et par semaine', async (t) => {
  await setup();
  t.after(teardown);

  const { getWeeklyCap, DEFAULT_WEEKLY_CAP } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  assert.strictEqual(DEFAULT_WEEKLY_CAP, 2, 'arbitrage Goran du 29/09');
  assert.strictEqual(await getWeeklyCap(user.id), 2);
});

test('sous le plafond, l envoi passe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'thomas@dunelia.fr');
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr');

  const r = await check(user.id, 'thomas@dunelia.fr');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.sent, 1);
  assert.strictEqual(r.cap, 2);
  assert.strictEqual(r.accountId, s);
  assert.ok(c2, 'le second interlocuteur existe');
});

test('deux envois a DEUX interlocuteurs differents saturent la MEME societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'thomas@dunelia.fr');
  await contact(db, user.id, s, 'luc@dunelia.fr');

  // C'est TOUT l'objet du plafond : il compte par societe, pas par personne.
  // Compte par personne, trois interlocuteurs recevraient trois messages le
  // meme jour au meme domaine.
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr');
  await envoiParti(db, user.id, c2, 'thomas@dunelia.fr');

  const r = await check(user.id, 'luc@dunelia.fr');
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'account_weekly_cap');
  assert.strictEqual(r.sent, 2);
});

test('une autre societe n est pas affectee par le plafond de sa voisine', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  const a = await societe(db, user.id, 'Saturee');
  const ca1 = await contact(db, user.id, a, 'un@saturee.fr');
  const ca2 = await contact(db, user.id, a, 'deux@saturee.fr');
  await envoiParti(db, user.id, ca1, 'un@saturee.fr');
  await envoiParti(db, user.id, ca2, 'deux@saturee.fr');

  const b = await societe(db, user.id, 'Tranquille');
  await contact(db, user.id, b, 'personne@tranquille.fr');

  assert.strictEqual((await check(user.id, 'un@saturee.fr')).allowed, false);
  assert.strictEqual((await check(user.id, 'personne@tranquille.fr')).allowed, true);
});

test('un brouillon en attente ne consomme PAS le plafond', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  await contact(db, user.id, s, 'thomas@dunelia.fr');

  // Un brouillon peut ne jamais partir. Bloquer sur une intention rendrait le
  // plafond dependant de l'ordre dans lequel on redige.
  await db.query(
    `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, subject, body, status)
     VALUES ($1, $2, $3, 'Brouillon', 'Corps', 'pending')`,
    [user.id, c1, 'claire@dunelia.fr']
  );

  const r = await check(user.id, 'thomas@dunelia.fr');
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(r.allowed, true);
});

test('un envoi plus vieux que la fenetre ne compte plus', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check, FENETRE_JOURS } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  assert.strictEqual(FENETRE_JOURS, 7);

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'thomas@dunelia.fr');
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr', 2);
  await envoiParti(db, user.id, c2, 'thomas@dunelia.fr', 9);

  const r = await check(user.id, 'claire@dunelia.fr');
  assert.strictEqual(r.sent, 1, 'seul l envoi de 2 jours compte, celui de 9 est sorti');
  assert.strictEqual(r.allowed, true);
});

test('un destinataire qu on ne sait pas rattacher n est pas plafonne, et on le DIT', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  // Pas de societe rattachee. Inventer un rattachement pour pouvoir compter
  // serait pire que ne pas compter.
  await db.query(
    `INSERT INTO opportunities (user_id, name, email, status) VALUES ($1, 'Solo', $2, 'won')`,
    [user.id, 'solo@ailleurs.fr']
  );

  const r = await check(user.id, 'solo@ailleurs.fr');
  assert.strictEqual(r.allowed, true);
  // « non attribuable » est volontairement distinct de « sous le plafond » :
  // l'un dit qu'on ne sait pas, l'autre qu'on a verifie.
  assert.strictEqual(r.reason, 'unattributable');
  assert.strictEqual(r.accountId, null);
});

test('le plafond se regle par utilisateur, et se borne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { check, getWeeklyCap, clampCap, MAX_CAP } = require('../lib/account-cadence');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  await contact(db, user.id, s, 'thomas@dunelia.fr');
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr');

  // Un plafond a 1 refuse des le second message de la semaine.
  await db.query(`UPDATE users SET settings = $2 WHERE id = $1`,
    [user.id, JSON.stringify({ account_weekly_cap: 1 })]);
  assert.strictEqual(await getWeeklyCap(user.id), 1);
  assert.strictEqual((await check(user.id, 'thomas@dunelia.fr')).allowed, false);

  // Zero est un choix legitime, pas une erreur de saisie : aucun envoi
  // automatique vers une societe identifiee.
  assert.strictEqual(clampCap(0), 0);
  // Et une valeur absurde est ramenee dans les bornes plutot que d'ouvrir les
  // vannes ou de tout bloquer.
  assert.strictEqual(clampCap(9999), MAX_CAP);
  assert.strictEqual(clampCap('pas un nombre'), 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// Le plafond est au TRANSPORT, donc incontournable
// ═══════════════════════════════════════════════════════════════════════════

test('le transport refuse lui-meme, un appelant ne peut pas contourner', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { sendPersonalEmail } = require('../lib/email-outbound');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'thomas@dunelia.fr');
  await contact(db, user.id, s, 'luc@dunelia.fr');
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr');
  await envoiParti(db, user.id, c2, 'thomas@dunelia.fr');

  const r = await sendPersonalEmail(user.id, {
    to: 'luc@dunelia.fr', toName: 'Luc', subject: 'Suite', body: 'Bonjour',
  });

  // Refus STRUCTURE et non exception : l'appelant doit pouvoir reporter au lieu
  // de reprogrammer le meme envoi tous les jours.
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.code, 'account_cadence_exceeded');
  assert.strictEqual(r.cadence.sent, 2);
  assert.strictEqual(r.cadence.cap, 2);
  assert.strictEqual(r.cadence.accountId, s);
});

test('un envoi declare MANUEL echappe au plafond', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { sendPersonalEmail } = require('../lib/email-outbound');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'claire@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'thomas@dunelia.fr');
  await contact(db, user.id, s, 'luc@dunelia.fr');
  await envoiParti(db, user.id, c1, 'claire@dunelia.fr');
  await envoiParti(db, user.id, c2, 'thomas@dunelia.fr');

  const r = await sendPersonalEmail(user.id, {
    to: 'luc@dunelia.fr', subject: 'Suite', body: 'Bonjour', manual: true,
  });

  // Un humain qui ecrit a un troisieme interlocuteur sait ce qu'il fait. Il
  // echoue ici pour une AUTRE raison, l'absence de boite d'envoi configuree :
  // la preuve que le plafond l'a laisse passer.
  assert.strictEqual(r.success, false);
  assert.notStrictEqual(r.code, 'account_cadence_exceeded');
});

test('fermé par defaut : un appelant qui ne dit rien est plafonne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { sendPersonalEmail } = require('../lib/email-outbound');
  const { user } = await registerAndLogin();

  const s = await societe(db, user.id, 'Dunelia');
  const c1 = await contact(db, user.id, s, 'a@dunelia.fr');
  const c2 = await contact(db, user.id, s, 'b@dunelia.fr');
  await contact(db, user.id, s, 'c@dunelia.fr');
  await envoiParti(db, user.id, c1, 'a@dunelia.fr');
  await envoiParti(db, user.id, c2, 'b@dunelia.fr');

  // Aucun drapeau passe : la polarite doit etre « plafonne », pour qu'un futur
  // chemin d'envoi qui oublierait la regle echoue du bon cote.
  const r = await sendPersonalEmail(user.id, { to: 'c@dunelia.fr', subject: 'S', body: 'B' });
  assert.strictEqual(r.code, 'account_cadence_exceeded');
});
