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
