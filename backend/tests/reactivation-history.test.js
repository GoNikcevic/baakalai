/**
 * L'HISTORIQUE doit dire ce que baakalai a fait.
 *
 * ── Ce que l'ecran racontait ────────────────────────────────────────────────
 *
 * L'onglet « Historique » de Clients a upseller affichait 23 lignes
 * « Perdu le... » sur staging, pour ZERO email envoye sur cette chaine. Un deal
 * perdu est un fait du CRM, pas une action de baakalai : l'ecran laissait donc
 * croire qu'on avait travaille ces clients et qu'on les avait perdus, c'est-a
 * dire exactement l'inverse de ce qui s'etait passe. Et rien n'etait cliquable.
 *
 * ── Ce que ces tests tiennent ───────────────────────────────────────────────
 *
 *   · un envoi porte son OBJET · « email envoye le 12/08 » ne dit pas ce qu'on
 *     a envoye, et c'est la premiere chose qu'on cherche ;
 *   · une cloture porte le NOMBRE de relances reellement parties · « perdu
 *     apres 2 relances » et « perdu sans qu'on lui ecrive » sont deux
 *     informations opposees, et c'est la seconde qui est actionnable ;
 *   · chaque evenement porte sa SOCIETE, sans quoi la ligne ne peut mener
 *     nulle part.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const JOUR = 86400000;
const ilYA = (n) => new Date(Date.now() - n * JOUR).toISOString();

async function societe(db, userId, nom) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`,
    [userId, nom, nom.toLowerCase()]
  );
  return r.rows[0].id;
}

async function client(db, userId, { nom, accountId = null, statut = 'won', perduLe = null, gagneLe = null }) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, status, won_date, lost_date, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, accountId, nom, `${nom.toLowerCase().replace(/\s/g, '')}@x.fr`, statut, gagneLe, perduLe, ilYA(30)]
  );
  return r.rows[0].id;
}

async function emailParti(db, userId, opportunityId, { objet, chaine = 'auto_upsell', joursAvant = 5 }) {
  await db.query(
    `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, sent_at, metadata)
     VALUES ($1, $2, 'x@x.fr', 'Contact', $3, 'Corps', 'sent', $4, $5)`,
    [userId, opportunityId, objet, ilYA(joursAvant), JSON.stringify({ chain: chaine })]
  );
}

test('un envoi porte son objet et sa societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  const c = await client(db, user.id, { nom: 'Claire Benali', accountId: acme, gagneLe: ilYA(200) });
  await emailParti(db, user.id, c, { objet: 'Un point sur votre contrat ?' });

  const h = await getHistory(user.id, 'auto_upsell');
  const envoi = h.find(e => e.eventType === 'sent');
  assert.ok(envoi, 'l envoi doit figurer dans l historique');
  assert.strictEqual(envoi.subject, 'Un point sur votre contrat ?');
  assert.strictEqual(envoi.accountId, acme, 'et sa societe, pour que la ligne mene quelque part');
});

test('un client perdu SANS relance le dit', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const acme = await societe(db, user.id, 'Acme');
  await client(db, user.id, { nom: 'Camille Herve', accountId: acme, statut: 'lost', perduLe: ilYA(20) });

  const h = await getHistory(user.id, 'auto_upsell');
  const perdu = h.find(e => e.eventType === 'closed');
  assert.ok(perdu);
  // LE point du correctif. Zero et non `null` : on a su compter, et le compte
  // est zero. C'est ce qui distingue « perdu en silence » de « on ne sait pas ».
  assert.strictEqual(perdu.touchCount, 0);
  assert.strictEqual(perdu.accountId, acme);
});

test('un client perdu APRES des relances les compte', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const c = await client(db, user.id, { nom: 'Pierre Marchand', statut: 'lost', perduLe: ilYA(10) });
  await emailParti(db, user.id, c, { objet: 'Relance 1', joursAvant: 40 });
  await emailParti(db, user.id, c, { objet: 'Relance 2', joursAvant: 20 });

  const h = await getHistory(user.id, 'auto_upsell');
  const perdu = h.find(e => e.eventType === 'closed' && e.opportunityId === c);
  assert.strictEqual(perdu.touchCount, 2, 'deux relances parties avant la perte');
});

test('les relances d une AUTRE chaine ne comptent pas', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const c = await client(db, user.id, { nom: 'Julie Prevost', statut: 'lost', perduLe: ilYA(10) });
  // Une relance de REACTIVATION de deal n'est pas une tentative d'upsell :
  // la compter ici ferait croire qu'on a travaille l'upsell alors que non.
  await emailParti(db, user.id, c, { objet: 'Autre chaine', chaine: 'deal_reactivation' });

  const h = await getHistory(user.id, 'auto_upsell');
  const perdu = h.find(e => e.eventType === 'closed' && e.opportunityId === c);
  assert.strictEqual(perdu.touchCount, 0);
});

test('un evenement sans societe rattachee rend accountId null', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  // Sans societe, la ligne ne doit mener nulle part plutot que vers une page
  // qui dirait « introuvable ».
  await client(db, user.id, { nom: 'Isole', statut: 'lost', perduLe: ilYA(5) });

  const h = await getHistory(user.id, 'auto_upsell');
  const perdu = h.find(e => e.eventType === 'closed');
  assert.strictEqual(perdu.accountId, null);
});

test('l historique est trie du plus recent au plus ancien', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getHistory } = require('../lib/reactivation-queue');
  const { user } = await registerAndLogin();

  const vieux = await client(db, user.id, { nom: 'Vieux', statut: 'lost', perduLe: ilYA(100) });
  const recent = await client(db, user.id, { nom: 'Recent', statut: 'lost', perduLe: ilYA(2) });

  const h = await getHistory(user.id, 'auto_upsell');
  const indexRecent = h.findIndex(e => e.opportunityId === recent);
  const indexVieux = h.findIndex(e => e.opportunityId === vieux);
  assert.ok(indexRecent < indexVieux, 'le plus recent en premier');
});
