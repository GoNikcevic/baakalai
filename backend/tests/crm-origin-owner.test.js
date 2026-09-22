/**
 * Tests d'extraction de la date de création CRM et du propriétaire.
 *
 * Chaque enregistrement reproduit ce que le connecteur renvoie RÉELLEMENT, et
 * pas ce que l'API publie. C'est toute la difficulté : `pipedrive.listAllPersons`
 * rend la personne brute, tandis que `hubspot.listAllContacts` aplatit
 * `properties` et que `salesforce.listContacts` renomme `OwnerId` en `ownerId`.
 *
 * C'est exactement là qu'était le bug corrigé le 2026-09-22 : le resolver
 * d'owner ne lisait que la forme brute et renvoyait null sur HubSpot,
 * Salesforce et Odoo, d'où 443 opportunités de production sans propriétaire.
 * Les deux formes sont donc testées pour chaque connecteur concerné.
 */

const test = require('node:test');
const assert = require('node:assert');

const { extractCreatedDate } = require('../lib/crm-origin');
const { extractCrmOwnerId, extractOwnerEmail, resolveOwner } = require('../lib/crm-owner-resolver');
const { monthsSince } = require('../lib/icp-signals');

// ── Date de création, forme brute de chaque API ──

test('pipedrive, add_time sans fuseau est lu en UTC', () => {
  const out = extractCreatedDate('pipedrive', { add_time: '2021-03-04 09:12:00' });
  assert.strictEqual(out, '2021-03-04T09:12:00.000Z');
});

test('hubspot, createdate en epoch millisecondes sous properties', () => {
  const out = extractCreatedDate('hubspot', { properties: { createdate: '1614848000000' } });
  assert.strictEqual(out.slice(0, 7), '2021-03');
});

test('salesforce, CreatedDate est desormais renvoyee par le SOQL', () => {
  const out = extractCreatedDate('salesforce', { CreatedDate: '2019-11-02T10:00:00.000+0000' });
  assert.strictEqual(out, '2019-11-02T10:00:00.000Z');
});

test('odoo, create_date sans fuseau est lu en UTC', () => {
  const out = extractCreatedDate('odoo', { create_date: '2020-06-15 08:00:00' });
  assert.strictEqual(out, '2020-06-15T08:00:00.000Z');
});

test('notion, created_time de la page', () => {
  const out = extractCreatedDate('notion', { created_time: '2022-01-09T12:00:00.000Z' });
  assert.strictEqual(out, '2022-01-09T12:00:00.000Z');
});

test('airtable, createdTime present sur chaque record', () => {
  const out = extractCreatedDate('airtable', { createdTime: '2023-02-01T00:00:00.000Z' });
  assert.strictEqual(out, '2023-02-01T00:00:00.000Z');
});

// ── Date de création, forme déjà normalisée par nos connecteurs ──

test('la forme normalisee des connecteurs est acceptee', () => {
  assert.strictEqual(
    extractCreatedDate('salesforce', { createdAt: '2019-11-02T10:00:00.000+0000' }),
    '2019-11-02T10:00:00.000Z'
  );
  assert.strictEqual(
    extractCreatedDate('hubspot', { createdAt: '1614848000000' }).slice(0, 7),
    '2021-03'
  );
});

test('created_at n est PAS accepte comme date CRM', () => {
  // C'est notre date d'insertion. L'accepter ici rebrancherait exactement la
  // confusion que la colonne crm_created_at existe pour supprimer.
  assert.strictEqual(extractCreatedDate('pipedrive', { created_at: '2026-09-22T10:00:00Z' }), null);
});

test('un connecteur sans date de creation renvoie inconnu, pas une date de repli', () => {
  assert.strictEqual(extractCreatedDate('pipedrive', { update_time: '2026-06-01 12:00:00' }), null);
  assert.strictEqual(extractCreatedDate('folk', {}), null);
  assert.strictEqual(extractCreatedDate('pipedrive', null), null);
});

test('une date de creation dans le futur est rejetee', () => {
  const futur = new Date(Date.now() + 90 * 86400000).toISOString();
  assert.strictEqual(extractCreatedDate('salesforce', { CreatedDate: futur }), null);
});

// ── Propriétaire · les deux formes, pour les quatre connecteurs concernés ──

test('pipedrive, owner_id est un objet imbrique', () => {
  assert.strictEqual(extractCrmOwnerId('pipedrive', { owner_id: { id: 77, email: 'lea@acme.io' } }), '77');
  assert.strictEqual(extractCrmOwnerId('pipedrive', { owner_id: 77 }), '77');
});

test('hubspot, forme brute ET forme aplatie par le connecteur', () => {
  // Forme brute : properties.hubspot_owner_id (branche d'import de routes/crm.js)
  assert.strictEqual(extractCrmOwnerId('hubspot', { properties: { hubspot_owner_id: '4242' } }), '4242');
  // Forme aplatie : owner_id (hubspot.listAllContacts) · c'est celle-ci qui
  // renvoyait null avant le correctif.
  assert.strictEqual(extractCrmOwnerId('hubspot', { owner_id: '4242' }), '4242');
});

test('salesforce, OwnerId brut ET ownerId normalise', () => {
  assert.strictEqual(extractCrmOwnerId('salesforce', { OwnerId: '005AAA' }), '005AAA');
  // salesforce.listContacts renomme en ownerId : c'est cette forme que le
  // resolver ne savait pas lire.
  assert.strictEqual(extractCrmOwnerId('salesforce', { ownerId: '005AAA' }), '005AAA');
});

test('odoo, user_id est un couple [id, libelle]', () => {
  assert.strictEqual(extractCrmOwnerId('odoo', { user_id: [12, 'Paul'] }), '12');
  assert.strictEqual(extractCrmOwnerId('odoo', { user_id: 12 }), '12');
});

test('un contact sans proprietaire renvoie null, jamais la chaine « false »', () => {
  assert.strictEqual(extractCrmOwnerId('pipedrive', { owner_id: null }), null);
  assert.strictEqual(extractCrmOwnerId('hubspot', { properties: {} }), null);
  assert.strictEqual(extractCrmOwnerId('notion', { created_time: '2022-01-09T12:00:00.000Z' }), null);
  // Odoo est en XML-RPC : un many2one vide vaut `false`, pas null. Sans garde,
  // String(false) écrivait « false » en base et l'ICP comptait un siège de plus.
  assert.strictEqual(extractCrmOwnerId('odoo', { user_id: false }), null);
  assert.strictEqual(extractCrmOwnerId('odoo', { user_id: [] }), null);
  assert.strictEqual(extractCrmOwnerId('odoo', { user_id: [false, ''] }), null);
});

test('l email du proprietaire est lu sur le record quand le CRM le porte', () => {
  // Pipedrive embarque l'email dans l'objet owner_id : pas d'aller-retour API.
  assert.strictEqual(extractOwnerEmail('pipedrive', { owner_id: { id: 77, email: 'Lea@Acme.io' } }), 'lea@acme.io');
  // Airtable n'a pas d'identifiant : le connecteur remonte ownerEmail.
  assert.strictEqual(extractOwnerEmail('airtable', { ownerEmail: 'Sam@Acme.io' }), 'sam@acme.io');
  // Un prenom seul ne permet de rapprocher personne.
  assert.strictEqual(extractOwnerEmail('airtable', { ownerEmail: 'Sam' }), null);
});

// ── Résolution complète ──

test('resolveOwner traduit l identifiant en membre d equipe quand la map le connait', () => {
  const map = new Map([['005AAA', { email: 'rep@acme.io', baakalaiUserId: 'uuid-1' }]]);
  assert.deepStrictEqual(resolveOwner('salesforce', { ownerId: '005AAA' }, map), {
    crmOwnerId: '005AAA',
    ownerEmail: 'rep@acme.io',
    ownerId: 'uuid-1',
  });
});

test('resolveOwner garde l identifiant CRM meme sans map', () => {
  // Les connecteurs sans « liste des utilisateurs » passent une map vide. On
  // perd le rapprochement avec un membre d'equipe, pas le comptage de sieges.
  assert.deepStrictEqual(resolveOwner('salesforce', { ownerId: '005AAA' }, new Map()), {
    crmOwnerId: '005AAA',
    ownerEmail: null,
    ownerId: null,
  });
  // Et ne casse pas si l'appelant ne passe rien du tout.
  assert.strictEqual(resolveOwner('salesforce', { ownerId: '005AAA' }, undefined).crmOwnerId, '005AAA');
});

test('resolveOwner remonte un email seul quand il n y a pas d identifiant', () => {
  assert.deepStrictEqual(resolveOwner('airtable', { ownerEmail: 'sam@acme.io' }, new Map()), {
    crmOwnerId: null,
    ownerEmail: 'sam@acme.io',
    ownerId: null,
  });
});

// ── Ancienneté du CRM ──

const ilYA = (mois, jours = 0) => {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth() - mois, now.getUTCDate() - jours
  )).toISOString();
};

test('l anciennete se compte en mois revolus, jamais arrondis', () => {
  assert.strictEqual(monthsSince(ilYA(12)), 12);
  assert.strictEqual(monthsSince(ilYA(36)), 36);
  // 11 mois et 20 jours ne doivent PAS franchir le seuil ICP des 12 mois.
  assert.strictEqual(monthsSince(ilYA(12, -20)), 11);
});

test('aucune ligne datee donne inconnu, pas zero', () => {
  assert.strictEqual(monthsSince(null), null);
  assert.strictEqual(monthsSince(undefined), null);
  assert.strictEqual(monthsSince('pas-une-date'), null);
});

test('une date CRM future ne produit pas une anciennete negative', () => {
  assert.strictEqual(monthsSince(new Date(Date.now() + 90 * 86400000)), 0);
});
