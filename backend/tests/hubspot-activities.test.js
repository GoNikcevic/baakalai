/**
 * Tests de hubspot.getActivities — la lecture des engagements (emails loggés
 * + notes) qui alimente le response-analysis-agent, et donc l'autopilot.
 *
 * Points couverts :
 * - seuls les emails ENTRANTS sont gardés (HubSpot logge aussi nos envois) ;
 * - le HTML des notes est aplati en texte ;
 * - un 403 (scope manquant, ex. sales-email-read absent) sur un type d'objet
 *   dégrade en silence au lieu de faire échouer toute l'analyse.
 */

const test = require('node:test');
const assert = require('node:assert');

const hubspot = require('../api/hubspot');

// Stub de fetch routé par URL. Chaque entrée : [pattern, réponse].
function stubFetch(routes) {
  global.fetch = async (url, options = {}) => {
    for (const [pattern, respond] of routes) {
      if (url.includes(pattern)) {
        const body = typeof respond === 'function' ? respond(url, options) : respond;
        if (body && body.__status) {
          return { ok: false, status: body.__status, text: async () => body.message || '' };
        }
        return { ok: true, status: 200, json: async () => body };
      }
    }
    throw new Error(`Route non stubée : ${url}`);
  };
}

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

test('ne garde que les emails entrants, mappés vers la forme commune', async () => {
  stubFetch([
    ['/associations/emails', { results: [{ toObjectId: 101 }, { toObjectId: 102 }] }],
    ['/associations/notes', { results: [] }],
    ['/objects/emails/batch/read', {
      results: [
        { id: '101', properties: { hs_email_direction: 'INCOMING_EMAIL', hs_email_subject: 'Re: proposition', hs_email_text: 'Oui, appelons-nous mardi', hs_timestamp: '2026-09-10T09:00:00Z' } },
        { id: '102', properties: { hs_email_direction: 'EMAIL', hs_email_subject: 'Notre proposition', hs_email_text: 'Bonjour…', hs_timestamp: '2026-09-09T09:00:00Z' } },
      ],
    }],
  ]);

  const acts = await hubspot.getActivities('token', '42');
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].type, 'email_received');
  assert.strictEqual(acts[0].subject, 'Re: proposition');
  assert.strictEqual(acts[0].note, 'Oui, appelons-nous mardi');
  assert.strictEqual(acts[0].dueDate, '2026-09-10T09:00:00Z');
});

test('aplatit le HTML des notes en texte', async () => {
  stubFetch([
    ['/associations/emails', { results: [] }],
    ['/associations/notes', { results: [{ toObjectId: 201 }] }],
    ['/objects/notes/batch/read', {
      results: [
        { id: '201', properties: { hs_note_body: '<p>Rappel&nbsp;: le client veut <b>2 licences</b></p>', hs_timestamp: '2026-09-11T10:00:00Z' } },
      ],
    }],
  ]);

  const acts = await hubspot.getActivities('token', '42');
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].type, 'note');
  assert.strictEqual(acts[0].note, 'Rappel : le client veut 2 licences');
});

test('403 sur les emails (scope sales-email-read absent) → notes seules, pas d erreur', async () => {
  stubFetch([
    ['/associations/emails', { __status: 403, message: 'scope manquant' }],
    ['/associations/notes', { results: [{ toObjectId: 201 }] }],
    ['/objects/notes/batch/read', {
      results: [{ id: '201', properties: { hs_note_body: 'A répondu par téléphone, intéressé', hs_timestamp: '2026-09-11T10:00:00Z' } }],
    }],
  ]);

  const acts = await hubspot.getActivities('token', '42');
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].type, 'note');
});

test('contact sans engagement → tableau vide', async () => {
  stubFetch([
    ['/associations/emails', { results: [] }],
    ['/associations/notes', { results: [] }],
  ]);

  const acts = await hubspot.getActivities('token', '42');
  assert.deepStrictEqual(acts, []);
});
