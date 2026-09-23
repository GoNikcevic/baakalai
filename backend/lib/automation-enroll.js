/**
 * Automatisation · inscrire un contact dans un workflow depuis un événement.
 *
 * Le chemin complet : un signal est inséré -> un déclencheur armé existe sur
 * son type -> le contact du signal est retrouvé DANS LA BASE -> ses étapes
 * sont copiées depuis le modèle -> l'enrollment part, et le signal quitte
 * `new`.
 *
 * Quatre règles qui ne sont pas des détails.
 *
 * 1. AUCUN CONTACT N'EST CRÉÉ ICI. Un signal de veille externe pointe souvent
 *    une société absente de la base. Créer l'opportunité tomberait dans la
 *    population CRM (campaign_id IS NULL, voir lib/crm-scope) et rendrait un
 *    inconnu éligible aux relances « suite à nos échanges ». Le signal est
 *    alors marqué `skipped` avec la raison `no_known_contact`, ce qui est la
 *    cause la plus fréquente d'un déclencheur muet, et l'interface doit
 *    pouvoir la nommer au lieu d'inventer une explication.
 *
 * 2. LES ÉTAPES SONT COPIÉES, jamais référencées. Le contact garde la version
 *    reçue à son entrée : un workflow modifié en cours de route ne réécrit
 *    rien, et campaign_sends.UNIQUE(opportunity_id, touchpoint_id) tient.
 *
 * 3. LE DISJONCTEUR NE COMPTE QUE LES ÉVÉNEMENTS. Un rattrapage inscrit
 *    volontairement des dizaines de contacts d'un coup ; comptés ensemble, la
 *    toute première automatisation se mettrait en pause de sécurité dans la
 *    minute. Le scénario réel le plus probable n'est d'ailleurs pas la boucle,
 *    c'est une resynchro qui fait paraître des milliers de fiches modifiées.
 *
 * 4. LES CAUSES TRANSITOIRES NE CONSOMMENT PAS LE SIGNAL. Pas de boîte mail,
 *    disjoncteur ouvert : le signal reste `new` et sera repris. Les causes
 *    définitives pour ce signal le marquent `skipped`, sinon le backlog ne
 *    bouge jamais.
 */

const db = require('../db');
const logger = require('./logger');

// Plafond d'inscriptions par déclencheur et par heure, événements seulement.
// Fixe : personne ne devrait avoir à régler un garde-fou. Relance manuelle
// uniquement, jamais de reprise automatique : si la cause n'a pas été
// comprise, une reprise automatique rejoue la catastrophe.
const BREAKER_PER_HOUR = 25;

/** Causes qui laissent le signal réutilisable (il repassera). */
const TRANSIENT = new Set(['no_mailbox', 'breaker_open']);

async function hasActiveMailbox(userId) {
  const r = await db.query(
    `SELECT 1 FROM email_accounts WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId]
  );
  return r.rows.length > 0;
}

/**
 * Le contact visé par un signal, s'il existe déjà.
 *
 * Jamais de création : voir la règle 1 en tête de fichier. Et jamais un
 * prospect de campagne non plus : `opportunities` mélange deux populations
 * (lib/crm-scope), et `findByEmail` ne fait pas la différence. Un prospect
 * froid est déjà engagé dans la séquence de la campagne qui l'a fait entrer ;
 * l'inscrire ici lui vaudrait un deuxième fil d'emails en parallèle, écrit
 * pour un client avec qui on a un historique. C'est exactement la frontière
 * que crm-scope a été écrit pour tenir.
 */
async function resolveContact(signal) {
  const { isCrmContact } = require('./crm-scope');

  if (signal.opportunity_id) {
    const opp = await db.opportunities.get(signal.opportunity_id);
    if (opp) return isCrmContact(opp) ? { opp } : { skip: 'no_known_contact' };
  }
  if (!signal.contact_email) return { skip: 'no_known_contact' };

  const opp = await db.opportunities.findByEmail(signal.user_id, signal.contact_email);
  if (!opp || !isCrmContact(opp)) return { skip: 'no_known_contact' };
  return { opp };
}

/**
 * Clé d'idempotence, portée par le WORKFLOW et non par le couple : un contact
 * déjà passé par « Prise de contact » via Recrutement n'y entre pas une
 * seconde fois via Levée de fonds. `null` = politique « à chaque fois ».
 */
function dedupKeyFor(workflow, opportunityId) {
  if (workflow.reenroll_policy !== 'never') return null;
  return `wf:${workflow.id}:opp:${opportunityId}`;
}

async function enrolledRecently(workflowId, opportunityId, days) {
  const r = await db.query(
    `SELECT 1 FROM sequence_enrollments
      WHERE workflow_id = $1 AND opportunity_id = $2
        AND created_at > now() - make_interval(days => $3::int)
      LIMIT 1`,
    [workflowId, opportunityId, days]
  );
  return r.rows.length > 0;
}

/** Le contact est-il déjà engagé dans un parcours, quel qu'il soit. */
async function hasLiveEnrollment(opportunityId) {
  const r = await db.query(
    `SELECT 1 FROM sequence_enrollments
      WHERE opportunity_id = $1 AND status IN ('draft', 'active', 'paused') LIMIT 1`,
    [opportunityId]
  );
  return r.rows.length > 0;
}

/**
 * Copie les étapes du modèle dans l'enrollment.
 * Le branchement est linéaire au lot 1 : pas de parent_step_id, pas d'arbre.
 */
async function copySteps(workflowId, enrollmentId) {
  const steps = await db.touchpoints.listByWorkflow(workflowId);
  let sortOrder = 0;
  for (const s of steps) {
    await db.touchpoints.create(null, {
      enrollmentId,
      step: s.step,
      type: s.type,
      label: s.label,
      subType: s.sub_type,
      timing: s.timing,
      subject: s.subject,
      body: s.body,
      maxChars: s.max_chars,
      sortOrder: sortOrder++,
      isRoot: true,
    });
  }
  return steps.length;
}

async function markSignal(signalId, patch) {
  const { status, triggerId, enrollmentId, skipReason } = patch;
  await db.query(
    `UPDATE signals
        SET status = $1,
            automation_trigger_id = COALESCE($2, automation_trigger_id),
            enrollment_id = COALESCE($3, enrollment_id),
            automation_skip_reason = $4,
            actioned_at = CASE WHEN $1 = 'automated' THEN now() ELSE actioned_at END
      WHERE id = $5`,
    [status, triggerId || null, enrollmentId || null, skipReason || null, signalId]
  );
}

/**
 * Inscrit le contact d'un signal dans le workflow de son déclencheur.
 *
 * @param {object} signal  ligne complète de `signals`
 * @param {object} opts    { source: 'event' | 'backfill', trigger, workflow }
 * @returns {Promise<{ ok: boolean, reason?: string, enrollmentId?: string }>}
 */
async function enrollFromSignal(signal, opts = {}) {
  const source = opts.source === 'backfill' ? 'backfill' : 'event';

  const trigger = opts.trigger
    || await db.automationTriggers.findActive(signal.user_id, 'signal', signal.signal_type);
  if (!trigger) return { ok: false, reason: 'no_trigger' };

  const workflow = opts.workflow || await db.workflows.get(trigger.workflow_id);
  if (!workflow || workflow.archived_at) return { ok: false, reason: 'no_workflow' };

  // Un workflow sans étape n'inscrit personne : il enverrait le contact dans
  // une file vide, et l'enrollment se terminerait aussitôt en `completed`,
  // ce qui ressemblerait à un parcours réussi.
  const stepCount = (await db.touchpoints.listByWorkflow(workflow.id)).length;
  if (stepCount === 0) return { ok: false, reason: 'workflow_empty' };

  if (!await hasActiveMailbox(signal.user_id)) {
    return { ok: false, reason: 'no_mailbox' };
  }

  // Disjoncteur, avant toute écriture. Seul le flux événementiel est compté.
  if (source === 'event') {
    const recent = await db.automationTriggers.recentEventEnrollments(trigger.id, 60);
    if (recent >= BREAKER_PER_HOUR) {
      await db.automationTriggers.setStatus(trigger.id, 'breaker', {
        pausedReason: `${recent} inscriptions en une heure, seuil ${BREAKER_PER_HOUR}`,
      });
      logger.warn('automation', `Disjoncteur ouvert sur le declencheur ${trigger.id} (${recent}/h)`);
      return { ok: false, reason: 'breaker_open' };
    }
  }

  const { opp, skip } = await resolveContact(signal);
  if (skip) {
    await markSignal(signal.id, { status: 'skipped', triggerId: trigger.id, skipReason: skip });
    return { ok: false, reason: skip };
  }
  if (!opp.email) {
    await markSignal(signal.id, { status: 'skipped', triggerId: trigger.id, skipReason: 'no_email' });
    return { ok: false, reason: 'no_email' };
  }

  // Réinscription. `never` s'appuie sur l'index unique (course possible entre
  // deux passages de cron), `period` sur une lecture.
  if (workflow.reenroll_policy === 'period'
      && await enrolledRecently(workflow.id, opp.id, workflow.reenroll_days)) {
    await markSignal(signal.id, {
      status: 'skipped', triggerId: trigger.id, skipReason: 'recently_enrolled',
    });
    return { ok: false, reason: 'recently_enrolled' };
  }

  // Sortie de sécurité « contact déjà inscrit dans un autre workflow ». Elle
  // existait déjà comme index unique partiel (migration 103) : on la lit avant
  // d'écrire pour pouvoir en donner la raison, au lieu de la subir en 23505.
  if (await hasLiveEnrollment(opp.id)) {
    await markSignal(signal.id, {
      status: 'skipped', triggerId: trigger.id, skipReason: 'contact_in_other_workflow',
    });
    return { ok: false, reason: 'contact_in_other_workflow' };
  }

  let enrollment;
  try {
    enrollment = await db.sequenceEnrollments.create({
      userId: signal.user_id,
      opportunityId: opp.id,
      goal: 'automation',
      rationale: signal.title || null,
      createdBy: 'trigger',
      triggerId: trigger.id,
      workflowId: workflow.id,
      signalId: signal.id,
      enrollmentSource: source,
      dedupKey: dedupKeyFor(workflow, opp.id),
      status: 'active',
    });
  } catch (err) {
    // 23505 = l'un des deux index uniques a parlé (dédup de réinscription, ou
    // un parcours vivant créé entre notre lecture et notre écriture).
    if (err.code === '23505') {
      await markSignal(signal.id, {
        status: 'skipped', triggerId: trigger.id, skipReason: 'recently_enrolled',
      });
      return { ok: false, reason: 'recently_enrolled' };
    }
    throw err;
  }

  await copySteps(workflow.id, enrollment.id);
  await markSignal(signal.id, {
    status: 'automated', triggerId: trigger.id, enrollmentId: enrollment.id,
  });
  await db.automationTriggers.markFired(trigger.id);

  return { ok: true, enrollmentId: enrollment.id, opportunityId: opp.id };
}

/**
 * Appelé juste après l'insertion d'un signal. Ne lève jamais : un échec
 * d'automatisation ne doit pas faire échouer la détection qui l'a produit.
 */
async function onSignalCreated(signal) {
  try {
    const result = await enrollFromSignal(signal, { source: 'event' });
    if (!result.ok && result.reason && !TRANSIENT.has(result.reason)
        && result.reason !== 'no_trigger' && result.reason !== 'no_workflow'
        && result.reason !== 'workflow_empty') {
      logger.info('automation', `Signal ${signal.id} non inscrit : ${result.reason}`);
    }
    return result;
  } catch (err) {
    logger.warn('automation', `Inscription depuis le signal ${signal.id} : ${err.message}`);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Rattrapage du stock au moment de la promotion d'un type.
 *
 * Il n'est pas un confort : un déclencheur événementiel se déclenche à
 * l'insertion, donc il ne verra JAMAIS les lignes déjà présentes. Sans lui, un
 * backlog de 320 signaux reste à 320 pour toujours, même une fois la feature
 * parfaite.
 */
async function runBackfill(userId, trigger, signalIds) {
  const workflow = await db.workflows.get(trigger.workflow_id);
  const report = { enrolled: 0, skipped: 0, reasons: {} };
  if (!workflow || !Array.isArray(signalIds) || signalIds.length === 0) return report;

  const r = await db.query(
    `SELECT * FROM signals
      WHERE user_id = $1 AND id = ANY($2::uuid[]) AND signal_type = $3
        AND status IN ('new', 'skipped')
      ORDER BY detected_at DESC`,
    [userId, signalIds, trigger.event_key]
  );

  for (const signal of r.rows) {
    const out = await enrollFromSignal(signal, { source: 'backfill', trigger, workflow });
    if (out.ok) {
      report.enrolled++;
    } else {
      report.skipped++;
      report.reasons[out.reason] = (report.reasons[out.reason] || 0) + 1;
      // Le disjoncteur ne compte pas le rattrapage, mais s'il est déjà ouvert
      // au moment où on lance, inutile de parcourir 124 lignes pour rien.
      if (out.reason === 'breaker_open' || out.reason === 'no_mailbox') break;
    }
  }

  return report;
}

module.exports = {
  BREAKER_PER_HOUR,
  enrollFromSignal,
  onSignalCreated,
  runBackfill,
  // exportés pour les tests
  resolveContact,
  dedupKeyFor,
  copySteps,
};
