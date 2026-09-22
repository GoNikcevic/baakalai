/**
 * Tests de hubspot.resolveDealStage / updateDealStage · l'écriture d'étape sur
 * un deal EXISTANT.
 *
 * Le bug corrigé : les deux appelants (orchestrator/jobs/hubspot-sync.js et
 * routes/crm.js) envoyaient mapOpportunityToDeal() en PATCH. Cet objet porte
 * `dealname`, `description` et `pipeline: 'default'`, donc un simple changement
 * de statut dans l'app renommait le deal du client, écrasait sa description et
 * le déplaçait vers le pipeline par défaut. En prime, mapStatusToDealStage() ne
 * connaît que les ids du pipeline par défaut, inexistants dans un pipeline
 * personnalisé.
 *
 * Points couverts :
 * - le PATCH ne contient QUE `dealstage`, jamais dealname/description/pipeline ;
 * - gagné et perdu sont résolus par metadata, donc fiables sur un pipeline
 *   personnalisé dont on ne connaît aucun id ;
 * - un statut intermédiaire sur un pipeline personnalisé n'écrit rien du tout
 *   plutôt que d'écrire un id qui n'y existe pas ;
 * - un deal déjà sur la bonne étape n'est pas réécrit (pas d'écho inutile) ;
 * - un deal supprimé (404) dégrade en silence.
 */

const test = require('node:test');
const assert = require('node:assert');

const hubspot = require('../api/hubspot');

// Stub de fetch routé par URL. Chaque entrée : [pattern, réponse].
// Les appels PATCH sont collectés dans `patches` pour être inspectés.
function stubFetch(routes, patches) {
  global.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') {
      let body;
      try {
        body = JSON.parse(options.body);
      } catch {
        throw new Error(`Corps de PATCH illisible : ${options.body}`);
      }
      patches.push({ url, body });
      return { ok: true, status: 200, json: async () => ({ id: '42' }) };
    }
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

// Pipeline personnalisé : aucun des ids du pipeline par défaut n'y existe.
const PIPELINE_MAISON = {
  results: [{
    id: '7788',
    label: 'Cycle long',
    displayOrder: 0,
    stages: [
      { id: '900', label: 'Premier contact', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
      { id: '901', label: 'Signe', displayOrder: 1, metadata: { isClosed: 'true', probability: '1.0' } },
      { id: '902', label: 'Perdu', displayOrder: 2, metadata: { isClosed: 'true', probability: '0.0' } },
    ],
  }],
};

test('gagne sur un pipeline personnalise : ecrit l etape close-won de CE pipeline', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: '900', pipeline: '7788' } }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'won');

  assert.strictEqual(written, '901');
  assert.strictEqual(patches.length, 1);
  assert.deepStrictEqual(patches[0].body, { properties: { dealstage: '901' } });
});

test('le PATCH ne porte QUE dealstage : ni dealname, ni description, ni pipeline', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: '900', pipeline: '7788' } }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  await hubspot.updateDealStage('token', '42', 'lost');

  const props = patches[0].body.properties;
  assert.deepStrictEqual(Object.keys(props), ['dealstage']);
  assert.strictEqual(props.dealstage, '902');
  assert.strictEqual(props.dealname, undefined);
  assert.strictEqual(props.description, undefined);
  assert.strictEqual(props.pipeline, undefined);
});

test('statut intermediaire sur un pipeline personnalise : aucune ecriture', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: '900', pipeline: '7788' } }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'negotiation');

  assert.strictEqual(written, null);
  assert.strictEqual(patches.length, 0, 'un id du pipeline par defaut n aurait rien a faire ici');
});

test('statut intermediaire sur le pipeline par defaut : la correspondance historique s applique', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: 'appointmentscheduled', pipeline: 'default' } }],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'negotiation');

  assert.strictEqual(written, 'decisionmakerboughtin');
  assert.deepStrictEqual(patches[0].body, { properties: { dealstage: 'decisionmakerboughtin' } });
});

test('deal deja sur la bonne etape : aucune ecriture', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: '901', pipeline: '7788' } }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'won');

  assert.strictEqual(written, null);
  assert.strictEqual(patches.length, 0);
});

test('deal supprime (404) : degrade en silence', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { __status: 404, message: 'not found' }],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'won');

  assert.strictEqual(written, null);
  assert.strictEqual(patches.length, 0);
});

test('pipeline du deal introuvable dans le portail : aucune ecriture', async () => {
  const patches = [];
  stubFetch([
    ['/objects/deals/42', { id: '42', properties: { dealstage: '900', pipeline: '9999' } }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  const written = await hubspot.updateDealStage('token', '42', 'won');

  assert.strictEqual(written, null);
  assert.strictEqual(patches.length, 0);
});

test('getDeal demande explicitement pipeline, sinon HubSpot ne le renvoie pas', async () => {
  const patches = [];
  let vue = null;
  stubFetch([
    ['/objects/deals/42', (url) => { vue = url; return { id: '42', properties: { dealstage: '900', pipeline: '7788' } }; }],
    ['/pipelines/deals', PIPELINE_MAISON],
  ], patches);

  await hubspot.updateDealStage('token', '42', 'won');

  assert.ok(vue.includes('properties='), 'la requete doit porter un parametre properties');
  assert.ok(decodeURIComponent(vue).includes('pipeline'), 'pipeline doit etre demande');
});
