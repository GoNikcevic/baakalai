/**
 * Ce que baakalai comprend du pipeline du user.
 *
 * Deux risques, et ce sont eux que ces tests gardent.
 *
 * 1. L'IDENTIFIANT D'ÉTAPE. `crm_stage_id` n'a pas la même nature selon le
 *    CRM : numérique chez Pipedrive et Odoo, id interne de dealstage chez
 *    HubSpot, LIBELLÉ chez Salesforce. Si la lecture du pipeline ne renvoie
 *    pas exactement ce que lib/stage-tracking.js écrit sur les deals, le
 *    rapprochement échoue sans erreur et le mappage ne s'applique à personne.
 *    C'est précisément le bug qui avait figé les compteurs de la Vue globale
 *    Deals à zéro.
 *
 * 2. LA FRONTIÈRE AVEC LE LIFECYCLE. Gagné et perdu appartiennent à
 *    lib/deal-lifecycle-sync.js, qui les tire des drapeaux natifs du deal. Ce
 *    module n'a le droit d'écrire que les statuts ouverts. Deux écritures
 *    concurrentes sur `status` finiraient par se contredire.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Les quatre connecteurs sont remplacés par des doublures qui rendent EXACTEMENT
// la forme de leur API réelle · c'est là que sont les pièges.
function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, path: path.dirname(resolved),
    loaded: true, children: [], paths: [], exports,
  };
}

stub('../db', { async query() { return { rows: [], rowCount: 0 }; } });

stub('../api/pipedrive', {
  async getPipelines() { return [{ id: 7, name: 'Ventes directes' }]; },
  async getStages() {
    return [
      { id: 21, name: 'Contact établi', pipelineId: 7, order: 1 },
      { id: 22, name: 'Proposition envoyée', pipelineId: 7, order: 2 },
    ];
  },
});

stub('../api/hubspot', {
  async getDealPipelines() {
    return [{
      id: 'default', name: 'Sales Pipeline', order: 0,
      stages: [
        { id: 'qualifiedtobuy', name: 'Qualified to buy', order: 1, closed: false, won: false },
        { id: 'closedwon', name: 'Closed won', order: 9, closed: true, won: true },
        { id: 'closedlost', name: 'Closed lost', order: 10, closed: true, won: false },
      ],
    }];
  },
});

stub('../api/salesforce', {
  async getStages() {
    return [
      // getStages renvoie l'Id du OpportunityStage ; c'est le MasterLabel qui
      // doit ressortir comme identifiant, l'Opportunity ne porte que StageName.
      { id: '01J000000000001', name: 'Analyse requise', order: 3, isClosed: false, isWon: false },
      { id: '01J000000000002', name: 'Fermé gagné', order: 8, isClosed: true, isWon: true },
      { id: '01J000000000003', name: 'Fermé perdu', order: 9, isClosed: true, isWon: false },
    ];
  },
});

stub('../api/odoo', {
  async getStages() {
    return [
      { id: 4, name: 'Qualification', order: 2, isWon: false },
      { id: 9, name: 'Gagné', order: 9, isWon: true },
    ];
  },
});

const mapper = require('../lib/crm-stage-mapper');

// ── 1. Identifiant d'étape ────────────────────────────────────────────────

test('salesforce, l identifiant est le LIBELLE, jamais l Id de OpportunityStage', async () => {
  const stages = await mapper.fetchPipelineStages('salesforce', { instanceUrl: 'https://x', accessToken: 't' });
  const analyse = stages.find(s => s.name === 'Analyse requise');
  // Le jour où quelqu'un « corrige » ça en prenant s.Id, le mappage cesse
  // silencieusement de s'appliquer : aucune ligne ne matche plus.
  assert.equal(analyse.id, 'Analyse requise');
  assert.notEqual(analyse.id, '01J000000000001');
});

test('hubspot, l identifiant est l id interne de dealstage, pas son libelle', async () => {
  const stages = await mapper.fetchPipelineStages('hubspot', 'token');
  const qualified = stages.find(s => s.name === 'Qualified to buy');
  assert.equal(qualified.id, 'qualifiedtobuy');
  // Le pipeline est porté jusqu'au mappage : deux pipelines HubSpot peuvent
  // avoir une étape homonyme.
  assert.equal(qualified.pipelineName, 'Sales Pipeline');
});

test('pipedrive et odoo, l identifiant numerique ressort en chaine', async () => {
  const pd = await mapper.fetchPipelineStages('pipedrive', 'token');
  assert.equal(pd[0].id, '21');
  assert.equal(pd[0].pipelineName, 'Ventes directes');

  const od = await mapper.fetchPipelineStages('odoo', { url: 'x' });
  assert.equal(od[0].id, '4');
});

test('un CRM sans pipeline structure ne rend rien, et ne leve pas', async () => {
  // Notion, Airtable et Folk : leur « étape » est une propriété texte libre.
  assert.deepEqual(await mapper.fetchPipelineStages('notion', 'token'), []);
  assert.deepEqual(await mapper.fetchPipelineStages(null, 'token'), []);
  assert.deepEqual(await mapper.fetchPipelineStages('salesforce', null), []);
});

// ── 2. Ce que le CRM dit lui-même ─────────────────────────────────────────

test('les etapes terminales sont deduites des drapeaux du CRM, pas devinees', async () => {
  const sf = await mapper.fetchPipelineStages('salesforce', { instanceUrl: 'https://x', accessToken: 't' });
  const byName = Object.fromEntries(sf.map(s => [s.name, mapper.ruleStatus(s)]));
  assert.equal(byName['Fermé gagné'], 'won');
  assert.equal(byName['Fermé perdu'], 'lost');
  // Étape ouverte : aucune règle ne tranche, c'est à Claude de le faire.
  assert.equal(byName['Analyse requise'], null);

  const hs = await mapper.fetchPipelineStages('hubspot', 'token');
  const hsByName = Object.fromEntries(hs.map(s => [s.name, mapper.ruleStatus(s)]));
  assert.equal(hsByName['Closed won'], 'won');
  assert.equal(hsByName['Closed lost'], 'lost');
  assert.equal(hsByName['Qualified to buy'], null);
});

test('pipedrive n a aucune etape terminale, gagne et perdu y sont un statut de deal', async () => {
  const pd = await mapper.fetchPipelineStages('pipedrive', 'token');
  // Marquer « Proposition envoyée » comme terminale parce qu'elle est en bout
  // de liste rangerait des deals vivants chez les perdus.
  for (const stage of pd) assert.equal(mapper.ruleStatus(stage), null);
});

test('odoo ne marque que le gagne, le perdu y est un motif pose sur le lead', async () => {
  const od = await mapper.fetchPipelineStages('odoo', { url: 'x' });
  assert.equal(mapper.ruleStatus(od.find(s => s.name === 'Gagné')), 'won');
  assert.equal(mapper.ruleStatus(od.find(s => s.name === 'Qualification')), null);
});

// ── 3. Frontière avec le lifecycle ────────────────────────────────────────

test('le module n ecrit que les statuts ouverts, jamais un denouement', () => {
  // Si quelqu'un ajoute 'won' ou 'lost' ici, deux écritures concurrentes sur
  // opportunities.status se mettent à se contredire d'une synchro à l'autre.
  assert.deepEqual(mapper.OPEN_STATUSES, ['interested', 'meeting', 'negotiation']);
  assert.ok(!mapper.OPEN_STATUSES.includes('won'));
  assert.ok(!mapper.OPEN_STATUSES.includes('lost'));
});

test('le mappage ne propose que des statuts atteignables depuis une etape', () => {
  // 'new' et 'imported' disent d'où vient un contact, pas où il en est : les
  // proposer ferait reculer un deal à chaque synchro.
  assert.deepEqual(mapper.CANONICAL_STATUSES, ['interested', 'meeting', 'negotiation', 'won', 'lost']);
});

test('une correction manuelle refuse un statut hors modele', async () => {
  await assert.rejects(
    () => mapper.setStageMapping('user-1', 'map-1', 'imported'),
    /Statut inconnu/
  );
});
