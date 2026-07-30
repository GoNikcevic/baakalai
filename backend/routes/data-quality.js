/**
 * Data Quality Routes — the redesigned "Data / Doublons" page, organized in 3 strates:
 *
 * GET   /duplicates                              — per-connected-CRM duplicate scan (Strate 1)
 * POST  /duplicates/:provider/preview-merge       — full field diff for a duplicate group
 * POST  /duplicates/:provider/confirm-merge       — apply a reviewed merge, with full audit trail
 * GET   /deal-quality                             — deal-data quality issues (Strate 2)
 * GET   /client-quality                           — client/upsell-data quality issues (Strate 3)
 * POST  /enrich-field                             — fill a missing field; pushes to the live CRM
 *                                                    too when that provider supports real writes
 * GET   /history?strate=                          — change history, grouped by user action
 * POST  /history/:groupId/undo                    — full undo of one change group
 *
 * Every strate adapts to what each connected CRM actually supports — see
 * lib/crm-cleaning-agent.js's getAdapter() for the per-provider capability table.
 */

const { Router } = require('express');
const { randomUUID } = require('crypto');
const db = require('../db');
const crmCleaning = require('../lib/crm-cleaning-agent');
const dataQualityChecks = require('../lib/data-quality-checks');
const audit = require('../lib/data-quality-audit');

const router = Router();

const CONNECTABLE_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];
const REAL_WRITE_PROVIDERS = ['pipedrive', 'hubspot', 'odoo', 'salesforce'];
// Notion/Airtable scan Baakalai's own imported opportunities rows (crm-cleaning-agent.js's
// getAdapter()) — normalizePerson emits the opportunity's own UUID `id` directly there, not a
// native CRM contact id. Every other provider's `id` is a real, native provider-side contact id,
// looked up locally via crm_provider+crm_contact_id.
const LOCAL_SCAN_PROVIDERS = ['notion', 'airtable'];
const DUPLICATE_ISSUE_TYPES = ['duplicate_email', 'duplicate_name'];

/** Find the local opportunities mirror row for a contact id, branching per provider (see above). */
async function findLocalOpportunity(userId, provider, contactId) {
  const result = LOCAL_SCAN_PROVIDERS.includes(provider)
    ? await db.query(`SELECT * FROM opportunities WHERE user_id = $1 AND id = $2`, [userId, contactId])
    : await db.query(
        `SELECT * FROM opportunities WHERE user_id = $1 AND crm_provider = $2 AND crm_contact_id = $3`,
        [userId, provider, String(contactId)]
      );
  return result.rows[0] || null;
}

function isDuplicateIssue(issue) {
  return DUPLICATE_ISSUE_TYPES.includes(issue.type);
}

function validateProvider(provider) {
  return CONNECTABLE_PROVIDERS.includes(provider);
}

/** Find the duplicate group in a cached scan whose contacts exactly match the given ids. */
function findGroup(cached, contactIds) {
  const wanted = contactIds.map(String);
  return (cached.issues || [])
    .filter(isDuplicateIssue)
    .find(issue => wanted.every(id => issue.contacts.some(c => String(c.id) === id)));
}

async function getOrRunScan(userId, provider) {
  const cached = await db.crmCleaningReports.getLatestByProvider(userId, provider);
  if (cached) return { score: cached.score, totalContacts: cached.total_contacts, issues: cached.issues };
  const report = await crmCleaning.scanCRM(userId, provider);
  await db.crmCleaningReports.create({
    userId, provider, score: report.score, totalContacts: report.totalContacts,
    summary: report.summary, issues: report.issues,
  });
  return report;
}

// GET /api/data-quality/duplicates
router.get('/duplicates', async (req, res, next) => {
  try {
    const connectedResult = await db.query(
      `SELECT provider FROM user_integrations WHERE user_id = $1 AND provider = ANY($2)`,
      [req.user.id, CONNECTABLE_PROVIDERS]
    );
    const connectedProviders = connectedResult.rows.map(r => r.provider);

    const providerResults = [];
    for (const provider of connectedProviders) {
      try {
        const report = await getOrRunScan(req.user.id, provider);
        providerResults.push({
          provider,
          score: report.score,
          totalContacts: report.totalContacts,
          duplicateGroups: (report.issues || []).filter(isDuplicateIssue),
          otherIssues: (report.issues || []).filter(i => !isDuplicateIssue(i)),
        });
      } catch (err) {
        providerResults.push({ provider, error: err.message });
      }
    }

    res.json({ providerResults });
  } catch (err) {
    next(err);
  }
});

// POST /api/data-quality/duplicates/:provider/preview-merge
router.post('/duplicates/:provider/preview-merge', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { contactIds } = req.body;
    if (!validateProvider(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    if (!Array.isArray(contactIds) || contactIds.length < 2) {
      return res.status(400).json({ error: 'contactIds (2 or more) is required' });
    }

    const cached = await db.crmCleaningReports.getLatestByProvider(req.user.id, provider);
    if (!cached) return res.status(400).json({ error: 'No recent scan found for this provider — run a scan first' });

    const group = findGroup(cached, contactIds);
    if (!group) return res.status(400).json({ error: 'contactIds do not match a known duplicate group from the latest scan' });

    const wanted = contactIds.map(String);
    const contacts = group.contacts.filter(c => wanted.includes(String(c.id)));
    const diff = crmCleaning.computeMergeDiff(contacts);

    // Per-contact activity counts — so a contact with real history never looks identical to an
    // empty one before the user picks which one to keep.
    const activityCounts = {};
    for (const c of contacts) {
      const localOpp = await findLocalOpportunity(req.user.id, provider, c.id);
      activityCounts[c.id] = localOpp ? await audit.getActivityCounts(localOpp.id) : null;
    }

    res.json({ diff, activityCounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/data-quality/duplicates/:provider/confirm-merge
router.post('/duplicates/:provider/confirm-merge', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { contactIds, keepId, resolvedFields } = req.body;
    if (!validateProvider(provider)) return res.status(400).json({ error: `Unknown provider: ${provider}` });
    if (!Array.isArray(contactIds) || contactIds.length < 2 || keepId == null) {
      return res.status(400).json({ error: 'contactIds (2 or more) and keepId are required' });
    }
    if (!contactIds.some(id => String(id) === String(keepId))) {
      return res.status(400).json({ error: 'keepId must be one of contactIds' });
    }

    // Re-validate against the user's own latest cached scan — never trust client-supplied ids
    // blindly (see lib/crm-cleaning-agent.js's getProviderCredentials note on the old, broken
    // UUID-vs-native-id ownership check this replaces).
    const cached = await db.crmCleaningReports.getLatestByProvider(req.user.id, provider);
    if (!cached) return res.status(400).json({ error: 'No recent scan found for this provider — run a scan first' });
    const group = findGroup(cached, contactIds);
    if (!group) return res.status(400).json({ error: 'contactIds do not match a known duplicate group from the latest scan' });

    const contactsById = new Map(group.contacts.map(c => [String(c.id), c]));
    const deleteIds = contactIds.map(String).filter(id => id !== String(keepId));
    const isRealWrite = REAL_WRITE_PROVIDERS.includes(provider);
    const adapter = crmCleaning.getAdapter(provider);
    const token = isRealWrite ? await crmCleaning.getProviderCredentials(req.user.id, provider) : null;

    const groupId = randomUUID();
    const manualChecklist = [];

    // ── Kept contact: reconcile fields (remote + local) ──
    const keepContact = contactsById.get(String(keepId));
    const keepOppBefore = await findLocalOpportunity(req.user.id, provider, keepId);

    // Real pre-merge product-line set — NOT null. Undo restores exactly this array, so if it
    // were left null (defaulting to []), undoing a merge would wipe out product lines the kept
    // contact already had before the merge, unrelated to it.
    let keepPlIdsBefore = [];
    if (keepOppBefore) {
      const keepPl = await db.query(`SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1`, [keepOppBefore.id]);
      keepPlIdsBefore = keepPl.rows.map(r => r.product_line_id);
    }

    let keepRemoteAction = 'none';
    if (isRealWrite && token && resolvedFields) {
      await adapter.updatePerson(token, keepId, resolvedFields);
      keepRemoteAction = 'updated';
    }

    let keepOppAfter = keepOppBefore;
    if (keepOppBefore && resolvedFields) {
      const fieldColumnMap = { name: 'name', email: 'email', title: 'title', company: 'company' };
      const sets = [];
      const values = [keepOppBefore.id];
      for (const [field, value] of Object.entries(resolvedFields)) {
        const col = fieldColumnMap[field];
        if (col && value !== undefined) { values.push(value); sets.push(`${col} = $${values.length}`); }
      }
      if (sets.length > 0) {
        await db.query(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = $1`, values);
        keepOppAfter = (await db.query(`SELECT * FROM opportunities WHERE id = $1`, [keepOppBefore.id])).rows[0];
      }
    }

    await audit.recordChange(req.user.id, groupId, {
      strate: 'duplicates',
      changeType: 'merge_keep',
      provider,
      crmContactId: keepId,
      opportunityId: keepOppBefore?.id,
      remoteAction: keepRemoteAction,
      beforeData: audit.snapshotContact(provider, keepContact, keepOppBefore, keepPlIdsBefore),
      afterData: audit.snapshotContact(provider, resolvedFields || null, keepOppAfter, keepPlIdsBefore),
    });

    // ── Other contacts: delete/archive (remote where possible) + reconcile local mirror ──
    for (const delId of deleteIds) {
      const delContact = contactsById.get(delId);
      const delOppBefore = await findLocalOpportunity(req.user.id, provider, delId);

      let productLineIds = [];
      if (delOppBefore) {
        const plResult = await db.query(
          `SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1`,
          [delOppBefore.id]
        );
        productLineIds = plResult.rows.map(r => r.product_line_id);

        // Union the deleted duplicate's product lines onto the kept contact — nothing lost,
        // and no duplicate rows thanks to the composite PK.
        if (keepOppBefore) {
          for (const plId of productLineIds) {
            await db.query(
              `INSERT INTO opportunity_product_lines (opportunity_id, product_line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [keepOppBefore.id, plId]
            );
          }
        }
      }

      let remoteAction = 'manual_required';
      if (isRealWrite && token) {
        await adapter.deletePerson(token, delId);
        remoteAction = provider === 'odoo' ? 'archived' : 'deleted';
      } else {
        manualChecklist.push({ name: delContact?.name || null, email: delContact?.email || null });
      }

      // Re-link real activity/history (sent emails, replies, churn outcomes, etc.) onto the
      // kept contact BEFORE deleting — otherwise it's orphaned (SET NULL) or destroyed (CASCADE
      // for churn_external_signals) and invisible on the surviving contact forever. Captured by
      // record id so undo can move exactly these records back, not "whatever the kept contact
      // has now" (which may include its own unrelated history, or relinks from other merges).
      const relinkedChildren = (delOppBefore && keepOppBefore)
        ? await audit.captureAndRelinkChildren(delOppBefore.id, keepOppBefore.id)
        : {};

      // Record BEFORE deleting the local row — opportunity_id's FK must reference a row that
      // still exists at insert time (ON DELETE SET NULL only applies to existing references,
      // not new inserts against an already-gone row).
      await audit.recordChange(req.user.id, groupId, {
        strate: 'duplicates',
        changeType: 'merge_delete',
        provider,
        crmContactId: delId,
        opportunityId: delOppBefore?.id,
        remoteAction,
        beforeData: audit.snapshotContact(provider, delContact, delOppBefore, productLineIds, { relinkedChildren }),
        afterData: {},
      });

      if (delOppBefore) {
        await db.query(`DELETE FROM opportunities WHERE id = $1`, [delOppBefore.id]);
      }
    }

    // Invalidate the cached scan for this provider — a merge just changed contact data, so the
    // next GET /duplicates (or a manual rescan) must reflect it instead of serving the stale
    // pre-merge snapshot (getOrRunScan only re-scans when no cached report exists).
    await db.query(`DELETE FROM crm_cleaning_reports WHERE user_id = $1 AND provider = $2`, [req.user.id, provider]);

    res.json({ ok: true, groupId, manualChecklist });
  } catch (err) {
    next(err);
  }
});

// GET /api/data-quality/deal-quality
router.get('/deal-quality', async (req, res, next) => {
  try {
    const cached = await db.crmCleaningReports.getLatestByProvider(req.user.id, '__deal_quality__');
    let issues;
    if (cached) {
      issues = cached.issues;
    } else {
      issues = await dataQualityChecks.computeDealQualityIssues(req.user.id);
      // score isn't a meaningful concept for this sentinel cache row (never read back by the
      // frontend, which only consumes `issues`) — 0 is a placeholder to satisfy the NOT NULL
      // constraint shared with the real per-CRM scan reports.
      await db.crmCleaningReports.create({ userId: req.user.id, provider: '__deal_quality__', score: 0, totalContacts: 0, summary: {}, issues });
    }
    res.json({ issues });
  } catch (err) {
    next(err);
  }
});

// GET /api/data-quality/client-quality
router.get('/client-quality', async (req, res, next) => {
  try {
    const cached = await db.crmCleaningReports.getLatestByProvider(req.user.id, '__client_quality__');
    let issues;
    if (cached) {
      issues = cached.issues;
    } else {
      issues = await dataQualityChecks.computeClientQualityIssues(req.user.id);
      await db.crmCleaningReports.create({ userId: req.user.id, provider: '__client_quality__', score: 0, totalContacts: 0, summary: {}, issues });
    }
    res.json({ issues });
  } catch (err) {
    next(err);
  }
});

// POST /api/data-quality/enrich-field
router.post('/enrich-field', async (req, res, next) => {
  try {
    const { opportunityId, field, value } = req.body;
    const SUPPORTED_FIELDS = ['sector', 'email', 'company', 'dealValue'];
    if (!opportunityId || !SUPPORTED_FIELDS.includes(field)) {
      return res.status(400).json({ error: `field must be one of: ${SUPPORTED_FIELDS.join(', ')}` });
    }

    const oppResult = await db.query(`SELECT * FROM opportunities WHERE id = $1 AND user_id = $2`, [opportunityId, req.user.id]);
    const opp = oppResult.rows[0];
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const beforeLocal = { ...opp };
    let afterLocal;
    if (field === 'sector') {
      const newData = { ...(opp.data || {}), sector: value };
      await db.query(`UPDATE opportunities SET data = $1 WHERE id = $2`, [JSON.stringify(newData), opportunityId]);
      afterLocal = { ...opp, data: newData };
    } else {
      const column = field === 'dealValue' ? 'deal_value' : field;
      await db.query(`UPDATE opportunities SET ${column} = $1 WHERE id = $2`, [value, opportunityId]);
      afterLocal = { ...opp, [column]: value };
    }

    // Push to the live CRM too — only for providers with real write support, and only for
    // fields the generic adapter interface actually recognizes (sector/dealValue are
    // Baakalai-only concepts with no CRM-side field mapping in updatePerson).
    const CRM_RECOGNIZED_FIELDS = { email: 'email', company: 'company' };
    let remoteAction = 'none';
    let beforeCrm = null;
    if (opp.crm_provider && REAL_WRITE_PROVIDERS.includes(opp.crm_provider) && opp.crm_contact_id && CRM_RECOGNIZED_FIELDS[field]) {
      const crmField = CRM_RECOGNIZED_FIELDS[field];
      try {
        const adapter = crmCleaning.getAdapter(opp.crm_provider);
        const token = await crmCleaning.getProviderCredentials(req.user.id, opp.crm_provider);
        if (token) {
          beforeCrm = { [crmField]: beforeLocal[crmField] };
          await adapter.updatePerson(token, opp.crm_contact_id, { [crmField]: value });
          remoteAction = 'updated';
        }
      } catch {
        // Local save already succeeded — don't fail the whole request over the CRM push.
        remoteAction = 'none';
        beforeCrm = null;
      }
    }

    const groupId = randomUUID();
    await audit.recordChange(req.user.id, groupId, {
      strate: opp.status === 'won' ? 'client_quality' : 'deal_quality',
      changeType: 'enrichment',
      provider: opp.crm_provider || null,
      crmContactId: opp.crm_contact_id || null,
      opportunityId,
      remoteAction,
      beforeData: audit.snapshotContact(opp.crm_provider, beforeCrm, beforeLocal, null),
      afterData: audit.snapshotContact(opp.crm_provider, null, afterLocal, null),
    });

    res.json({ ok: true, remoteAction });
  } catch (err) {
    next(err);
  }
});

// GET /api/data-quality/history?strate=
router.get('/history', async (req, res, next) => {
  try {
    const { strate } = req.query;
    const groups = await audit.listHistory(req.user.id, { strate, limit: 50 });
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

// POST /api/data-quality/history/:groupId/undo
router.post('/history/:groupId/undo', async (req, res, next) => {
  try {
    const result = await audit.undoGroup(req.user.id, req.params.groupId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
