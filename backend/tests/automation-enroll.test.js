/**
 * Automatisation · inscrire un contact depuis un signal.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. Aucun contact n'est créé depuis un signal. Un signal de veille pointe
 *     souvent une société absente de la base ; la créer la ferait tomber dans
 *     la population CRM (campaign_id IS NULL) et la rendrait éligible aux
 *     relances « suite à nos échanges » alors qu'aucun échange n'a eu lieu.
 *  2. Le disjoncteur ne compte QUE les événements. Compté avec le rattrapage,
 *     la toute première automatisation ouvrirait sa propre sécurité dans la
 *     minute, ce qui est la pire démonstration possible.
 *  3. Le signal quitte `new`. C'est la seule preuve mesurable que la feature
 *     sert à quelque chose, et ce qui fait tomber le backlog.
 *  4. Les étapes sont copiées, pas référencées.
 *
 * Le module `db` est remplacé dans le cache de require (même procédé que
 * tests/hidden-revenue-persistence.test.js) : pas besoin d'ajouter cinq tables
 * au miroir SQLite pour vérifier une logique de décision.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbPath = require.resolve('../db');

/* ─────────────── base factice ─────────────── */

const state = {
  trigger: null,
  workflow: null,
  workflowSteps: [],
  opportunity: null,
  mailbox: true,
  recentEventEnrollments: 0,
  enrolledRecently: false,
  liveEnrollment: false,
  createdEnrollments: [],
  copiedSteps: [],
  signalUpdates: [],
  triggerStatus: [],
  fired: 0,
  throwOnCreate: null,
};

function reset(over = {}) {
  Object.assign(state, {
    trigger: { id: 'trig-1', user_id: 'u1', workflow_id: 'wf-1', event_source: 'signal', event_key: 'hiring', status: 'active' },
    workflow: { id: 'wf-1', user_id: 'u1', name: 'Prise de contact', archived_at: null, reenroll_policy: 'period', reenroll_days: 90, max_duration_days: 45 },
    workflowSteps: [
      { id: 'tp1', step: 'E1', type: 'email', timing: 'J+0', subject: null, body: 'Feliciter pour le recrutement.', sub_type: null, label: null, max_chars: null },
      { id: 'tp2', step: 'E2', type: 'email', timing: 'J+3', subject: null, body: 'Relance courte.', sub_type: null, label: null, max_chars: null },
    ],
    opportunity: { id: 'opp-1', user_id: 'u1', email: 'paul@roy.fr', name: 'Paul Roy' },
    mailbox: true,
    recentEventEnrollments: 0,
    enrolledRecently: false,
    liveEnrollment: false,
    createdEnrollments: [],
    copiedSteps: [],
    signalUpdates: [],
    triggerStatus: [],
    fired: 0,
    throwOnCreate: null,
  }, over);
}

const fakeDb = {
  async query(sql, params) {
    if (/FROM email_accounts/.test(sql)) return { rows: state.mailbox ? [{ '?column?': 1 }] : [] };
    if (/UPDATE signals/.test(sql)) {
      state.signalUpdates.push({ status: params[0], triggerId: params[1], enrollmentId: params[2], skipReason: params[3], signalId: params[4] });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM sequence_enrollments/.test(sql) && /created_at > now\(\) - make_interval\(days/.test(sql)) {
      return { rows: state.enrolledRecently ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM sequence_enrollments/.test(sql) && /status IN \('draft', 'active', 'paused'\)/.test(sql)) {
      return { rows: state.liveEnrollment ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM signals/.test(sql) && /id = ANY/.test(sql)) return { rows: state.backfillSignals || [] };
    if (/FROM automation_triggers/.test(sql)) return { rows: state.crmTriggers || [] };
    return { rows: [] };
  },
  opportunities: {
    async get(id) { return state.opportunity && state.opportunity.id === id ? state.opportunity : null; },
    async findByEmail(userId, email) {
      return state.opportunity && state.opportunity.email === email ? state.opportunity : null;
    },
  },
  touchpoints: {
    async listByWorkflow() { return state.workflowSteps; },
    async create(campaignId, data) { state.copiedSteps.push(data); return { id: 'copy' + state.copiedSteps.length }; },
  },
  workflows: {
    async get(id) { return state.workflow && state.workflow.id === id ? state.workflow : null; },
  },
  automationTriggers: {
    async findActive() { return state.trigger; },
    async recentEventEnrollments() { return state.recentEventEnrollments; },
    async setStatus(id, status, opts) { state.triggerStatus.push({ id, status, opts }); return { id, status }; },
    async markFired() { state.fired++; },
  },
  sequenceEnrollments: {
    async create(payload) {
      if (state.throwOnCreate) { const e = new Error('dup'); e.code = state.throwOnCreate; throw e; }
      state.createdEnrollments.push(payload);
      return { id: 'enr-1', ...payload };
    },
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: fakeDb,
};

const {
  enrollFromSignal, runBackfill, dedupKeyFor, onCrmEvent, matchesConditions, BREAKER_PER_HOUR,
} = require('../lib/automation-enroll');

const SIGNAL = {
  id: 'sig-1', user_id: 'u1', signal_type: 'hiring', status: 'new',
  title: 'Recrute 3 commerciaux', company_name: 'Roy Industrie',
  contact_email: 'paul@roy.fr', opportunity_id: null,
};

/* ─────────────── chemin nominal ─────────────── */

test('un signal dont le contact existe inscrit le contact et quitte new', async () => {
  reset();
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.ok, true);
  assert.equal(state.createdEnrollments.length, 1);

  const enr = state.createdEnrollments[0];
  assert.equal(enr.goal, 'automation');
  assert.equal(enr.createdBy, 'trigger');
  assert.equal(enr.enrollmentSource, 'event');
  assert.equal(enr.status, 'active');
  assert.equal(enr.triggerId, 'trig-1');
  assert.equal(enr.workflowId, 'wf-1');
  assert.equal(enr.signalId, 'sig-1');

  const upd = state.signalUpdates.at(-1);
  assert.equal(upd.status, 'automated');
  assert.equal(upd.enrollmentId, 'enr-1');
  assert.equal(state.fired, 1);
});

test('les etapes du modele sont COPIEES dans l enrollment', async () => {
  reset();
  await enrollFromSignal({ ...SIGNAL });

  assert.equal(state.copiedSteps.length, 2);
  assert.equal(state.copiedSteps[0].enrollmentId, 'enr-1');
  assert.equal(state.copiedSteps[0].body, 'Feliciter pour le recrutement.');
  assert.equal(state.copiedSteps[1].timing, 'J+3');
  // Ordre reconstruit : un contact ne doit pas recevoir E2 avant E1.
  assert.equal(state.copiedSteps[0].sortOrder, 0);
  assert.equal(state.copiedSteps[1].sortOrder, 1);
  // Le modele n'est jamais rattache a l'enrollment : il reste reutilisable.
  assert.ok(state.copiedSteps.every(s => !s.workflowId));
});

/* ─────────────── aucun contact cree ─────────────── */

test('une societe absente de la base ne cree AUCUN contact', async () => {
  reset({ opportunity: null });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no_known_contact');
  assert.equal(state.createdEnrollments.length, 0);

  // Le signal est consomme avec sa raison : un declencheur muet doit pouvoir
  // s'expliquer au lieu de laisser l'interface inventer une cause.
  const upd = state.signalUpdates.at(-1);
  assert.equal(upd.status, 'skipped');
  assert.equal(upd.skipReason, 'no_known_contact');
});

test('un prospect de campagne n est jamais inscrit', async () => {
  // `opportunities` melange deux populations (lib/crm-scope) et findByEmail ne
  // fait pas la difference. Un prospect froid est deja dans la sequence de sa
  // campagne : l inscrire ici lui vaudrait un second fil d emails en
  // parallele, ecrit pour quelqu un avec qui on a un historique.
  reset({ opportunity: { id: 'opp-p', user_id: 'u1', email: 'paul@roy.fr', campaign_id: 'camp-1' } });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'no_known_contact');
  assert.equal(state.createdEnrollments.length, 0);
});

test('un prospect de campagne reference directement par le signal est refuse aussi', async () => {
  reset({ opportunity: { id: 'opp-p', user_id: 'u1', email: 'paul@roy.fr', campaign_id: 'camp-1' } });
  const out = await enrollFromSignal({ ...SIGNAL, opportunity_id: 'opp-p' });

  assert.equal(out.reason, 'no_known_contact');
  assert.equal(state.createdEnrollments.length, 0);
});

test('un contact sans adresse email ne part pas', async () => {
  reset({ opportunity: { id: 'opp-2', user_id: 'u1', email: null, name: 'Inconnu' } });
  const out = await enrollFromSignal({ ...SIGNAL, opportunity_id: 'opp-2' });

  assert.equal(out.reason, 'no_email');
  assert.equal(state.createdEnrollments.length, 0);
});

/* ─────────────── idempotence ─────────────── */

test('le cron qui recalcule un signal ne reinscrit pas le meme contact', async () => {
  reset({ enrolledRecently: true });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'recently_enrolled');
  assert.equal(state.createdEnrollments.length, 0);
  assert.equal(state.signalUpdates.at(-1).skipReason, 'recently_enrolled');
});

test('un contact deja engage ailleurs n entre pas dans un second workflow', async () => {
  reset({ liveEnrollment: true });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'contact_in_other_workflow');
  assert.equal(state.createdEnrollments.length, 0);
});

test('une course perdue sur l index unique se termine en skip, pas en 500', async () => {
  reset({ throwOnCreate: '23505' });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'recently_enrolled');
});

test('la cle de dedup porte sur le workflow et non sur le declencheur', () => {
  // Un contact deja passe par ce parcours via Recrutement ne doit pas y
  // entrer une seconde fois via Levee de fonds.
  assert.equal(dedupKeyFor({ id: 'wf-1', reenroll_policy: 'never' }, 'opp-1'), 'wf:wf-1:opp:opp-1');
  assert.equal(dedupKeyFor({ id: 'wf-1', reenroll_policy: 'period' }, 'opp-1'), null);
  assert.equal(dedupKeyFor({ id: 'wf-1', reenroll_policy: 'always' }, 'opp-1'), null);
});

/* ─────────────── disjoncteur ─────────────── */

test('le disjoncteur coupe au seuil et met le declencheur en pause', async () => {
  reset({ recentEventEnrollments: BREAKER_PER_HOUR });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'breaker_open');
  assert.equal(state.createdEnrollments.length, 0);
  assert.equal(state.triggerStatus.at(-1).status, 'breaker');
  // Cause transitoire : le signal reste reutilisable, il n'est pas consomme.
  assert.equal(state.signalUpdates.length, 0);
});

test('le rattrapage ne declenche pas le disjoncteur', async () => {
  // C'est le point qui rendrait la premiere automatisation catastrophique :
  // inscrire le stock en attente ouvrirait sa propre securite.
  reset({ recentEventEnrollments: BREAKER_PER_HOUR + 50 });
  const out = await enrollFromSignal({ ...SIGNAL }, { source: 'backfill' });

  assert.equal(out.ok, true);
  assert.equal(state.createdEnrollments[0].enrollmentSource, 'backfill');
  assert.equal(state.triggerStatus.length, 0);
});

/* ─────────────── boite mail ─────────────── */

test('sans boite mail connectee rien ne part, et le signal reste utilisable', async () => {
  reset({ mailbox: false });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'no_mailbox');
  assert.equal(state.createdEnrollments.length, 0);
  // Transitoire : il repassera quand une boite sera connectee.
  assert.equal(state.signalUpdates.length, 0);
});

/* ─────────────── garde-fous de modele ─────────────── */

test('un workflow sans etape n inscrit personne', async () => {
  // Sinon l enrollment se terminerait aussitot en `completed`, ce qui
  // ressemblerait a un parcours mene a son terme.
  reset({ workflowSteps: [] });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'workflow_empty');
  assert.equal(state.createdEnrollments.length, 0);
});

test('aucun declencheur arme sur ce type : rien ne se passe et rien n est marque', async () => {
  reset({ trigger: null });
  const out = await enrollFromSignal({ ...SIGNAL });

  assert.equal(out.reason, 'no_trigger');
  assert.equal(state.signalUpdates.length, 0);
});

/* ─────────────── rattrapage ─────────────── */

test('le rattrapage inscrit le stock et rend compte de ce qu il a ecarte', async () => {
  reset();
  state.backfillSignals = [
    { ...SIGNAL, id: 's1' },
    { ...SIGNAL, id: 's2' },
  ];
  const report = await runBackfill('u1', state.trigger, ['s1', 's2']);

  assert.equal(report.enrolled, 2);
  assert.equal(report.skipped, 0);
  assert.ok(state.createdEnrollments.every(e => e.enrollmentSource === 'backfill'));
});

test('un rattrapage sans identifiant ne fait rien', async () => {
  reset();
  const report = await runBackfill('u1', state.trigger, []);
  assert.deepEqual(report, { enrolled: 0, skipped: 0, reasons: {} });
});


/* ─────────────── evenement CRM : changement de stage ─────────────── */

const CRM_TRIGGER = {
  id: 'trig-crm', user_id: 'u1', workflow_id: 'wf-1',
  event_source: 'crm_event', event_key: 'deal_stage_changed', status: 'active',
  conditions: { toStages: ['Gagné'] },
};

test('un deal qui passe au stage cible inscrit son contact', async () => {
  reset();
  state.crmTriggers = [CRM_TRIGGER];
  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Gagné',
  });

  assert.equal(out.ok, true);
  assert.equal(state.createdEnrollments.length, 1);
  assert.equal(state.createdEnrollments[0].triggerId, 'trig-crm');
  // Aucun signal n'est touche : l evenement ne vient pas de la veille.
  assert.equal(state.signalUpdates.length, 0);
});

test('un deal qui passe a un AUTRE stage n inscrit personne', async () => {
  reset();
  state.crmTriggers = [CRM_TRIGGER];
  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Négociation',
  });

  assert.equal(out.ok, false);
  assert.equal(state.createdEnrollments.length, 0);
});

test('la comparaison de stage ignore la casse', () => {
  assert.equal(matchesConditions(CRM_TRIGGER, { toStage: 'gagné' }), true);
  assert.equal(matchesConditions(CRM_TRIGGER, { toStage: 'GAGNÉ' }), true);
});

test('un declencheur de stage SANS stage cible ne matche rien, jamais tout', () => {
  // Le piege a eviter : une condition vide interpretee comme « tous les
  // stages » ferait partir le declencheur a chaque mouvement de pipeline.
  const naked = { ...CRM_TRIGGER, conditions: {} };
  assert.equal(matchesConditions(naked, { toStage: 'Gagné' }), false);
  assert.equal(matchesConditions(naked, {}), false);
});

test('un prospect de campagne n est pas inscrit par un evenement CRM non plus', async () => {
  reset({ opportunity: { id: 'opp-1', user_id: 'u1', email: 'x@y.fr', campaign_id: 'camp-1' } });
  state.crmTriggers = [CRM_TRIGGER];
  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Gagné',
  });

  assert.equal(out.reason, 'no_known_contact');
  assert.equal(state.createdEnrollments.length, 0);
});

test('deux declencheurs sur le meme evenement : seul celui qui matche part', async () => {
  reset();
  state.crmTriggers = [
    { ...CRM_TRIGGER, id: 'trig-a', conditions: { toStages: ['Négociation'] } },
    { ...CRM_TRIGGER, id: 'trig-b', conditions: { toStages: ['Gagné'] } },
  ];
  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Gagné',
  });

  assert.equal(out.ok, true);
  assert.equal(state.createdEnrollments.length, 1);
  assert.equal(state.createdEnrollments[0].triggerId, 'trig-b');
});

test('aucun declencheur CRM arme : rien ne se passe', async () => {
  reset();
  state.crmTriggers = [];
  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Gagné',
  });
  assert.equal(out.reason, 'no_trigger');
  assert.equal(state.createdEnrollments.length, 0);
});

test('un evenement CRM ne leve jamais, meme si la base tombe', async () => {
  // Une automatisation qui echoue ne doit jamais casser la synchro CRM qui
  // l a produite : trackStage appelle ceci en plein milieu d un import.
  reset();
  Object.defineProperty(state, 'crmTriggers', {
    get() { throw new Error('base indisponible'); },
    configurable: true,
  });

  const out = await onCrmEvent({
    userId: 'u1', opportunityId: 'opp-1', eventKey: 'deal_stage_changed', toStage: 'Gagné',
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'error');
  delete state.crmTriggers;
});
