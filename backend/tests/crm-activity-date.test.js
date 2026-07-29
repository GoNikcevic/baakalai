/**
 * Tests d'extraction de la date de dernière activité CRM.
 *
 * Les formes d'enregistrements reproduisent ce que chaque API renvoie
 * réellement — c'est là que sont les pièges (epoch HubSpot en chaîne,
 * datetime Odoo sans fuseau).
 */

const test = require('node:test');
const assert = require('node:assert');

const { extractActivityDate, parseDate } = require('../lib/crm-activity-date');

test('pipedrive — prend la derniere activite avant la modification', () => {
  const out = extractActivityDate('pipedrive', {
    add_time: '2026-01-10 09:00:00',
    update_time: '2026-06-01 12:00:00',
    last_activity_date: '2026-03-15',
  });
  // last_activity_date prime : une modification de champ n'est pas une activite.
  assert.strictEqual(out.slice(0, 10), '2026-03-15');
});

test('pipedrive — retombe sur update_time si aucune activite', () => {
  const out = extractActivityDate('pipedrive', { add_time: '2026-01-10 09:00:00', update_time: '2026-06-01 12:00:00' });
  assert.strictEqual(out.slice(0, 7), '2026-06');
});

test('hubspot — lit les proprietes imbriquees et l epoch en millisecondes', () => {
  const out = extractActivityDate('hubspot', {
    id: '1',
    properties: { hs_last_sales_activity_timestamp: '1748000000000', createdate: '2026-01-01T00:00:00Z' },
  });
  assert.ok(out.startsWith('2025-') || out.startsWith('2026-'), `date inattendue: ${out}`);
});

test('hubspot — priorite a l activite commerciale sur la date de modification', () => {
  const out = extractActivityDate('hubspot', {
    properties: { lastmodifieddate: '2026-07-01T00:00:00Z', notes_last_contacted: '2026-02-01T00:00:00Z' },
  });
  assert.strictEqual(out.slice(0, 7), '2026-02');
});

test('salesforce — LastActivityDate prime sur LastModifiedDate', () => {
  const out = extractActivityDate('salesforce', {
    LastModifiedDate: '2026-07-20T10:00:00.000+0000',
    LastActivityDate: '2026-04-05',
    CreatedDate: '2025-01-01T00:00:00.000+0000',
  });
  assert.strictEqual(out.slice(0, 10), '2026-04-05');
});

test('odoo — le datetime sans fuseau est lu en UTC, pas en heure locale', () => {
  // Sans forcage UTC, le decalage fait basculer un deal de part et d'autre
  // d'un seuil de recence selon le fuseau du serveur.
  const out = extractActivityDate('odoo', { write_date: '2026-05-30 14:22:01' });
  assert.strictEqual(out, '2026-05-30T14:22:01.000Z');
});

test('champ deja normalise par le connecteur', () => {
  assert.strictEqual(
    extractActivityDate('salesforce', { lastActivityAt: '2026-03-01T00:00:00.000Z' }),
    '2026-03-01T00:00:00.000Z'
  );
});

test('renvoie null quand le CRM n expose aucune date', () => {
  assert.strictEqual(extractActivityDate('folk', { id: 1, name: 'X' }), null);
  assert.strictEqual(extractActivityDate('notion', {}), null);
  assert.strictEqual(extractActivityDate('inconnu', { update_time: '2026-01-01' }), null);
});

test('tolere les entrees absurdes sans lever', () => {
  assert.strictEqual(extractActivityDate('pipedrive', null), null);
  assert.strictEqual(extractActivityDate('pipedrive', 'texte'), null);
  assert.strictEqual(extractActivityDate('pipedrive', { update_time: '' }), null);
  assert.strictEqual(extractActivityDate('pipedrive', { update_time: 'pas une date' }), null);
});

test('rejette les dates aberrantes', () => {
  // Une date lointaine dans le futur est une saisie erronee, pas une activite :
  // la retenir ferait passer un deal mort pour actif.
  const futur = new Date(Date.now() + 400 * 86400000).toISOString();
  assert.strictEqual(extractActivityDate('pipedrive', { update_time: futur }), null);
  assert.strictEqual(extractActivityDate('pipedrive', { update_time: '1970-01-05' }), null);
});

test('parseDate accepte epoch en secondes et en millisecondes', () => {
  assert.strictEqual(parseDate(1750000000).toISOString().slice(0, 4), '2025');
  assert.strictEqual(parseDate('1750000000000').toISOString().slice(0, 4), '2025');
});
