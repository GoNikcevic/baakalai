/**
 * La FICHE d'une societe · lot 7.
 *
 * L'ecran qui manquait. Ce qui est verrouille ici n'est pas la mise en page mais
 * les quatre affirmations que la fiche porte, et dont chacune etait fausse ou
 * impossible avant le chantier comptes :
 *
 *   · un gagne et un ouvert coexistent, donc l'upsell se VOIT
 *   · « aucun contact rattache » et « aucun contact joignable » sont distingues
 *   · deux devises ne s'additionnent jamais
 *   · un compte d'un autre utilisateur n'existe pas
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

const DAY = 86400000;
const ago = d => new Date(Date.now() - d * DAY).toISOString();

async function creerCompte(db, userId, nom, over = {}) {
  const r = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source, industry, domain, owner_email, crm_created_at)
     VALUES ($1, $2, $3, 'crm', $4, $5, $6, $7) RETURNING id`,
    [userId, nom, nom.toLowerCase(), over.industry || null, over.domain || null,
     over.ownerEmail || null, over.crmCreatedAt || ago(420)]
  );
  return r.rows[0].id;
}

async function creerContact(db, userId, accountId, over = {}) {
  const r = await db.query(
    `INSERT INTO opportunities (user_id, account_id, name, email, title, status,
                                account_role, is_primary_contact, last_activity_at, email_bounced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [userId, accountId, over.name || 'Contact', over.email ?? `c${Math.random()}@client.fr`,
     over.title || null, over.status || 'won', over.role || null,
     over.primary || false, over.lastActivityAt || ago(5), over.bouncedAt || null]
  );
  return r.rows[0].id;
}

async function creerAffaire(db, userId, accountId, over = {}) {
  await db.query(
    `INSERT INTO deals (user_id, account_id, name, status, deal_value, currency, crm_stage, won_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, accountId, over.name || 'Affaire', over.status || 'open',
     over.value ?? null, over.currency || null, over.stage || null, over.wonDate || null]
  );
}

test('un gagne et un ouvert sur la meme societe : l upsell se voit', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Verdoux Benali');
  await creerContact(db, user.id, id, { primary: true, role: 'decision_maker' });
  await creerAffaire(db, user.id, id, { name: 'Renouvellement', status: 'won', value: 35900, wonDate: ago(80) });
  await creerAffaire(db, user.id, id, { name: 'Extension', status: 'open', value: 24200 });

  const f = await getAccountSheet(user.id, id);

  // Deux affaires sur la meme societe : impossible a representer avant le lot 4,
  // la ligne du contact ne portait qu'un montant et qu'un statut.
  assert.strictEqual(f.affaires.length, 2);
  assert.strictEqual(f.resume.upsell, true, 'un gagne plus un ouvert EST un upsell');
  assert.strictEqual(f.resume.ouvert, 24200);
  assert.strictEqual(f.resume.gagne, 35900);
  // L'ouvert passe avant : c'est ce sur quoi on peut encore agir.
  assert.strictEqual(f.affaires[0].name, 'Extension');
});

test('un client sans affaire ouverte n est pas un upsell', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Client Calme');
  await creerContact(db, user.id, id);
  await creerAffaire(db, user.id, id, { status: 'won', value: 9000, wonDate: ago(200) });

  const f = await getAccountSheet(user.id, id);
  assert.strictEqual(f.resume.upsell, false);
  assert.strictEqual(f.resume.ouvert, 0);
});

test('aucun contact rattache et aucun contact joignable sont deux choses', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  // Trou de notre import : la societe existe, personne n'y est rattache.
  const vide = await creerCompte(db, user.id, 'Maison Syndex');
  await creerAffaire(db, user.id, vide, { status: 'open', value: 65900 });

  // Equipe partie : des contacts existent, leurs adresses sont mortes.
  const mort = await creerCompte(db, user.id, 'Ancienne Maison');
  await creerContact(db, user.id, mort, { bouncedAt: ago(30) });

  const fVide = await getAccountSheet(user.id, vide);
  const fMort = await getAccountSheet(user.id, mort);

  assert.strictEqual(fVide.resume.sansInterlocuteur, true);
  assert.strictEqual(fVide.resume.injoignable, null,
    'sans contact, « injoignable » n est pas faux, il est inconnu');

  assert.strictEqual(fMort.resume.sansInterlocuteur, false);
  assert.strictEqual(fMort.resume.injoignable, true,
    'des contacts dont les adresses ont rebondi, c est une societe injoignable');
  assert.strictEqual(fMort.resume.joignables, 0);
});

test('deux devises ne s additionnent pas, elles se signalent', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'International SA');
  await creerContact(db, user.id, id);
  await creerAffaire(db, user.id, id, { status: 'open', value: 10000, currency: 'EUR' });
  await creerAffaire(db, user.id, id, { status: 'open', value: 10000, currency: 'USD' });

  const f = await getAccountSheet(user.id, id);
  assert.strictEqual(f.resume.devisesMelangees, true,
    'l ecran doit pouvoir dire que le total melange deux devises');
  assert.deepStrictEqual([...f.resume.devises].sort(), ['EUR', 'USD']);
});

test('les champs manquants sont ceux de la SOCIETE, corriges une seule fois', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const incomplet = await creerCompte(db, user.id, 'Sans Secteur');
  await creerContact(db, user.id, incomplet);
  await creerContact(db, user.id, incomplet);

  const complet = await creerCompte(db, user.id, 'Bien Rempli', {
    industry: 'Industrie', domain: 'bienrempli.fr', ownerEmail: 'goran@baakal.ai',
  });
  await creerContact(db, user.id, complet);

  const f1 = await getAccountSheet(user.id, incomplet);
  const f2 = await getAccountSheet(user.id, complet);

  // Deux interlocuteurs, UNE correction : c'est tout l'interet du niveau societe.
  assert.ok(f1.resume.champsManquants.includes('industry'));
  assert.ok(f1.resume.champsManquants.includes('domain'));
  assert.strictEqual(f1.resume.contacts, 2);
  assert.deepStrictEqual(f2.resume.champsManquants, []);
});

test('l interlocuteur principal remonte en premier', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Trois Personnes');
  await creerContact(db, user.id, id, { name: 'Operationnel', lastActivityAt: ago(2) });
  await creerContact(db, user.id, id, { name: 'Decideur', primary: true, lastActivityAt: ago(60) });
  await creerContact(db, user.id, id, { name: 'Autre', lastActivityAt: ago(10) });

  const f = await getAccountSheet(user.id, id);
  // Le principal passe devant MEME s il est moins recemment actif : c'est lui
  // que l'ecran met en avant et que les jobs visent par defaut.
  assert.strictEqual(f.contacts[0].name, 'Decideur');
  assert.strictEqual(f.contacts[0].is_primary_contact, true);
});

test('le compte d un autre utilisateur n existe pas', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { getAccountSheet } = require('../lib/accounts');
  const moi = await registerAndLogin({ email: `moi-${Date.now()}@bakal.test` });
  const autre = await registerAndLogin({ email: `autre-${Date.now()}@bakal.test` });

  const sien = await creerCompte(db, autre.user.id, 'Pas Le Mien');

  assert.strictEqual(await getAccountSheet(moi.user.id, sien), null,
    'le cloisonnement se verifie dans la requete, pas a l ecran');

  // Et la route doit repondre 404, le MEME code qu un identifiant inexistant :
  // distinguer les deux dirait a un tiers que l identifiant existe.
  const r = await request('GET', `/api/crm/accounts/${sien}`, { token: moi.token });
  assert.strictEqual(r.status, 404);
});

test('la route rend la fiche complete a son proprietaire', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();
  const id = await creerCompte(db, user.id, 'Atelier Kerveil', { industry: 'Industrie' });
  await creerContact(db, user.id, id, { name: 'Claire', primary: true, title: 'Directrice des achats' });
  await creerAffaire(db, user.id, id, { name: 'Contrat cadre', status: 'open', value: 23400, stage: 'Negociation' });
  await creerAffaire(db, user.id, id, { name: 'Lot initial', status: 'won', value: 29600, wonDate: ago(150) });

  const r = await request('GET', `/api/crm/accounts/${id}`, { token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.compte.name, 'Atelier Kerveil');
  assert.strictEqual(r.body.resume.upsell, true);
  assert.strictEqual(r.body.affaires.length, 2);
  assert.strictEqual(r.body.contacts[0].name, 'Claire');
  // L'etape est un libelle, pas un identifiant.
  assert.strictEqual(r.body.affaires[0].crm_stage, 'Negociation');
});

// ═══════════════════════════════════════════════════════════════════════════
// Les SOCIETES a risque · une ligne par societe, plus une par personne
// ═══════════════════════════════════════════════════════════════════════════

test('une societe a trois interlocuteurs ne fait QU UNE ligne a risque', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAtRiskAccounts } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Dunelia Systemes');
  await db.query('UPDATE accounts SET churn_score = 82, churn_factors = $2 WHERE id = $1',
    [id, JSON.stringify([{ signal: 'inactivity', weight: 30, detail: '128d sans activite' }])]);

  await creerContact(db, user.id, id, { name: 'Operationnel', lastActivityAt: ago(3) });
  await creerContact(db, user.id, id, { name: 'Decideur', primary: true, lastActivityAt: ago(60) });
  await creerContact(db, user.id, id, { name: 'Autre', lastActivityAt: ago(10) });

  const lignes = await listAtRiskAccounts(user.id);
  assert.strictEqual(lignes.length, 1, 'trois interlocuteurs, une seule ligne');
  assert.strictEqual(lignes[0].company, 'Dunelia Systemes');
  assert.strictEqual(lignes[0].contactsCount, 3);
  // Le sujet des actions est le principal, parce qu'on ecrit a une personne.
  assert.strictEqual(lignes[0].name, 'Decideur');
  assert.strictEqual(lignes[0].churn_score, 82);
  assert.strictEqual(lignes[0].churn_factors.length, 1);
});

test('un compte sous le seuil n est pas a risque', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAtRiskAccounts } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const sain = await creerCompte(db, user.id, 'Sain');
  await db.query('UPDATE accounts SET churn_score = 40 WHERE id = $1', [sain]);
  await creerContact(db, user.id, sain);

  const jamais = await creerCompte(db, user.id, 'Jamais Score');
  await creerContact(db, user.id, jamais);

  assert.deepStrictEqual(await listAtRiskAccounts(user.id), [],
    'un score sous le seuil et un score NULL sortent tous les deux');
});

test('une adresse qui a rebondi ne devient pas la cible de l envoi', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAtRiskAccounts } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Adresses Mortes');
  await db.query('UPDATE accounts SET churn_score = 70 WHERE id = $1', [id]);
  // Le principal a rebondi, un autre est encore joignable : c'est lui la cible.
  await creerContact(db, user.id, id, { name: 'Principal Parti', primary: true, bouncedAt: ago(20) });
  await creerContact(db, user.id, id, { name: 'Encore La', lastActivityAt: ago(30) });

  const [l] = await listAtRiskAccounts(user.id);
  assert.strictEqual(l.name, 'Encore La', 'on n ecrit pas a une adresse morte');
  assert.strictEqual(l.injoignable, false);
});

test('un compte a risque sans aucun interlocuteur est rendu quand meme', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAtRiskAccounts } = require('../lib/accounts');
  const { user } = await registerAndLogin();

  const id = await creerCompte(db, user.id, 'Fantome');
  await db.query('UPDATE accounts SET churn_score = 90 WHERE id = $1', [id]);

  const [l] = await listAtRiskAccounts(user.id);
  // Le masquer ferait disparaitre un client qui part. L'ecran doit pouvoir dire
  // pourquoi rien ne peut partir.
  assert.ok(l, 'la ligne existe');
  assert.strictEqual(l.id, null, 'aucun sujet d action, et ce null est la reponse juste');
  assert.strictEqual(l.sansInterlocuteur, true);
  assert.strictEqual(l.company, 'Fantome');
});

test('la route at-risk n est pas avalee par /accounts/:id', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { user, token } = await registerAndLogin();
  const id = await creerCompte(db, user.id, 'ARisque');
  await db.query('UPDATE accounts SET churn_score = 75 WHERE id = $1', [id]);
  await creerContact(db, user.id, id, { name: 'Claire', primary: true });

  // Sans l'ordre de declaration, Express prendrait « at-risk » pour un
  // identifiant de compte et repondrait 404 sur une route qui existe.
  const r = await request('GET', '/api/crm/accounts/at-risk', { token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.accounts.length, 1);
  assert.strictEqual(r.body.accounts[0].company, 'ARisque');
});
