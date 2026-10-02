/**
 * La liste des comptes, paginée et filtrée côté serveur.
 *
 * Cinq propriétés portent ce chantier, et ce sont elles que ces tests gardent.
 *
 * 1. LA RECHERCHE TROUVE VRAIMENT. C'est la raison d'être du changement : la
 *    page ne connaissait que les 500 contacts les plus silencieux et cherchait
 *    là-dedans, donc un client actif récemment était introuvable. Le test met
 *    délibérément la cible hors de la première page.
 *
 * 2. ON FILTRE LES CONTACTS, PUIS ON REGROUPE. Chercher « cheva » doit rendre
 *    le compte de Sandrine Chevalier avec Sandrine dedans, pas le compte
 *    entier ni tous les comptes du CRM.
 *
 * 3. LA CLÉ DE REGROUPEMENT EST CELLE DE L'ÉCRAN. account_id, sinon le nom de
 *    société, sinon le contact lui-même. Mesuré sur staging : 26 contacts sur
 *    565 portent un account_id, donc paginer sur la table `accounts` cacherait
 *    539 personnes.
 *
 * 4. LES COMPTEURS DE TUILES COMPTENT TOUT, pas la page. Un compteur qui ne
 *    compte que ce qui est affiché annonce un nombre qui n'existe nulle part.
 *
 * 5. CLIQUER UNE TUILE NE MET PAS LES AUTRES À ZÉRO. Sinon on ne peut plus
 *    passer de l'une à l'autre, et l'utilisateur est piégé dans son filtre.
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown, registerAndLogin } = require('./helpers');

const JOURS = 86400000;
const ilYA = (n) => new Date(Date.now() - n * JOURS).toISOString();

/** Un contact, avec juste ce qu'il faut pour être rangé quelque part. */
async function contact(db, userId, o) {
  return db.opportunities.create({
    userId,
    name: o.name,
    email: o.email || null,
    company: o.company || null,
    status: o.status || 'imported',
    dealValue: o.dealValue ?? null,
    lastActivityAt: o.lastActivityAt || null,
    wonDate: o.wonDate || null,
    crmProvider: o.crmProvider || 'pipedrive',
    crmContactId: o.crmContactId || null,
  });
}

test('la recherche trouve un contact meme hors de la premiere page', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // Trente comptes muets depuis longtemps : ils occupent tout le haut du tri
  // par silence, donc toute la premiere page.
  for (let i = 0; i < 30; i++) {
    await contact(db, user.id, {
      name: `Muet ${i}`, email: `muet${i}@vieux.io`, company: `Vieille Boite ${i}`,
      lastActivityAt: ilYA(300 + i), crmContactId: `m${i}`,
    });
  }
  // Et la cible, active hier : la derniere que le tri par silence montrerait.
  await contact(db, user.id, {
    name: 'Sandrine Chevalier', email: 'sandrine@acme.io', company: 'Acme',
    lastActivityAt: ilYA(1), crmContactId: 'cible',
  });

  const p1 = await listAccountPage(user.id, { scope: 'deals', pageSize: 10 });
  assert.strictEqual(p1.total, 31, 'trente et un groupes au total');
  assert.strictEqual(p1.groups.length, 10, 'dix par page');
  assert.ok(
    !p1.groups.some(g => g.name === 'Acme'),
    'la cible est bien hors de la premiere page, sinon le test ne prouve rien'
  );

  const trouve = await listAccountPage(user.id, { scope: 'deals', search: 'cheva' });
  assert.strictEqual(trouve.total, 1, 'la recherche va la chercher partout');
  assert.strictEqual(trouve.groups[0].name, 'Acme');
  assert.strictEqual(trouve.groups[0].contacts.length, 1);
  assert.strictEqual(trouve.groups[0].contacts[0].name, 'Sandrine Chevalier');
});

test('on filtre les contacts puis on regroupe, jamais l inverse', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await contact(db, user.id, { name: 'Sandrine Chevalier', email: 's@acme.io', company: 'Acme', crmContactId: 'a1' });
  await contact(db, user.id, { name: 'Paul Roy', email: 'p@acme.io', company: 'Acme', crmContactId: 'a2' });
  await contact(db, user.id, { name: 'Luc Martin', email: 'l@globex.io', company: 'Globex', crmContactId: 'g1' });

  const res = await listAccountPage(user.id, { scope: 'deals', search: 'cheva' });
  assert.strictEqual(res.total, 1, 'un seul compte remonte');
  assert.strictEqual(
    res.groups[0].contacts.length, 1,
    'et il ne contient que la personne cherchee, pas tout son compte'
  );

  // Sans recherche, le meme compte porte bien ses deux interlocuteurs.
  const complet = await listAccountPage(user.id, { scope: 'deals' });
  const acme = complet.groups.find(g => g.name === 'Acme');
  assert.strictEqual(acme.contacts.length, 2);
});

test('un contact sans societe reste sa propre ligne, sous son nom', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await contact(db, user.id, { name: 'Ava Nguyen', email: 'ava@perso.io', company: null, crmContactId: 'x1' });
  await contact(db, user.id, { name: 'Bob Sans Boite', email: 'bob@perso.io', company: '   ', crmContactId: 'x2' });
  await contact(db, user.id, { name: 'Cle Mentine', email: 'c@acme.io', company: 'Acme', crmContactId: 'x3' });

  const res = await listAccountPage(user.id, { scope: 'deals' });
  assert.strictEqual(res.total, 3, 'deux personnes seules et un compte, pas un seul groupe fourre-tout');

  const seuls = res.groups.filter(g => g.orphan);
  assert.strictEqual(seuls.length, 2, 'les deux sont marques comme des personnes, pas des entreprises');
  assert.ok(seuls.every(g => g.contacts.length === 1));
  // Une societe faite d'espaces n'est pas une societe · sans le TRIM, tous les
  // contacts a societe vide se retrouveraient dans le meme groupe.
  assert.ok(seuls.some(g => g.name === 'Bob Sans Boite'));
});

test('les tuiles comptent toute la base, pas la page affichee', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // 5 actifs, 4 dormants, 3 au point mort, 2 perdus. Repartis sur autant de
  // societes pour que la pagination par compte soit vraiment exercee.
  const poser = async (n, jours, prefixe, status) => {
    for (let i = 0; i < n; i++) {
      await contact(db, user.id, {
        name: `${prefixe} ${i}`, email: `${prefixe}${i}@x.io`, company: `${prefixe} SA ${i}`,
        lastActivityAt: ilYA(jours), status, crmContactId: `${prefixe}${i}`,
      });
    }
  };
  await poser(5, 3, 'actif', 'negotiation');
  await poser(4, 45, 'dormant', 'negotiation');
  await poser(3, 120, 'mort', 'negotiation');
  await poser(2, 10, 'perdu', 'lost');

  const page = await listAccountPage(user.id, { scope: 'deals', pageSize: 3 });
  assert.strictEqual(page.groups.length, 3, 'la page est bien courte');
  assert.strictEqual(page.total, 14);

  const compteur = (k) => page.tiles.find(x => x.key === k).count;
  assert.strictEqual(compteur('deal_active'), 5, 'compte les 5, pas les 3 affiches');
  assert.strictEqual(compteur('deal_dormant'), 4);
  assert.strictEqual(compteur('deal_stalled'), 3);
  assert.strictEqual(compteur('deal_lost'), 2);
});

test('cliquer une tuile ne met pas les autres a zero', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await contact(db, user.id, { name: 'Actif', email: 'a@x.io', company: 'A SA', lastActivityAt: ilYA(3), status: 'negotiation', crmContactId: 'a' });
  await contact(db, user.id, { name: 'Mort', email: 'm@x.io', company: 'M SA', lastActivityAt: ilYA(200), status: 'negotiation', crmContactId: 'm' });

  const filtre = await listAccountPage(user.id, { scope: 'deals', tile: 'deal_stalled' });
  assert.strictEqual(filtre.total, 1, 'la liste est bien filtree sur la tuile');
  assert.strictEqual(filtre.groups[0].name, 'M SA');

  // Les compteurs, eux, ignorent la tuile active : sinon on ne pourrait plus
  // revenir vers « actifs », son chiffre etant tombe a zero.
  const c = (k) => filtre.tiles.find(x => x.key === k).count;
  assert.strictEqual(c('deal_stalled'), 1);
  assert.strictEqual(c('deal_active'), 1, 'l autre tuile garde son chiffre, elle reste cliquable');
});

test('les agregats de tete ignorent les filtres actifs, sinon on ne peut plus en sortir', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await contact(db, user.id, { name: 'A', email: 'a@x.io', company: 'A SA', status: 'negotiation', dealValue: 1000, lastActivityAt: ilYA(3), crmProvider: 'pipedrive', crmContactId: 'a' });
  await contact(db, user.id, { name: 'B', email: 'b@x.io', company: 'B SA', status: 'meeting', dealValue: 2000, lastActivityAt: ilYA(200), crmProvider: 'hubspot', crmContactId: 'b' });
  await contact(db, user.id, { name: 'C', email: 'c@x.io', company: 'C SA', status: 'meeting', lastActivityAt: ilYA(200), crmProvider: 'hubspot', crmContactId: 'c' });

  // Un filtre serre la liste a une seule ligne.
  const res = await listAccountPage(user.id, { scope: 'deals', filter: 'negotiation' });
  assert.strictEqual(res.total, 1, 'la liste suit le filtre');

  // Mais la liste deroulante des statuts doit continuer d'annoncer les autres,
  // sinon l'utilisateur ne peut plus revenir vers « RDV » : son option
  // afficherait zero.
  assert.strictEqual(res.stats.byStatus.negotiation, 1);
  assert.strictEqual(res.stats.byStatus.meeting, 2, 'l autre statut garde son chiffre');
  assert.strictEqual(res.stats.byProvider.hubspot, 2);
  assert.strictEqual(res.stats.byProvider.pipedrive, 1);

  // Et le resume du pipeline porte sur tout le cadrage.
  assert.strictEqual(res.stats.totalScope, 3, 'l onglet « Tous » compte tout le cadrage, pas la page');
  assert.strictEqual(res.stats.valued, 2, 'deux deals valorises sur trois');
  assert.strictEqual(res.stats.value, 3000);
  assert.strictEqual(res.stats.dormant, 2, 'deux muets depuis plus de trente jours');
});

test('les clients a risque se comptent au seuil du produit, pas a un seuil local', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage, AT_RISK_THRESHOLD } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  assert.strictEqual(AT_RISK_THRESHOLD, 60, 'meme seuil que lib/churn-scoring.js et que le badge de la nav');

  const poser = async (nom, score) => {
    const c = await contact(db, user.id, {
      name: nom, email: `${nom}@x.io`, company: `${nom} SA`, status: 'won',
      wonDate: ilYA(30), lastActivityAt: ilYA(30), crmContactId: nom,
    });
    await db.opportunities.update(c.id, { churnScore: score });
  };
  // 55 est au-dessus de l'ancien seuil local de 50 et en dessous du vrai : il
  // ne doit PAS etre compte, sinon cet onglet annonce un autre nombre que le
  // reste du produit pour exactement la meme question.
  await poser('Limite', 55);
  await poser('Vraiment', 80);

  const res = await listAccountPage(user.id, { scope: 'clients' });
  assert.strictEqual(res.stats.atRisk, 1, 'un seul client au-dessus de 60');
  assert.strictEqual(res.stats.totalScope, 2);
});

test('le cadrage separe les deals des clients', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await contact(db, user.id, { name: 'En cours', email: 'e@x.io', company: 'Encours SA', status: 'negotiation', crmContactId: 'e' });
  await contact(db, user.id, { name: 'Signe', email: 's@x.io', company: 'Signe SA', status: 'won', wonDate: ilYA(10), lastActivityAt: ilYA(10), crmContactId: 's' });

  const deals = await listAccountPage(user.id, { scope: 'deals' });
  assert.strictEqual(deals.total, 1);
  assert.strictEqual(deals.groups[0].name, 'Encours SA');

  const clients = await listAccountPage(user.id, { scope: 'clients' });
  assert.strictEqual(clients.total, 1);
  assert.strictEqual(clients.groups[0].name, 'Signe SA');
  // Et les tuiles changent de jeu avec le cadrage.
  assert.ok(clients.tiles.some(x => x.key === 'seg_new'));
  assert.strictEqual(clients.tiles.find(x => x.key === 'seg_new').count, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// Le MONTANT vient des affaires, plus de la ligne du contact (lot 7)
//
// Mesure du 2026-10-01 sur staging, au meme instant : `opportunities` voyait 32
// affaires ouvertes pour 936 700 EUR, `deals` 47 pour 1 396 400 EUR. Une ligne
// de contact ne porte qu'UN montant : deux affaires sur la meme personne n'y
// tiennent pas, la plus recemment modifiee reclame la ligne et les autres sont
// jetees.
// ═══════════════════════════════════════════════════════════════════════════

test('deux affaires sur un meme compte sont toutes deux dans le montant', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  const compte = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, 'Dunelia', 'dunelia', 'crm') RETURNING id`, [user.id]
  );
  const compteId = compte.rows[0].id;

  // La ligne du contact ne porte que 10 000 : c'est la limite structurelle.
  const c = await contact(db, user.id, { name: 'Paul', company: 'Dunelia', dealValue: 10000, lastActivityAt: ilYA(5) });
  await db.query('UPDATE opportunities SET account_id = $1 WHERE id = $2', [compteId, c.id]);

  await db.query(
    `INSERT INTO deals (user_id, account_id, primary_contact_id, status, deal_value)
     VALUES ($1, $2, $3, 'open', 10000), ($1, $2, $3, 'open', 25000)`,
    [user.id, compteId, c.id]
  );

  const page = await listAccountPage(user.id, {});
  const g = page.groups.find(x => x.name === 'Dunelia');
  assert.ok(g, 'le groupe existe');
  assert.strictEqual(g.value, 35000,
    'le montant est la somme des affaires, pas celui de la ligne du contact');
  // La ligne de resume doit dire la MEME chose, sinon l'ecran se contredit.
  assert.strictEqual(page.stats.value, 35000);
});

test('un groupe sans societe garde le montant de son contact', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // Un compte existe ailleurs, donc `deals` est peuplee pour ce tenant : le
  // chemin « affaires » est bien actif. Mais ce contact-ci n'est rattache a
  // aucune societe, il n'a donc aucune affaire a quoi se raccrocher.
  const compte = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, 'Autre', 'autre', 'crm') RETURNING id`, [user.id]
  );
  await db.query(
    `INSERT INTO deals (user_id, account_id, status, deal_value) VALUES ($1, $2, 'open', 999)`,
    [user.id, compte.rows[0].id]
  );

  await contact(db, user.id, { name: 'Solo', company: 'Maison Solo', dealValue: 7000, lastActivityAt: ilYA(3) });

  const page = await listAccountPage(user.id, {});
  const g = page.groups.find(x => x.name === 'Maison Solo');
  assert.strictEqual(g.value, 7000,
    'sans societe rattachee, le repli sur la ligne du contact est la seule reponse possible');
});

test('le montant des affaires ne compte pas les comptes hors perimetre', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  const faire = async (nom) => (await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source)
     VALUES ($1, $2, $3, 'crm') RETURNING id`, [user.id, nom, nom.toLowerCase()]
  )).rows[0].id;

  const client = await faire('Client Gagne');
  const prospect = await faire('Prospect Ouvert');

  const cc = await contact(db, user.id, { name: 'Clio', company: 'Client Gagne', status: 'won', wonDate: ilYA(30), lastActivityAt: ilYA(4) });
  await db.query('UPDATE opportunities SET account_id = $1 WHERE id = $2', [client, cc.id]);
  const cp = await contact(db, user.id, { name: 'Prosper', company: 'Prospect Ouvert', status: 'interested', lastActivityAt: ilYA(4) });
  await db.query('UPDATE opportunities SET account_id = $1 WHERE id = $2', [prospect, cp.id]);

  await db.query(
    `INSERT INTO deals (user_id, account_id, status, deal_value)
     VALUES ($1, $2, 'won', 50000), ($1, $3, 'open', 8000)`,
    [user.id, client, prospect]
  );

  // Cadrage Clients : seul le compte gagne entre, donc seul son montant compte.
  const cote = await listAccountPage(user.id, { scope: 'clients' });
  assert.strictEqual(cote.stats.value, 50000);
  // Cadrage Deals : l'inverse.
  const autre = await listAccountPage(user.id, { scope: 'deals' });
  assert.strictEqual(autre.stats.value, 8000);
});

/* ═══════ Les colonnes de la societe · lot 7, ecran 1 ═══════
 *
 * L'ecran affichait UN montant agrege par societe. Or voir l'OUVERT et le
 * GAGNE ensemble EST la definition de l'upsell : une societe qui a deja signe
 * et qui a encore une affaire en cours est la cible du deuxieme job du produit.
 * Un total unique ne le dit pas.
 *
 * Et « non scorable » n'est pas « sain ». Un compte sans score ne vaut pas
 * zero : un compte muet n'est pas un compte en bonne sante, et les confondre
 * ferait passer un angle mort pour un bon resultat.
 */

async function societeAvecAffaires(db, userId, nom, affaires, { churnScore = null, owner = null } = {}) {
  const a = await db.query(
    `INSERT INTO accounts (user_id, name, name_normalized, source, churn_score, owner_email)
     VALUES ($1, $2, $3, 'crm', $4, $5) RETURNING id`,
    [userId, nom, nom.toLowerCase(), churnScore, owner]
  );
  const accountId = a.rows[0].id;
  // Statut `won` et date de gain : le cadrage « clients » ne retient que les
  // societes qui ont au moins un gagne (`o.status = 'won'`), et c'est bien de
  // clients qu'on parle ici.
  const c = await contact(db, userId, {
    name: `Contact ${nom}`, company: nom, email: `c@${nom.toLowerCase()}.fr`,
    status: 'won', wonDate: ilYA(20), lastActivityAt: ilYA(10),
  });
  await db.query('UPDATE opportunities SET account_id = $1 WHERE id = $2', [accountId, c.id]);
  for (const [statut, montant] of affaires) {
    await db.query(
      `INSERT INTO deals (user_id, account_id, name, status, deal_value, crm_provider)
       VALUES ($1, $2, $3, $4, $5, 'pipedrive')`,
      [userId, accountId, `${nom} ${statut}`, statut, montant]
    );
  }
  return accountId;
}

test('l ouvert et le gagne sont separes, pas additionnes', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // Le cas exact de Verdoux Benali sur staging : un gagne ET un ouvert.
  await societeAvecAffaires(db, user.id, 'Verdoux', [['won', 35900], ['open', 24200]]);

  const page = await listAccountPage(user.id, { scope: 'clients', pageSize: 10 });
  const g = page.groups.find(x => x.name === 'Verdoux');
  assert.ok(g, 'la societe doit etre listee');
  assert.strictEqual(g.openValue, 24200, 'l ouvert seul');
  assert.strictEqual(g.wonValue, 35900, 'le gagne seul');
  // Et le total reste disponible : le tri par valeur s'appuie dessus.
  assert.strictEqual(g.value, 60100);
});

test('une affaire PERDUE ne compte ni dans l ouvert ni dans le gagne', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // Une affaire perdue est sortie du pipeline. La compter dans l'ouvert
  // gonflerait un pipeline qui n'existe plus, et c'est precisement le genre de
  // chiffre faux qui fait perdre confiance a tout l'ecran.
  await societeAvecAffaires(db, user.id, 'Perdante', [['lost', 99000], ['open', 1000]]);

  const page = await listAccountPage(user.id, { scope: 'clients', pageSize: 10 });
  const g = page.groups.find(x => x.name === 'Perdante');
  assert.strictEqual(g.openValue, 1000);
  assert.strictEqual(g.wonValue, 0);
});

test('le risque et le proprietaire viennent de la SOCIETE', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  await societeAvecAffaires(db, user.id, 'Risquee', [['open', 5000]], {
    churnScore: 82, owner: 'goran@baakal.ai',
  });

  const page = await listAccountPage(user.id, { scope: 'clients', pageSize: 10 });
  const g = page.groups.find(x => x.name === 'Risquee');
  assert.strictEqual(g.churnScore, 82);
  assert.strictEqual(g.owner, 'goran@baakal.ai');
});

test('un compte NON SCORE rend null, jamais zero', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // LE test qui compte. Replier sur zero ferait afficher « Sain 0 » sur un
  // compte dont on ne sait rien, donc presenter un angle mort comme un bon
  // resultat. L'ecran doit pouvoir dire « Non scorable », et il ne peut le
  // faire que si le serveur distingue l'absence de score de la valeur zero.
  await societeAvecAffaires(db, user.id, 'Inconnue', [['open', 7000]], { churnScore: null });

  const page = await listAccountPage(user.id, { scope: 'clients', pageSize: 10 });
  const g = page.groups.find(x => x.name === 'Inconnue');
  assert.strictEqual(g.churnScore, null, 'null et non 0');
  assert.notStrictEqual(g.churnScore, 0);
});

test('un groupe sans societe n a ni risque ni proprietaire de societe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { listAccountPage } = require('../lib/account-list');
  const { user } = await registerAndLogin();

  // Un groupe forme sur un nom d'entreprise en texte libre : pas de fiche,
  // donc rien a lire sur la societe. Le montant retombe sur la ligne du
  // contact, ce qui reste faux des qu'une personne porte deux affaires · c'est
  // la limite connue d'`opportunities`, pas une nouvelle.
  await contact(db, user.id, {
    name: 'Paul Libre', company: 'Sans Fiche', email: 'p@sansfiche.fr',
    status: 'negotiation', dealValue: 3000, lastActivityAt: ilYA(5),
  });

  // Cadrage « deals » : ce groupe n'a aucun gagne, donc il n'existe pas sous
  // « clients ». C'est le filtre du cadrage, pas un effet de ce lot.
  const page = await listAccountPage(user.id, { scope: 'deals', pageSize: 10 });
  const g = page.groups.find(x => x.name === 'Sans Fiche');
  assert.ok(g);
  assert.strictEqual(g.accountId, null);
  assert.strictEqual(g.churnScore, null);
  assert.strictEqual(g.openValue, 3000, 'repli sur la ligne du contact');
});
