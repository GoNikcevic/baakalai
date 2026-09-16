/**
 * Réconciliation de séquence · partagée campagnes / enrollments.
 *
 * Réconciliation, PAS delete/recreate : campaign_sends référence les
 * touchpoints (SET NULL depuis la migration 103, CASCADE avant) · supprimer
 * puis recréer la séquence d'un conteneur avec des envois en cours effaçait
 * la position de chaque prospect et faisait tout repartir à E1. Ici les steps
 * existants (id backend présent) sont mis à jour EN PLACE, les nouveaux créés,
 * et seuls les steps réellement retirés par l'utilisateur sont supprimés.
 *
 * Deux formes de payload acceptées : plat avec parentStepId = id backend du
 * parent (CopyTab/CopyEditorPage via sequenceToBackend), ou imbriqué via
 * children (WorkflowPage, génération). Les deux peuvent se mélanger.
 *
 * `container` : { campaignId } OU { enrollmentId } · passé tel quel à la DAO.
 */

const db = require('../db');

async function reconcileSequence(tps, existing, container) {
  const existingIds = new Set(existing.map((t) => t.id));

  const byId = new Map(tps.filter((t) => t.id).map((t) => [t.id, t]));
  const flatChildren = new Map();
  const roots = [];
  for (const tp of tps) {
    const parent = tp.parentStepId && byId.get(tp.parentStepId);
    if (parent && parent !== tp) {
      if (!flatChildren.has(tp.parentStepId)) flatChildren.set(tp.parentStepId, []);
      flatChildren.get(tp.parentStepId).push(tp);
    } else {
      roots.push(tp);
    }
  }

  const sequence = [];
  const keptIds = new Set();
  let sortCounter = 0;
  const upsertNode = async (tp, parentBackendId = null, isRoot = true) => {
    const fields = {
      step: tp.step,
      type: tp.type,
      label: tp.label || null,
      subType: tp.subType || null,
      timing: tp.timing || null,
      subject: tp.subject ?? null,
      body: tp.body || '',
      subjectB: tp.subjectB ?? tp.subject_b ?? null,
      bodyB: tp.bodyB ?? tp.body_b ?? null,
      maxChars: tp.maxChars || null,
      sortOrder: sortCounter++,
      parentStepId: parentBackendId,
      conditionType: tp.conditionType ?? tp.condition_type ?? null,
      branchLabel: tp.branchLabel ?? tp.branch_label ?? null,
      isRoot,
    };
    if (fields.type === 'linkedin_invite') {
      fields.subject = null;
      fields.body = (fields.body || '').slice(0, 300);
      fields.maxChars = 300;
    }
    let backendId;
    if (tp.id && existingIds.has(tp.id)) {
      backendId = tp.id;
      await db.touchpoints.update(backendId, fields);
    } else {
      const created = await db.touchpoints.create(container.campaignId || null, {
        ...fields,
        enrollmentId: container.enrollmentId || null,
      });
      backendId = created.id;
    }
    keptIds.add(backendId);
    sequence.push({ ...tp, id: backendId, parentStepId: parentBackendId });
    const children = [
      ...(flatChildren.get(tp.id) || []),
      ...(Array.isArray(tp.children) ? tp.children : []),
    ];
    for (const child of children) {
      await upsertNode(child, backendId, false);
    }
  };
  for (const tp of roots) {
    await upsertNode(tp, null, true);
  }

  for (const old of existing) {
    if (!keptIds.has(old.id)) await db.touchpoints.remove(old.id);
  }

  return sequence;
}

module.exports = { reconcileSequence };
