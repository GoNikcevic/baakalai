/**
 * Automatisation · Déclencheur -> Workflow (migration 114).
 *
 * GET    /api/automations                  · déclencheurs, workflows, état du compte
 * POST   /api/automations                  · promouvoir des types de signaux en déclencheurs
 * PATCH  /api/automations/:id              · armer, mettre en pause, reprendre
 * DELETE /api/automations/:id              · supprimer un déclencheur
 * GET    /api/automations/workflows/:id    · un workflow et ses étapes
 * PUT    /api/automations/workflows/:id    · renommer, remplacer les étapes
 * GET    /api/automations/runs             · contacts actuellement en parcours
 * GET    /api/automations/history          · sorties, avec leur motif
 *
 * La page est 100 % événementielle : tout ce qui vit ici part sur un
 * événement. L'envoi manuel sur une sélection de contacts n'existe pas dans
 * cette zone, il vit sur Clients et Deals. C'est ce qui la distingue.
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');
const catalog = require('../lib/automation-catalog');
const { runBackfill, BREAKER_PER_HOUR } = require('../lib/automation-enroll');

const router = Router();

const MAX_STEPS = 12;

async function hasActiveMailbox(userId) {
  const r = await db.query(
    `SELECT 1 FROM email_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0;
}

async function ownedTrigger(req, res) {
  const trigger = await db.automationTriggers.get(req.params.id);
  if (!trigger || trigger.user_id !== req.user.id) {
    res.status(404).json({ error: 'Trigger not found' });
    return null;
  }
  return trigger;
}

async function ownedWorkflow(req, res) {
  const workflow = await db.workflows.get(req.params.id);
  if (!workflow || workflow.user_id !== req.user.id) {
    res.status(404).json({ error: 'Workflow not found' });
    return null;
  }
  return workflow;
}

/* ═════════════════════ Étapes d'un workflow ═════════════════════ */

/**
 * L'éditeur manipule une liste d'étapes où l'attente est une carte à part
 * entière. En base, l'attente n'est pas une étape : c'est le `timing` de
 * l'étape suivante, exactement comme dans une séquence de campagne. Le moteur
 * n'a donc aucun nouveau type à connaître, et la branche « type inconnu » de
 * db.touchpoints.create n'est jamais atteinte.
 *
 * Une attente en fin de liste ne veut rien dire : elle est ignorée, et
 * l'appelant en est informé pour pouvoir le dire à l'utilisateur.
 */
function stepsToTouchpoints(steps) {
  const out = [];
  const warnings = [];
  let pendingDays = 0;
  let emailIndex = 0;

  for (const s of steps) {
    if (s.type === 'wait') {
      const d = parseInt(s.days, 10);
      if (!Number.isFinite(d) || d < 1) {
        warnings.push('invalid_wait');
        continue;
      }
      pendingDays += d;
      continue;
    }
    if (s.type !== 'email') {
      warnings.push('unsupported_step');
      continue;
    }
    emailIndex++;
    out.push({
      step: `E${emailIndex}`,
      type: 'email',
      timing: `J+${pendingDays}`,
      // La consigne est une règle écrite une fois pour N contacts, pas un
      // email rédigé pour quelqu'un en particulier. Le corps est généré à
      // l'envoi à partir d'elle et de l'historique du contact.
      subject: null,
      body: String(s.consigne || '').trim(),
      sortOrder: out.length,
    });
    pendingDays = 0;
  }

  if (pendingDays > 0) warnings.push('trailing_wait');
  return { touchpoints: out, warnings };
}

/** L'inverse, pour réafficher un workflow dans l'éditeur. */
function touchpointsToSteps(rows) {
  const steps = [];
  for (const tp of rows) {
    const days = parseInt(String(tp.timing || '').match(/J\+?(\d+)/i)?.[1] || '0', 10);
    if (days > 0) steps.push({ type: 'wait', days });
    steps.push({ type: 'email', consigne: tp.body || '' });
  }
  return steps;
}

function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { error: 'Un workflow a besoin d\'au moins une étape.', code: 'no_steps' };
  }
  if (steps.length > MAX_STEPS) {
    return { error: `Un workflow est limité à ${MAX_STEPS} étapes.`, code: 'too_many_steps' };
  }
  const emails = steps.filter(s => s.type === 'email');
  if (emails.length === 0) {
    return { error: 'Un workflow a besoin d\'au moins un email.', code: 'no_email_step' };
  }
  const empty = emails.findIndex(s => !String(s.consigne || '').trim());
  if (empty > -1) {
    return {
      error: `L'étape ${empty + 1} n'a pas de consigne. Complète-la avant d'armer.`,
      code: 'empty_consigne',
    };
  }
  return null;
}

async function replaceWorkflowSteps(workflowId, steps) {
  const { touchpoints, warnings } = stepsToTouchpoints(steps);
  await db.touchpoints.deleteByWorkflow(workflowId);
  for (const tp of touchpoints) {
    await db.touchpoints.create(null, { ...tp, workflowId });
  }
  return { count: touchpoints.length, warnings };
}

/* ═════════════════════ Lecture ═════════════════════ */

router.get('/', async (req, res, next) => {
  try {
    const [triggers, workflows, mailbox, crm, runsCount] = await Promise.all([
      db.automationTriggers.listByUser(req.user.id),
      db.workflows.listByUser(req.user.id),
      hasActiveMailbox(req.user.id),
      // Le grisage du catalogue doit nommer le CRM connecté. Une phrase
      // générale du type « aucun CRM ne sait faire ça » serait fausse : le
      // problème est le branchement, et il diffère selon le connecteur.
      db.query(`SELECT active_crm_provider FROM users WHERE id = $1`, [req.user.id])
        .then(r => r.rows[0]?.active_crm_provider || null),
      db.query(
        `SELECT COUNT(*)::int AS n FROM sequence_enrollments
          WHERE user_id = $1 AND status IN ('draft', 'active', 'paused')`,
        [req.user.id]
      ).then(r => r.rows[0]?.n || 0),
    ]);

    res.json({
      hasMailbox: mailbox,
      activeCrmProvider: crm,
      runsCount,
      breakerPerHour: BREAKER_PER_HOUR,
      triggers: triggers.map(t => ({
        id: t.id,
        label: t.label,
        eventSource: t.event_source,
        eventKey: t.event_key,
        status: t.status,
        pausedReason: t.paused_reason,
        workflowId: t.workflow_id,
        workflowName: t.workflow_name,
        workflowStepCount: parseInt(t.workflow_step_count, 10) || 0,
        entered30d: parseInt(t.entered_30d, 10) || 0,
        enteredTotal: parseInt(t.entered_total, 10) || 0,
        skippedCount: parseInt(t.skipped_count, 10) || 0,
        topSkipReason: t.top_skip_reason,
        armedAt: t.armed_at,
        lastFiredAt: t.last_fired_at,
        context: catalog.contextOf(t.event_source, t.event_key),
      })),
      workflows: workflows.map(w => ({
        id: w.id,
        name: w.name,
        stepCount: parseInt(w.step_count, 10) || 0,
        maxDurationDays: w.max_duration_days,
        reenrollPolicy: w.reenroll_policy,
        reenrollDays: w.reenroll_days,
        triggers: w.triggers || [],
      })),
    });
  } catch (err) { next(err); }
});

router.get('/workflows/:id', async (req, res, next) => {
  try {
    const workflow = await ownedWorkflow(req, res);
    if (!workflow) return;
    const rows = await db.touchpoints.listByWorkflow(workflow.id);
    const triggers = (await db.automationTriggers.listByUser(req.user.id))
      .filter(t => t.workflow_id === workflow.id);
    res.json({
      workflow: {
        id: workflow.id,
        name: workflow.name,
        maxDurationDays: workflow.max_duration_days,
        reenrollPolicy: workflow.reenroll_policy,
        reenrollDays: workflow.reenroll_days,
      },
      steps: touchpointsToSteps(rows),
      triggers: triggers.map(t => ({
        id: t.id,
        label: t.label,
        eventSource: t.event_source,
        eventKey: t.event_key,
        status: t.status,
        context: catalog.contextOf(t.event_source, t.event_key),
      })),
    });
  } catch (err) { next(err); }
});

/** Contacts actuellement engagés, avec l'étape où ils se trouvent. */
router.get('/runs', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT e.id, e.created_at, e.started_at, e.status,
              o.name AS contact_name, o.company AS contact_company,
              w.name AS workflow_name, a.label AS trigger_label,
              (SELECT COUNT(*) FROM touchpoints t WHERE t.enrollment_id = e.id) AS total_steps,
              (SELECT COUNT(DISTINCT cs.touchpoint_id) FROM campaign_sends cs
                WHERE cs.enrollment_id = e.id AND cs.status = 'sent') AS done_steps
         FROM sequence_enrollments e
         LEFT JOIN opportunities o ON o.id = e.opportunity_id
         LEFT JOIN workflows w ON w.id = e.workflow_id
         LEFT JOIN automation_triggers a ON a.id = e.trigger_id
        WHERE e.user_id = $1 AND e.status IN ('draft', 'active', 'paused')
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [req.user.id]
    );
    res.json({
      runs: r.rows.map(row => ({
        id: row.id,
        contactName: row.contact_name,
        contactCompany: row.contact_company,
        workflowName: row.workflow_name,
        triggerLabel: row.trigger_label,
        status: row.status,
        doneSteps: parseInt(row.done_steps, 10) || 0,
        totalSteps: parseInt(row.total_steps, 10) || 0,
        since: row.started_at || row.created_at,
      })),
    });
  } catch (err) { next(err); }
});

/**
 * L'Historique. Le motif de sortie est son unité : sans lui, ce serait une
 * liste de « terminé » qui n'apprend rien, et les statistiques des workflows
 * n'auraient rien à afficher.
 */
router.get('/history', async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 3650);
    const r = await db.query(
      `SELECT e.id, e.created_at, e.completed_at, e.stopped_at, e.status, e.stop_reason,
              o.name AS contact_name, o.company AS contact_company,
              w.name AS workflow_name, a.label AS trigger_label
         FROM sequence_enrollments e
         LEFT JOIN opportunities o ON o.id = e.opportunity_id
         LEFT JOIN workflows w ON w.id = e.workflow_id
         LEFT JOIN automation_triggers a ON a.id = e.trigger_id
        WHERE e.user_id = $1
          AND e.status IN ('completed', 'stopped')
          AND COALESCE(e.stopped_at, e.completed_at) > now() - make_interval(days => $2::int)
        ORDER BY COALESCE(e.stopped_at, e.completed_at) DESC
        LIMIT 500`,
      [req.user.id, days]
    );
    res.json({
      exits: r.rows.map(row => ({
        id: row.id,
        contactName: row.contact_name,
        contactCompany: row.contact_company,
        workflowName: row.workflow_name,
        triggerLabel: row.trigger_label,
        enteredAt: row.created_at,
        exitedAt: row.stopped_at || row.completed_at,
        // `completed` sans motif = le workflow est allé jusqu'au bout sans
        // qu'aucune sortie ne tombe. C'est un motif à part entière, pas un
        // trou : « terminé, aucune réponse ».
        reason: row.stop_reason || (row.status === 'completed' ? 'completed_no_reply' : null),
      })),
    });
  } catch (err) { next(err); }
});

/* ═════════════════════ Promotion ═════════════════════ */

/**
 * POST /api/automations · le geste « Automatiser ».
 *
 * La sélection de types EST la définition du déclencheur : l'utilisateur n'a
 * rien à rédiger. C'est le seul endroit où un déclencheur est créé sans que
 * quelqu'un l'écrive, et c'est légitime parce que le geste le décrit.
 *
 * Deux conséquences distinctes, jamais fusionnées en silence :
 *   - armer le type pour L'AVENIR (tous les prochains signaux)
 *   - inscrire les signaux DÉJÀ LÀ (le rattrapage, explicitement demandé)
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      signalTypes, workflowId, workflowName, steps,
      backfill, arm, reenrollPolicy, reenrollDays, maxDurationDays,
    } = req.body;

    const types = Array.isArray(signalTypes) ? signalTypes.filter(Boolean) : [];
    if (types.length === 0) {
      return res.status(400).json({ error: 'Choisis au moins un type de signal.', code: 'no_types' });
    }
    const unknown = types.filter(t => !catalog.VEILLE_SIGNAL_TYPES.includes(t)
      && !catalog.CRM_SIGNAL_TYPES.includes(t));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Type de signal inconnu : ${unknown[0]}`, code: 'unknown_type' });
    }

    // Workflow : existant ou nouveau. Un workflow existant n'est pas réécrit
    // ici, sinon promouvoir un deuxième type modifierait le parcours du
    // premier sans le dire.
    let workflow;
    if (workflowId) {
      workflow = await db.workflows.get(workflowId);
      if (!workflow || workflow.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      const existing = await db.touchpoints.listByWorkflow(workflow.id);
      if (existing.length === 0) {
        return res.status(400).json({
          error: 'Ce workflow n\'a aucune étape.', code: 'workflow_empty',
        });
      }
    } else {
      const invalid = validateSteps(steps);
      if (invalid) return res.status(400).json(invalid);
      const name = String(workflowName || '').trim();
      if (!name) return res.status(400).json({ error: 'Donne un nom au workflow.', code: 'no_name' });

      workflow = await db.workflows.create({
        userId: req.user.id,
        name,
        maxDurationDays,
        reenrollPolicy,
        reenrollDays,
      });
      await replaceWorkflowSteps(workflow.id, steps);
    }

    // Un déclencheur par type, tous vers le même workflow. C'est le N vers 1
    // du modèle : plusieurs événements peuvent mener au même parcours.
    const status = arm === false ? 'draft' : 'active';
    const created = [];
    for (const signalType of types) {
      const already = await db.query(
        `SELECT id FROM automation_triggers
          WHERE user_id = $1 AND event_source = 'signal' AND event_key = $2 AND status <> 'draft'`,
        [req.user.id, signalType]
      );
      if (already.rows.length > 0) {
        return res.status(409).json({
          error: 'Ce type de signal est déjà automatisé.',
          code: 'already_automated',
          signalType,
          triggerId: already.rows[0].id,
        });
      }
      created.push(await db.automationTriggers.create({
        userId: req.user.id,
        workflowId: workflow.id,
        eventSource: 'signal',
        eventKey: signalType,
        label: signalType,
        status,
      }));
    }

    // Rattrapage, uniquement sur ce qui a été explicitement sélectionné.
    const backfillReport = {};
    if (status === 'active' && backfill && typeof backfill === 'object') {
      for (const trigger of created) {
        const ids = backfill[trigger.event_key];
        if (!Array.isArray(ids) || ids.length === 0) continue;
        backfillReport[trigger.event_key] = await runBackfill(req.user.id, trigger, ids);
      }
    }

    logger.info('automation', `${created.length} declencheur(s) crees vers le workflow ${workflow.id}`);

    res.json({
      workflow: { id: workflow.id, name: workflow.name },
      triggers: created.map(t => ({ id: t.id, eventKey: t.event_key, status: t.status })),
      backfill: backfillReport,
      hasMailbox: await hasActiveMailbox(req.user.id),
    });
  } catch (err) { next(err); }
});

/* ═════════════════════ Cycle de vie ═════════════════════ */

router.patch('/:id', async (req, res, next) => {
  try {
    const trigger = await ownedTrigger(req, res);
    if (!trigger) return;

    const { status } = req.body;
    if (!['active', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or paused' });
    }

    // Relancer un déclencheur que le disjoncteur a arrêté est une décision, pas
    // un basculement. On ne reprend jamais tout seul : si la cause n'a pas été
    // comprise, une reprise automatique rejoue exactement la même avalanche.
    if (trigger.status === 'breaker' && status === 'active' && req.body.confirmBreaker !== true) {
      return res.status(409).json({
        error: 'Ce déclencheur a été arrêté par sécurité. Vérifie les contacts concernés avant de le relancer.',
        code: 'breaker_confirm_required',
        pausedReason: trigger.paused_reason,
      });
    }

    if (status === 'active') {
      const stepCount = (await db.touchpoints.listByWorkflow(trigger.workflow_id)).length;
      if (stepCount === 0) {
        return res.status(400).json({
          error: 'Le workflow visé n\'a aucune étape.', code: 'workflow_empty',
        });
      }
    }

    const updated = await db.automationTriggers.setStatus(trigger.id, status);
    res.json({ trigger: { id: updated.id, status: updated.status } });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const trigger = await ownedTrigger(req, res);
    if (!trigger) return;
    // Les contacts en cours poursuivent leur workflow : leurs étapes ont été
    // copiées à l'inscription, supprimer le déclencheur ne les interrompt pas.
    await db.automationTriggers.remove(trigger.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/workflows/:id', async (req, res, next) => {
  try {
    const workflow = await ownedWorkflow(req, res);
    if (!workflow) return;

    const { name, steps, reenrollPolicy, reenrollDays, maxDurationDays } = req.body;

    if (steps !== undefined) {
      const invalid = validateSteps(steps);
      if (invalid) return res.status(400).json(invalid);
    }

    if (name !== undefined || reenrollPolicy !== undefined
        || reenrollDays !== undefined || maxDurationDays !== undefined) {
      await db.workflows.update(workflow.id, {
        name: name !== undefined ? String(name).trim() : undefined,
        reenrollPolicy, reenrollDays, maxDurationDays,
      });
    }

    let result = null;
    if (steps !== undefined) {
      // Réécrire le modèle ne touche à aucun parcours en vol : les contacts
      // déjà inscrits travaillent sur leur copie.
      result = await replaceWorkflowSteps(workflow.id, steps);
    }

    res.json({ ok: true, stepCount: result ? result.count : undefined, warnings: result ? result.warnings : [] });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.stepsToTouchpoints = stepsToTouchpoints;
module.exports.touchpointsToSteps = touchpointsToSteps;
