/**
 * Le branchement « le deal change de stage ».
 *
 * `trackStage` est le point d'entrée unique des changements d'étape : le
 * webhook Pipedrive et la synchro delta y passent tous les deux. C'est donc
 * là que le déclencheur s'accroche, et c'est là que se joue le risque.
 *
 * LE GARDE-FOU CENTRAL : une PREMIÈRE observation n'est pas un changement.
 * À l'import initial, `opp.crm_stage` est NULL et chaque deal produit une
 * transition. Sans ce test, quelqu'un qui arme un déclencheur puis importe
 * son CRM inscrirait sa base entière d'un coup. Le disjoncteur finirait par
 * couper, mais après coup, et après des envois réels.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbPath = require.resolve('../db');

const calls = [];
const state = { historyInserts: 0 };

const fakeDb = {
  async query(sql) {
    if (/INSERT INTO opportunity_stage_history/.test(sql)) {
      state.historyInserts++;
      return { rows: [] };
    }
    return { rows: [] };
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: fakeDb,
};

// L'automatisation est remplacée : on vérifie QUI est appelé, pas ce que
// l'inscription fait (elle a ses propres tests).
const enrollPath = require.resolve('../lib/automation-enroll');
require.cache[enrollPath] = {
  id: enrollPath, filename: enrollPath, path: path.dirname(enrollPath),
  loaded: true, children: [], paths: [],
  exports: {
    async onCrmEvent(payload) { calls.push(payload); return { ok: true }; },
  },
};

const { trackStage } = require('../lib/stage-tracking');

function reset() { calls.length = 0; state.historyInserts = 0; }

test('un import initial n inscrit personne', async () => {
  reset();
  // `crm_stage` NULL : on découvre le deal, on ne le voit pas bouger.
  await trackStage('u1', { id: 'opp-1', crm_stage: null, crm_stage_id: null },
    { stageId: '12', stageLabel: 'Négociation' });

  assert.equal(state.historyInserts, 1, 'la transition reste historisee');
  assert.equal(calls.length, 0, 'mais aucune automatisation ne part');
});

test('un vrai changement de stage declenche l automatisation', async () => {
  reset();
  await trackStage('u1', { id: 'opp-1', crm_stage: 'Négociation', crm_stage_id: '12' },
    { stageId: '15', stageLabel: 'Gagné' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    userId: 'u1',
    opportunityId: 'opp-1',
    eventKey: 'deal_stage_changed',
    toStage: 'Gagné',
  });
});

test('une etape inchangee ne produit ni historique ni automatisation', async () => {
  reset();
  const updates = await trackStage('u1', { id: 'opp-1', crm_stage: 'Gagné', crm_stage_id: '15' },
    { stageId: '15', stageLabel: 'Gagné' });

  assert.deepEqual(updates, {});
  assert.equal(state.historyInserts, 0);
  assert.equal(calls.length, 0);
});

test('un simple renommage d etape ne declenche rien', async () => {
  // Même identifiant, autre libellé : le deal n'a pas bougé, c'est le CRM qui
  // a été réorganisé. Inscrire quelqu'un là-dessus serait un faux positif.
  reset();
  const updates = await trackStage('u1', { id: 'opp-1', crm_stage: 'Gagne', crm_stage_id: '15' },
    { stageId: '15', stageLabel: 'Gagné' });

  assert.equal(updates.crm_stage, 'Gagné');
  assert.equal(state.historyInserts, 0);
  assert.equal(calls.length, 0);
});

test('une etape vide est ignoree', async () => {
  reset();
  const updates = await trackStage('u1', { id: 'opp-1', crm_stage: 'Gagné', crm_stage_id: '15' },
    { stageId: null, stageLabel: null });

  assert.deepEqual(updates, {});
  assert.equal(calls.length, 0);
});
