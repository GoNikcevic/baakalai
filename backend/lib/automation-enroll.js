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
 * Le coeur commun : un déclencheur, un contact, un enrollment.
 *
 * L'ORDRE des vérifications est significatif et ne doit pas bouger. Le contact
 * n'est résolu qu'APRÈS la boîte mail et le disjoncteur : une cause transitoire
 * ne doit pas consommer l'événement qui l'a portée, alors qu'une cause
 * définitive doit pouvoir être écrite sur lui.
 *
 * `resolve()` rend { opp } ou { skip } : c'est le seul point qui diffère entre
 * un signal (contact déduit du signal) et un événement CRM (contact déjà
 * connu, c'est lui qui a bougé).
 */
async function runEnrollment({ userId, trigger, workflow, source, resolve, rationale, signalId }) {
  const wf = workflow || await db.workflows.get(trigger.workflow_id);
  if (!wf || wf.archived_at) return { ok: false, reason: 'no_workflow' };

  // Un workflow sans étape n'inscrit personne : il enverrait le contact dans
  // une file vide, et l'enrollment se terminerait aussitôt en `completed`,
  // ce qui ressemblerait à un parcours réussi.
  const stepCount = (await db.touchpoints.listByWorkflow(wf.id)).length;
  if (stepCount === 0) return { ok: false, reason: 'workflow_empty' };

  if (!await hasActiveMailbox(userId)) return { ok: false, reason: 'no_mailbox' };

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

  const { opp, skip } = await resolve();
  if (skip) return { ok: false, reason: skip, consumed: true };
  if (!opp.email) return { ok: false, reason: 'no_email', consumed: true };

  // Réinscription. `never` s'appuie sur l'index unique (course possible entre
  // deux passages de cron), `period` sur une lecture.
  if (wf.reenroll_policy === 'period'
      && await enrolledRecently(wf.id, opp.id, wf.reenroll_days)) {
    return { ok: false, reason: 'recently_enrolled', consumed: true };
  }

  // Sortie de sécurité « contact déjà inscrit dans un autre workflow ». Elle
  // existait déjà comme index unique partiel (migration 103) : on la lit avant
  // d'écrire pour pouvoir en donner la raison, au lieu de la subir en 23505.
  if (await hasLiveEnrollment(opp.id)) {
    return { ok: false, reason: 'contact_in_other_workflow', consumed: true };
  }

  let enrollment;
  try {
    enrollment = await db.sequenceEnrollments.create({
      userId,
      opportunityId: opp.id,
      goal: 'automation',
      rationale: rationale || null,
      createdBy: 'trigger',
      triggerId: trigger.id,
      workflowId: wf.id,
      signalId: signalId || null,
      enrollmentSource: source,
      dedupKey: dedupKeyFor(wf, opp.id),
      status: 'active',
    });
  } catch (err) {
    // 23505 = l'un des deux index uniques a parlé (dédup de réinscription, ou
    // un parcours vivant créé entre notre lecture et notre écriture).
    if (err.code === '23505') return { ok: false, reason: 'recently_enrolled', consumed: true };
    throw err;
  }

  await copySteps(wf.id, enrollment.id);
  await db.automationTriggers.markFired(trigger.id);

  return { ok: true, enrollmentId: enrollment.id, opportunityId: opp.id };
}

/**
 * La condition d'entrée d'un événement CRM.
 *
 * Pour `deal_stage_changed` elle est OBLIGATOIRE : sans stage cible, le
 * déclencheur inscrirait un contact à chaque mouvement de pipeline, dans les
 * deux sens, y compris quand un commercial corrige une faute de saisie. Un
 * déclencheur sans condition ne matche donc rien, plutôt que tout.
 */
function matchesConditions(trigger, { toStage } = {}) {
  const c = trigger.conditions || {};
  if (trigger.event_key === 'deal_stage_changed') {
    const wanted = Array.isArray(c.toStages) ? c.toStages : [];
    if (wanted.length === 0 || !toStage) return false;
    return wanted.some(w => String(w).toLowerCase() === String(toStage).toLowerCase());
  }
  return true;
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

  const out = await runEnrollment({
    userId: signal.user_id,
    trigger,
    workflow: opts.workflow,
    source,
    rationale: signal.title,
    signalId: signal.id,
    resolve: () => resolveContact(signal),
  });

  if (out.ok) {
    await markSignal(signal.id, {
      status: 'automated', triggerId: trigger.id, enrollmentId: out.enrollmentId,
    });
  } else if (out.consumed) {
    // Cause définitive pour CE signal : il quitte `new` avec sa raison, sinon
    // le backlog ne bouge jamais et un déclencheur muet reste inexplicable.
    await markSignal(signal.id, {
      status: 'skipped', triggerId: trigger.id, skipReason: out.reason,
    });
  }

  return out;
}

/**
 * Un événement CRM : le contact est déjà connu, c'est lui qui a bougé.
 *
 * Plusieurs déclencheurs peuvent viser le même événement avec des conditions
 * différentes (« passé à Gagné » et « passé à Négociation » sont deux
 * automatisations légitimes), donc on les évalue tous.
 *
 * Ne lève jamais : une automatisation qui échoue ne doit pas faire échouer la
 * synchro CRM qui l'a produite.
 */
async function onCrmEvent({ userId, opportunityId, eventKey, toStage }) {
  try {
    const r = await db.query(
      `SELECT * FROM automation_triggers
        WHERE user_id = $1 AND event_source = 'crm_event' AND event_key = $2 AND status = 'active'`,
      [userId, eventKey]
    );
    if (r.rows.length === 0) return { ok: false, reason: 'no_trigger' };

    const results = [];
    for (const trigger of r.rows) {
      if (!matchesConditions(trigger, { toStage })) continue;

      const out = await runEnrollment({
        userId,
        trigger,
        source: 'event',
        rationale: toStage ? `Stage ${toStage}` : null,
        resolve: async () => {
          const { isCrmContact } = require('./crm-scope');
          const opp = await db.opportunities.get(opportunityId);
          if (!opp || !isCrmContact(opp)) return { skip: 'no_known_contact' };
          return { opp };
        },
      });
      results.push(out);
      // Un contact n'entre que dans un workflow à la fois : inutile de le
      // présenter aux déclencheurs suivants une fois qu'il est inscrit.
      if (out.ok) break;
    }

    return results.find(x => x.ok) || results[0] || { ok: false, reason: 'no_match' };
  } catch (err) {
    logger.warn('automation', `Evenement CRM ${eventKey} non traite : ${err.message}`);
    return { ok: false, reason: 'error' };
  }
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
 * Les déclencheurs d'ÉTAT, évalués périodiquement.
 *
 * Différence de nature avec un signal ou un changement de stage : un état
 * reste VRAI tous les jours. « Ce lead est stagnant depuis 30 jours » le sera
 * encore demain. Rien ici n'essaie de deviner si c'est « nouveau » : c'est la
 * politique de réinscription du workflow qui empêche de reprendre le même
 * contact, et l'index d'un seul parcours vivant par contact qui ferme la
 * porte. Chercher à détecter la transition en plus serait un troisième
 * mécanisme de dédup, donc un troisième endroit où se tromper.
 *
 * Le plafond par passage existe pour une raison précise : le premier
 * armement d'un déclencheur « contact inactif depuis 60 jours » peut
 * correspondre à toute la base d'un coup. Le disjoncteur le verrait, mais
 * après coup. Mieux vaut étaler.
 */
async function runStateTriggers(userId, { perTriggerLimit = 25 } = {}) {
  const state = require('./automation-state-triggers');
  const report = { evaluated: 0, enrolled: 0, skipped: 0, reasons: {} };

  const r = await db.query(
    `SELECT * FROM automation_triggers
      WHERE user_id = $1 AND event_source = 'crm_state' AND status = 'active'`,
    [userId]
  );

  for (const trigger of r.rows) {
    if (!state.isStateKey(trigger.event_key)) continue;
    report.evaluated++;

    let contacts;
    try {
      contacts = await state.listMatching(userId, trigger.event_key, trigger.conditions, {
        limit: perTriggerLimit,
      });
    } catch (err) {
      logger.warn('automation', `Evaluation de ${trigger.event_key} : ${err.message}`);
      continue;
    }

    const workflow = await db.workflows.get(trigger.workflow_id);
    for (const contact of contacts) {
      const out = await runEnrollment({
        userId,
        trigger,
        workflow,
        source: 'event',
        rationale: trigger.event_key,
        resolve: async () => {
          const { isCrmContact } = require('./crm-scope');
          const opp = await db.opportunities.get(contact.id);
          if (!opp || !isCrmContact(opp)) return { skip: 'no_known_contact' };
          return { opp };
        },
      });

      if (out.ok) {
        report.enrolled++;
      } else {
        report.skipped++;
        report.reasons[out.reason] = (report.reasons[out.reason] || 0) + 1;
        // Le disjoncteur a parlé ou il n'y a pas de boîte : inutile de
        // parcourir les contacts suivants de ce déclencheur.
        if (out.reason === 'breaker_open' || out.reason === 'no_mailbox') break;
      }
    }
  }

  return report;
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
  onCrmEvent,
  runStateTriggers,
  matchesConditions,
  runBackfill,
  // exportés pour les tests
  resolveContact,
  dedupKeyFor,
  copySteps,
};
