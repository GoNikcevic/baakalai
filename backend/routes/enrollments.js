/**
 * Enrollments — workflows de relance CRM (migration 103).
 *
 * Un enrollment inscrit UN contact CRM (campaign_id IS NULL — frontière
 * lib/crm-scope) dans UN workflow multicanal sur mesure : brouillon proposé
 * (par l'agent en phase 2, par l'API ici), approuvé explicitement par
 * l'utilisateur, puis exécuté par lib/native-sequence-engine avec les mêmes
 * caps que les campagnes natives. Rien ne part sans approbation.
 *
 * Cycle de vie : draft → active → completed | stopped (paused réversible).
 * L'édition de séquence n'est permise qu'en draft — après approbation, le
 * journal d'envoi fait foi et on ne réécrit pas un workflow en vol (phase 2 :
 * réconciliation comme PUT /campaigns/:id/sequence).
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const logger = require('../lib/logger');
const { isCrmContact } = require('../lib/crm-scope');

const GOALS = ['reactivation', 'upsell', 'churn_prevention'];

async function getOwned(req, res) {
  const enrollment = await db.sequenceEnrollments.get(req.params.id);
  if (!enrollment) {
    res.status(404).json({ error: 'Enrollment not found' });
    return null;
  }
  if (enrollment.user_id !== req.user.id) {
    res.status(403).json({ error: 'Access denied' });
    return null;
  }
  return enrollment;
}

function buildTree(steps) {
  const roots = steps.filter(t => !t.parent_step_id);
  const attach = (node) => {
    node.children = steps.filter(t => t.parent_step_id === node.id);
    node.children.forEach(attach);
    return node;
  };
  return roots.map(attach);
}

// Crée les touchpoints d'un enrollment à partir d'un arbre { ...step, children: [] }.
async function createSteps(enrollmentId, steps) {
  let sortCounter = 0;
  const createNode = async (tp, parentBackendId = null, isRoot = true) => {
    const created = await db.touchpoints.create(null, {
      ...tp,
      enrollmentId,
      sortOrder: sortCounter++,
      parentStepId: parentBackendId,
      isRoot,
    });
    for (const child of (Array.isArray(tp.children) ? tp.children : [])) {
      await createNode(child, created.id, false);
    }
  };
  for (const tp of steps) {
    await createNode(tp, null, true);
  }
}

// GET /api/enrollments?status=&opportunityId= — avec progression (étape x/n)
// pour les badges de la file de relance.
router.get('/', async (req, res, next) => {
  try {
    const { status, opportunityId } = req.query;
    const enrollments = await db.sequenceEnrollments.listByUser(req.user.id, { status, opportunityId });

    if (enrollments.length > 0) {
      const ids = enrollments.map(e => e.id);
      const [totals, consumed] = await Promise.all([
        db.query(
          `SELECT enrollment_id, COUNT(*) AS n FROM touchpoints
           WHERE enrollment_id = ANY($1) GROUP BY enrollment_id`,
          [ids]
        ),
        db.query(
          `SELECT enrollment_id, COUNT(*) AS n FROM campaign_sends
           WHERE enrollment_id = ANY($1) AND touchpoint_id IS NOT NULL
             AND status IN ('sent', 'skipped')
           GROUP BY enrollment_id`,
          [ids]
        ),
      ]);
      const totalById = new Map(totals.rows.map(r => [r.enrollment_id, parseInt(r.n, 10)]));
      const doneById = new Map(consumed.rows.map(r => [r.enrollment_id, parseInt(r.n, 10)]));
      for (const e of enrollments) {
        e.total_steps = totalById.get(e.id) || 0;
        e.done_steps = doneById.get(e.id) || 0;
      }
    }

    res.json({ enrollments });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/propose — le Deal Coach conçoit un workflow de
// relance pour un deal et le dépose en BROUILLON (aucun envoi sans
// approbation). 409 avec l'enrollment existant si un workflow est déjà vivant.
router.post('/propose', async (req, res, next) => {
  try {
    const { opportunityId, goal } = req.body || {};
    if (!opportunityId || !GOALS.includes(goal)) {
      return res.status(400).json({ error: `opportunityId et goal (${GOALS.join('|')}) sont requis` });
    }

    const opportunity = await db.opportunities.get(opportunityId);
    if (!opportunity || opportunity.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    if (!isCrmContact(opportunity)) {
      return res.status(400).json({ code: 'not_crm_contact', error: 'Ce contact appartient à une campagne de prospection — sa séquence de campagne est son seul canal.' });
    }

    const existing = await db.sequenceEnrollments.listByUser(req.user.id, { opportunityId });
    const live = existing.find(e => ['draft', 'active', 'paused'].includes(e.status));
    if (live) {
      return res.status(409).json({ code: 'already_enrolled', enrollment: live });
    }

    const dealCoach = require('../lib/agents/deal-coach');
    const plan = await dealCoach.proposeWorkflow(req.user.id, opportunityId, goal);
    if (plan.error) {
      const httpCode = plan.error === 'not_found' ? 404 : 400;
      return res.status(httpCode).json({ code: plan.error, error: plan.error });
    }

    let enrollment;
    try {
      enrollment = await db.sequenceEnrollments.create({
        userId: req.user.id,
        opportunityId,
        goal,
        rationale: plan.reason,
        createdBy: 'agent',
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ code: 'already_enrolled', error: 'Un workflow est déjà en cours pour ce contact.' });
      }
      throw err;
    }

    await createSteps(enrollment.id, plan.steps);
    const created = await db.touchpoints.listByEnrollment(enrollment.id);

    logger.info('enrollments', `Proposed ${enrollment.id} (${goal}, ${plan.urgency}) — ${created.length} steps for ${opportunity.name || opportunityId}`);
    res.status(201).json({ enrollment, sequence: buildTree(created), contact: opportunity, urgency: plan.urgency });
  } catch (err) {
    next(err);
  }
});

// GET /api/enrollments/:id — enrollment + séquence (arbre) + journal d'envoi.
router.get('/:id', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;

    const [steps, sends, prospect] = await Promise.all([
      db.touchpoints.listByEnrollment(enrollment.id),
      db.query(
        `SELECT touchpoint_id, channel, status, sent_at, error FROM campaign_sends
         WHERE enrollment_id = $1 ORDER BY sent_at`,
        [enrollment.id]
      ).then(r => r.rows),
      db.opportunities.get(enrollment.opportunity_id),
    ]);

    res.json({ enrollment, sequence: buildTree(steps), sends, contact: prospect });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments — crée un brouillon de workflow pour un contact CRM.
// Body : { opportunityId, goal, rationale?, steps: [{ step, type, timing,
// subject?, body?, conditionType?, branchLabel?, children? }] }
router.post('/', async (req, res, next) => {
  try {
    const { opportunityId, goal, rationale, steps } = req.body || {};
    if (!opportunityId || !GOALS.includes(goal)) {
      return res.status(400).json({ error: `opportunityId et goal (${GOALS.join('|')}) sont requis` });
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps: au moins une étape est requise' });
    }

    const opportunity = await db.opportunities.get(opportunityId);
    if (!opportunity || opportunity.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    // Frontière crm-scope : un prospect froid de campagne a déjà sa séquence —
    // les workflows de relance sont réservés aux contacts CRM.
    if (!isCrmContact(opportunity)) {
      return res.status(400).json({ code: 'not_crm_contact', error: 'Ce contact appartient à une campagne de prospection — sa séquence de campagne est son seul canal.' });
    }

    let enrollment;
    try {
      enrollment = await db.sequenceEnrollments.create({
        userId: req.user.id,
        opportunityId,
        goal,
        rationale,
        createdBy: req.body.createdBy === 'user' ? 'user' : 'agent',
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ code: 'already_enrolled', error: 'Un workflow est déjà en cours pour ce contact. Arrêtez-le avant d\'en proposer un autre.' });
      }
      throw err;
    }

    await createSteps(enrollment.id, steps);
    const created = await db.touchpoints.listByEnrollment(enrollment.id);

    logger.info('enrollments', `Draft ${enrollment.id} (${goal}) — ${created.length} steps for opportunity ${opportunityId}`);
    res.status(201).json({ enrollment, sequence: buildTree(created) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/enrollments/:id/sequence — édite la séquence d'un workflow.
// Brouillon comme workflow actif/en pause : réconciliation partagée
// (lib/sequence-reconcile) — les steps existants (id présent) sont mis à
// jour en place, le journal d'envoi survit, les prospects gardent leur
// position. Un workflow terminé/arrêté ne s'édite plus.
router.put('/:id/sequence', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;
    if (!['draft', 'active', 'paused'].includes(enrollment.status)) {
      return res.status(400).json({ code: 'not_editable', error: 'Ce workflow est terminé, sa séquence ne s\'édite plus.' });
    }
    const steps = req.body.steps || req.body.sequence || [];
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps: au moins une étape est requise' });
    }

    const { reconcileSequence } = require('../lib/sequence-reconcile');
    const existing = await db.touchpoints.listByEnrollment(enrollment.id);
    await reconcileSequence(steps, existing, { enrollmentId: enrollment.id });
    const updated = await db.touchpoints.listByEnrollment(enrollment.id);
    res.json({ sequence: buildTree(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/:id/approve — l'utilisateur valide le workflow.
router.post('/:id/approve', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;
    if (enrollment.status !== 'draft' && enrollment.status !== 'paused') {
      return res.status(400).json({ error: `Impossible d'approuver un workflow ${enrollment.status}` });
    }

    const steps = await db.touchpoints.listByEnrollment(enrollment.id);
    if (steps.length === 0) {
      return res.status(400).json({ code: 'no_sequence', error: 'Aucune étape dans ce workflow.' });
    }

    const updated = await db.sequenceEnrollments.setStatus(enrollment.id, 'active');

    // Premier passage immédiat : l'utilisateur voit la première étape partir
    // sans attendre le cron horaire.
    const engine = require('../lib/native-sequence-engine');
    const report = await engine.runForUser(req.user.id, { enrollmentId: enrollment.id });

    res.json({ success: true, enrollment: updated, firstRun: report });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/:id/pause
router.post('/:id/pause', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;
    if (enrollment.status !== 'active') {
      return res.status(400).json({ error: 'Seul un workflow actif peut être mis en pause' });
    }
    const updated = await db.sequenceEnrollments.setStatus(enrollment.id, 'paused');
    res.json({ success: true, enrollment: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/:id/stop — arrêt manuel définitif.
router.post('/:id/stop', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;
    if (enrollment.status === 'completed' || enrollment.status === 'stopped') {
      return res.status(400).json({ error: 'Ce workflow est déjà terminé' });
    }
    const updated = await db.sequenceEnrollments.setStatus(enrollment.id, 'stopped', { stopReason: 'manual' });
    res.json({ success: true, enrollment: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/enrollments/:id/run — « Traiter maintenant ».
router.post('/:id/run', async (req, res, next) => {
  try {
    const enrollment = await getOwned(req, res);
    if (!enrollment) return;
    if (enrollment.status !== 'active') {
      return res.status(400).json({ error: 'Ce workflow n\'est pas actif' });
    }
    const engine = require('../lib/native-sequence-engine');
    const report = await engine.runForUser(req.user.id, { enrollmentId: enrollment.id });
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
