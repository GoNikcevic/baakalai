/**
 * Data Quality — generic audit + undo (shared "Historique" mechanism for all 3 strates)
 *
 * Every change-producing endpoint in routes/data-quality.js calls recordChange() with a full
 * before/after snapshot. undoGroup() is one generic operation that works for every change type
 * by branching only on `remote_action` (what actually happened to the live CRM record) — never
 * on `change_type` — which is what lets this be a single table/function instead of one per type.
 *
 * In this iteration only 3 change_types are ever produced: 'merge_keep'/'merge_delete' (from
 * POST /duplicates/:provider/confirm-merge) and 'enrichment' (from POST /enrich-field). The
 * others in data_quality_changes' CHECK constraint exist for forward-compatibility.
 */

const db = require('../db');
const crmCleaning = require('./crm-cleaning-agent');

/**
 * Build the { crm, local, productLineIds } snapshot shape shared by before_data/after_data.
 * `productLineIds` must be the contact's REAL current set (or [] if genuinely none) — passing
 * null/undefined here and letting it default to [] would make undo wipe out product lines that
 * existed before the change but were never captured (this bit a merge_keep contact's own
 * pre-merge assignments before relinkedChildren was introduced — see confirm-merge).
 */
function snapshotContact(provider, normalizedCrmContact, opportunityRow, productLineIds, extra) {
  return {
    crm: normalizedCrmContact || null,
    local: opportunityRow || null,
    productLineIds: productLineIds || [],
    ...(extra || {}),
  };
}

// Fields POST /enrich-field can touch, in the same precedence it writes them (one field per
// call, so at most one of these ever actually differs between before_data.local/after_data.local
// for a given 'enrichment' row).
const ENRICHABLE_FIELDS = [
  { key: 'sector', getValue: (o) => o?.data?.sector },
  { key: 'dealValue', getValue: (o) => o?.deal_value },
  { key: 'email', getValue: (o) => o?.email },
  { key: 'company', getValue: (o) => o?.company },
  { key: 'name', getValue: (o) => o?.name },
];

/** For an 'enrichment' change, identify which field actually changed and its before/after value. */
function describeFieldChange(row) {
  if (row.change_type !== 'enrichment') return null;
  const before = row.before_data?.local;
  const after = row.after_data?.local;
  if (!before || !after) return null;
  for (const { key, getValue } of ENRICHABLE_FIELDS) {
    const a = getValue(after);
    const b = getValue(before);
    if (a !== undefined && a !== b) return { field: key, before: b ?? null, after: a };
  }
  return null;
}

// Child tables that reference opportunities(id) and hold real activity/relationship history —
// merging a duplicate must re-link these onto the surviving contact rather than let them go
// orphaned (SET NULL) or be destroyed (CASCADE, for churn_external_signals) when the duplicate
// row is deleted. Deliberately excludes opportunity_product_lines (handled separately via
// productLineIds, since a client can only be linked to a product line once — it's a merge/union,
// not a re-link) and data_quality_changes (this module's own audit log).
const RELINKABLE_TABLES = ['nurture_emails', 'prospect_activities', 'churn_outcomes', 'autopilot_queue', 'signals', 'churn_external_signals'];

/**
 * Move every child record from one opportunity to another (used when a duplicate is about to be
 * deleted during a merge) and return which record ids were moved, per table — so undo can move
 * them back precisely, without guessing which of the kept contact's records came from the merge.
 */
async function captureAndRelinkChildren(fromOppId, toOppId) {
  const relinked = {};
  for (const table of RELINKABLE_TABLES) {
    const existing = await db.query(`SELECT id FROM ${table} WHERE opportunity_id = $1`, [fromOppId]);
    const ids = existing.rows.map(r => r.id);
    if (ids.length > 0) {
      await db.query(`UPDATE ${table} SET opportunity_id = $1 WHERE opportunity_id = $2`, [toOppId, fromOppId]);
      relinked[table] = ids;
    }
  }
  return relinked;
}

/** Reverse captureAndRelinkChildren — move the specific record ids back to the restored contact. */
async function revertRelink(relinked, restoredOppId) {
  for (const [table, ids] of Object.entries(relinked || {})) {
    if (!RELINKABLE_TABLES.includes(table) || !ids || ids.length === 0) continue;
    await db.query(`UPDATE ${table} SET opportunity_id = $1 WHERE id = ANY($2)`, [restoredOppId, ids]);
  }
}

/** Per-contact activity counts, shown in the merge review UI so a "quiet" duplicate never looks
 *  identical to one with real history before the user picks which one to keep. */
async function getActivityCounts(opportunityId) {
  const [emails, activities, productLines] = await Promise.all([
    db.query(`SELECT count(*) FROM nurture_emails WHERE opportunity_id = $1`, [opportunityId]),
    db.query(`SELECT count(*) FROM prospect_activities WHERE opportunity_id = $1`, [opportunityId]),
    db.query(`SELECT count(*) FROM opportunity_product_lines WHERE opportunity_id = $1`, [opportunityId]),
  ]);
  return {
    emails: parseInt(emails.rows[0].count, 10),
    activities: parseInt(activities.rows[0].count, 10),
    productLines: parseInt(productLines.rows[0].count, 10),
  };
}

async function recordChange(userId, groupId, {
  strate, changeType, provider, crmContactId, opportunityId, remoteAction, beforeData, afterData,
}) {
  await db.query(
    `INSERT INTO data_quality_changes
       (user_id, group_id, strate, change_type, provider, crm_contact_id, opportunity_id, remote_action, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId, groupId, strate, changeType, provider || null, crmContactId ? String(crmContactId) : null,
      opportunityId || null, remoteAction || 'none', JSON.stringify(beforeData || {}), JSON.stringify(afterData || {}),
    ]
  );
}

// JSONB columns come back from `SELECT *` already parsed into JS objects/arrays (e.g.
// churn_factors is a JSONB array) and must be re-stringified on the way back in; Dates must
// NOT be — pg serializes those natively, and double-encoding would corrupt them. `opportunities`
// has no genuinely native Postgres ARRAY-typed column, so every array here is JSONB.
function toSqlValue(v) {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}

async function reinsertOpportunityRow(row) {
  const cols = Object.keys(row);
  const values = cols.map(c => toSqlValue(row[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO opportunities (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
    values
  );
}

async function updateOpportunityRowFromSnapshot(row) {
  const cols = Object.keys(row).filter(c => c !== 'id');
  const values = cols.map(c => toSqlValue(row[c]));
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await db.query(`UPDATE opportunities SET ${sets} WHERE id = $1`, [row.id, ...values]);
}

async function restoreProductLines(opportunityId, productLineIds) {
  await db.query(`DELETE FROM opportunity_product_lines WHERE opportunity_id = $1`, [opportunityId]);
  for (const plId of (productLineIds || [])) {
    await db.query(
      `INSERT INTO opportunity_product_lines (opportunity_id, product_line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [opportunityId, plId]
    );
  }
}

/**
 * Generic undo: undoes a whole group_id at once (one user-visible action = one undo).
 *
 * Scope boundary: this restores the contact/opportunity row's own field values and its
 * product-line assignments as of the change. It does NOT attempt to restore other
 * cascade-deleted child rows (nurture_emails, churn_outcomes, etc.) that may have referenced
 * the deleted opportunity via ON DELETE CASCADE/SET NULL — full transitive-relational undo was
 * not part of this scope.
 */
async function undoGroup(userId, groupId) {
  const rowsResult = await db.query(
    `SELECT * FROM data_quality_changes WHERE user_id = $1 AND group_id = $2`,
    [userId, groupId]
  );
  const rows = rowsResult.rows;
  if (rows.length === 0) return { ok: false, error: 'Change group not found' };
  if (rows.some(r => r.status === 'undone')) return { ok: false, error: 'Already undone' };

  const results = [];
  for (const row of rows) {
    try {
      const before = row.before_data || {};

      // 1. Remote CRM side, based on what actually happened there.
      if ((row.remote_action === 'deleted' || row.remote_action === 'archived') && row.provider && before.crm) {
        const adapter = crmCleaning.getAdapter(row.provider);
        const token = await crmCleaning.getProviderCredentials(userId, row.provider);
        if (token) {
          if (row.remote_action === 'archived' && typeof adapter.unarchivePerson === 'function') {
            await adapter.unarchivePerson(token, row.crm_contact_id);
          } else if (typeof adapter.createPerson === 'function') {
            const recreated = await adapter.createPerson(token, before.crm);
            // Hard-delete providers (Salesforce) issue a NEW id on recreate — Odoo's
            // archive/unarchive keeps the original id, so this only fires for the former.
            if (recreated?.id != null && String(recreated.id) !== String(row.crm_contact_id) && before.local?.id) {
              await db.query(`UPDATE opportunities SET crm_contact_id = $1 WHERE id = $2`, [String(recreated.id), before.local.id]);
            }
          }
        }
      } else if (row.remote_action === 'updated' && row.provider && before.crm) {
        const adapter = crmCleaning.getAdapter(row.provider);
        const token = await crmCleaning.getProviderCredentials(userId, row.provider);
        if (token) await adapter.updatePerson(token, row.crm_contact_id, before.crm);
      }
      // 'manual_required' / 'none': no remote call to make.

      // 2. Local opportunities mirror row. merge_delete is the only change type in this
      // feature that hard-deletes a local row — everything else only updates fields.
      if (before.local) {
        if (row.change_type === 'merge_delete') {
          const existing = await db.query(`SELECT id FROM opportunities WHERE id = $1`, [before.local.id]);
          if (existing.rows.length === 0) await reinsertOpportunityRow(before.local);
          // Move the emails/activities/etc. that confirm-merge re-linked onto the kept contact
          // back onto this now-restored one — precise, by record id, not "everything the kept
          // contact currently has" (which could include its own unrelated history).
          if (before.relinkedChildren) await revertRelink(before.relinkedChildren, before.local.id);
        } else {
          await updateOpportunityRowFromSnapshot(before.local);
        }
      }

      // 3. Product-line assignments, if this change touched them.
      const restoreOppId = before.local?.id || row.opportunity_id;
      if (restoreOppId && before.productLineIds !== undefined) {
        await restoreProductLines(restoreOppId, before.productLineIds);
      }

      await db.query(`UPDATE data_quality_changes SET status = 'undone', undone_at = now() WHERE id = $1`, [row.id]);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      await db.query(`UPDATE data_quality_changes SET status = 'undo_failed' WHERE id = $1`, [row.id]);
      results.push({ id: row.id, ok: false, error: err.message });
    }
  }

  // Undo just changed contact data (recreated/reverted) — invalidate the cached scan for every
  // provider touched so the next GET /duplicates reflects the restored state instead of the
  // stale post-merge snapshot (same reasoning as confirm-merge's own cache invalidation).
  const touchedProviders = [...new Set(rows.map(r => r.provider).filter(Boolean))];
  for (const provider of touchedProviders) {
    await db.query(`DELETE FROM crm_cleaning_reports WHERE user_id = $1 AND provider = $2`, [userId, provider]);
  }

  // Enrichments (sector/dealValue/...) are cached under a strate-level sentinel, not a real
  // provider — invalidate those too, or an undone fix (e.g. deal value reverted to empty)
  // would keep looking "resolved" on the Deal/Client Quality list until the 24h cache expires.
  const touchedStrates = [...new Set(rows.map(r => r.strate).filter(s => s === 'deal_quality' || s === 'client_quality'))];
  for (const strate of touchedStrates) {
    const sentinelProvider = strate === 'client_quality' ? '__client_quality__' : '__deal_quality__';
    await db.query(`DELETE FROM crm_cleaning_reports WHERE user_id = $1 AND provider = $2`, [userId, sentinelProvider]);
  }

  return { ok: results.every(r => r.ok), results };
}

/**
 * List change history, grouped by group_id (one user-visible action per group), most recent
 * first. Fetches a generous multiple of raw rows before grouping+slicing so a limit doesn't cut
 * a multi-row group (e.g. a 3-way merge) in half.
 */
async function listHistory(userId, { strate, limit = 50 } = {}) {
  const conditions = ['user_id = $1'];
  const params = [userId];
  if (strate) {
    params.push(strate);
    conditions.push(`strate = $${params.length}`);
  }
  params.push(limit * 10);

  const result = await db.query(
    `SELECT * FROM data_quality_changes WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );

  const order = [];
  const groups = new Map();
  for (const row of result.rows) {
    if (!groups.has(row.group_id)) {
      order.push(row.group_id);
      groups.set(row.group_id, {
        groupId: row.group_id,
        strate: row.strate,
        changeType: row.change_type,
        createdAt: row.created_at,
        canUndo: row.status === 'applied',
        rows: [],
      });
    }
    const g = groups.get(row.group_id);
    if (row.status !== 'applied') g.canUndo = false;
    g.rows.push({
      id: row.id,
      provider: row.provider,
      crmContactId: row.crm_contact_id,
      opportunityId: row.opportunity_id,
      remoteAction: row.remote_action,
      status: row.status,
      name: row.before_data?.local?.name || row.before_data?.crm?.name || null,
      company: row.before_data?.local?.company || row.before_data?.crm?.company || null,
      fieldChange: describeFieldChange(row),
    });
  }

  return order.slice(0, limit).map(gid => groups.get(gid));
}

module.exports = { recordChange, snapshotContact, undoGroup, listHistory, captureAndRelinkChildren, getActivityCounts };
