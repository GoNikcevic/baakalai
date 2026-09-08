/**
 * Tests du rapatriement des étapes de pipeline.
 *
 * Les objets de test reproduisent ce que chaque connecteur renvoie réellement —
 * c'est là que sont les pièges : HubSpot n'a pas de booléen « gagné » mais une
 * probabilité en chaîne, Salesforce ne reporte que le libellé sur l'Opportunity,
 * et Odoo appelle « équipe » ce que les autres appellent pipeline.
 */

const test = require('node:test');
const assert = require('node:assert');

const { extractStageId, stageUpdates, statusFromStage, odooCreds } = require('../lib/crm-stage-resolver');

// ── extractStageId : trouver l'étape quel que soit le connecteur ──

test('pipedrive — l identifiant numerique devient une chaine', () => {
  assert.strictEqual(extractStageId('pipedrive', { stageId: '5', stage: 5 }), '5');
  // Cas des appelants historiques qui ne posent que `stage`.
  assert.strictEqual(extractStageId('pipedrive', { stage: 12 }), '12');
});

test('pipedrive — l etape 0 n est pas confondue avec une absence d etape', () => {
  // Piège classique : `stage || null` renverrait null pour l'étape 0.
  assert.strictEqual(extractStageId('pipedrive', { stage: 0 }), '0');
});

test('salesforce — c est le libelle qui sert de cle, pas un Id', () => {
  // Opportunity.StageName ne contient jamais l'Id du OpportunityStage.
  assert.strictEqual(extractStageId('salesforce', { stage: 'Negotiation/Review' }), 'Negotiation/Review');
});

test('hubspot — l identifiant interne d etape est conserve tel quel', () => {
  assert.strictEqual(extractStageId('hubspot', { stageId: 'appointmentscheduled' }), 'appointmentscheduled');
});

test('un CRM sans etapes ne renvoie rien', () => {
  assert.strictEqual(extractStageId('notion', { stage: 'Gagné' }), null);
  assert.strictEqual(extractStageId('pipedrive', {}), null);
  assert.strictEqual(extractStageId('pipedrive', null), null);
});

// ── stageUpdates : n'écrire que ce qui a changé ──

const stageMap = new Map([
  ['5', { stageId: '5', stageName: 'Négociation', pipelineId: '1', pipelineName: 'Ventes', order: 3 }],
]);

test('un deal qui change d etape recoit le libelle et la date', () => {
  const out = stageUpdates('pipedrive', { stageId: '5' }, stageMap, { crm_stage_id: '2' });
  assert.strictEqual(out.crm_stage_id, '5');
  assert.strictEqual(out.crm_stage_name, 'Négociation');
  assert.strictEqual(out.crm_pipeline_name, 'Ventes');
  assert.strictEqual(out.crm_stage_order, 3);
  assert.ok(out.stage_changed_at, 'la date d entree dans l etape doit etre posee');
});

test('un deal qui n a pas bouge ne produit aucune ecriture', () => {
  // C'est ce qui garantit que stage_changed_at reste la vraie date d'entrée
  // dans l'étape et n'est pas réécrite à chaque passage du cron quotidien.
  const out = stageUpdates('pipedrive', { stageId: '5' }, stageMap, { crm_stage_id: '5' });
  assert.deepStrictEqual(out, {});
});

test('une etape inconnue du referentiel garde son identifiant comme libelle', () => {
  // Étape supprimée côté CRM, ou lecture du référentiel en échec : on n'invente
  // pas de nom, et on n'écrase pas le pipeline déjà connu.
  const out = stageUpdates('pipedrive', { stageId: '99' }, stageMap, {});
  assert.strictEqual(out.crm_stage_id, '99');
  assert.strictEqual(out.crm_stage_name, '99');
  assert.strictEqual(out.crm_pipeline_name, undefined);
});

test('un deal sans etape ne declenche aucune ecriture', () => {
  assert.deepStrictEqual(stageUpdates('pipedrive', {}, stageMap, { crm_stage_id: '5' }), {});
});

test('une opportunite jamais synchronisee recoit son etape', () => {
  const out = stageUpdates('pipedrive', { stageId: '5' }, stageMap, {});
  assert.strictEqual(out.crm_stage_id, '5');
});

// ── Odoo : identifiants tantôt objet, tantôt JSON sérialisé ──

test('odoo — les identifiants serialises sont reparses', () => {
  assert.deepStrictEqual(odooCreds('{"url":"https://x.odoo.com","db":"x"}'), { url: 'https://x.odoo.com', db: 'x' });
});

test('odoo — un objet passe inchange, une chaine invalide ne casse rien', () => {
  const obj = { url: 'https://x.odoo.com' };
  assert.strictEqual(odooCreds(obj), obj);
  assert.deepStrictEqual(odooCreds('pas du json'), {});
});

// ── statusFromStage : le gain déduit de l'étape (cas Odoo) ──

const odooStages = new Map([
  ['4', { stageId: '4', stageName: 'Gagné', isWon: true, order: 4 }],
  ['2', { stageId: '2', stageName: 'Proposition', isWon: false, order: 2 }],
]);

test('odoo — l etape gagnante fait passer le deal en gagne', () => {
  // Sans ça, aucun deal Odoo ne passe jamais « gagné » : le connecteur ne
  // renvoie aucun champ statut.
  assert.strictEqual(statusFromStage(odooStages, '4'), 'won');
});

test('une etape ordinaire ne conclut jamais a une perte', () => {
  // Odoo exprime la perte par l'archivage du lead, pas par l'étape : deviner
  // ici marquerait perdus tous les deals en cours.
  assert.strictEqual(statusFromStage(odooStages, '2'), null);
  assert.strictEqual(statusFromStage(odooStages, '99'), null);
  assert.strictEqual(statusFromStage(odooStages, null), null);
});
