/**
 * La forme normalisée d'un deal, identique sur les quatre CRM.
 *
 * Les connecteurs sont censés rendre la même chose. En pratique chacun jetait
 * ce que son CRM avait de particulier, et c'est la SOCIÉTÉ qui disparaissait :
 * Salesforce gardait `accountId`, Pipedrive jetait `org_id`, HubSpot ne
 * demandait même pas l'association `companies`, Odoo ne posait pas la question.
 *
 * Conséquence : toute règle de rattachement devait être écrite DANS le
 * connecteur, donc une fois par CRM. C'est ce qui a rendu le correctif du 29/09
 * utile à Salesforce et à lui seul, alors que le défaut (un deal sans personne
 * est jeté en silence) est commun aux quatre.
 *
 * Ces tests gardent l'invariant : la société remonte, et elle remonte sous le
 * même nom de champ partout. Le jour où le rattachement passe dans la couche
 * commune, c'est cet invariant qui le rend possible.
 */

const test = require('node:test');
const assert = require('node:assert');

/** Champs que tout connecteur doit poser sur un deal, même à null. */
const CHAMPS_ATTENDUS = ['id', 'personId', 'accountId', 'accountName', 'status', 'value', 'updatedAt'];

function stubFetch(routes) {
  global.fetch = async (url) => {
    for (const [motif, corps] of routes) {
      if (String(url).includes(motif)) {
        return { ok: true, status: 200, json: async () => corps };
      }
    }
    return { ok: true, status: 200, json: async () => ({ data: [], results: [] }) };
  };
}

test('pipedrive · la société du deal remonte au lieu d\'être jetée', async () => {
  const pipedrive = require('../api/pipedrive');
  stubFetch([['/deals', {
    success: true,
    data: [{
      id: 7, title: 'Peyrac - Abonnement 3 ans', stage_id: 1, status: 'open', value: 4900,
      person_id: { value: 63, name: 'Vincent Gaillard' },
      org_id: { value: 12, name: 'Peyrac Development SASU' },
      add_time: '2026-09-29 11:20:44', update_time: '2026-09-29 11:30:16',
    }],
  }]]);

  const deals = await pipedrive.getDeals('cle-api', 500);

  assert.strictEqual(deals.length, 1);
  assert.strictEqual(deals[0].personId, 63);
  // C'est la ligne qui manquait : sans elle, un deal Pipedrive sans personne
  // n'a plus rien à quoi se rattacher.
  assert.strictEqual(deals[0].accountId, '12');
  assert.strictEqual(deals[0].accountName, 'Peyrac Development SASU');
  for (const champ of CHAMPS_ATTENDUS) {
    assert.ok(champ in deals[0], `champ absent de la forme normalisée : ${champ}`);
  }
});

test('pipedrive · un deal sans société ne fabrique pas d\'identifiant', async () => {
  // Le jeu de démo du 29/09 est exactement ce cas : personnes et deals liés,
  // aucune organisation. Inventer un identifiant ferait croire à un compte.
  const pipedrive = require('../api/pipedrive');
  stubFetch([['/deals', {
    success: true,
    data: [{ id: 8, title: 'Sans societe', status: 'open', value: 100, person_id: { value: 63 }, org_id: null }],
  }]]);

  const deals = await pipedrive.getDeals('cle-api', 500);

  assert.strictEqual(deals[0].accountId, null);
  assert.strictEqual(deals[0].accountName, null);
});

test('hubspot · l\'association société est demandée, pas seulement les contacts', async () => {
  const hubspot = require('../api/hubspot');
  let urlVue = '';
  global.fetch = async (url) => {
    urlVue = String(url);
    return {
      ok: true, status: 200,
      json: async () => ({
        results: [{
          id: '42',
          properties: { dealname: 'Deal', amount: '1000', dealstage: 'qualifiedtobuy', hs_lastmodifieddate: '2026-09-01' },
          associations: {
            contacts: { results: [{ id: 'c1' }] },
            companies: { results: [{ id: 'co1' }] },
          },
        }],
        paging: null,
      }),
    };
  };

  const deals = await hubspot.getDeals('token', 10);

  // Sans `companies` dans la requête, l'association ne revient jamais, quelle
  // que soit la suite du code.
  assert.match(decodeURIComponent(urlVue), /associations=contacts,companies/);
  assert.strictEqual(deals[0].accountId, 'co1');
  for (const champ of CHAMPS_ATTENDUS) {
    assert.ok(champ in deals[0], `champ absent de la forme normalisée : ${champ}`);
  }
});
