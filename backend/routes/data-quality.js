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
const { classifySector } = require('../lib/sector-classifier');
const { getValidatedIntegrations } = require('../config');

const router = Router();

const CONNECTABLE_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];
const REAL_WRITE_PROVIDERS = ['pipedrive', 'hubspot', 'odoo', 'salesforce'];
// Notion/Airtable/__no_crm__ scan Baakalai's own imported opportunities rows (crm-cleaning-agent.js's
// getAdapter()) — normalizePerson emits the opportunity's own UUID `id` directly there, not a
// native CRM contact id. Every other provider's `id` is a real, native provider-side contact id,
// looked up locally via crm_provider+crm_contact_id.
const LOCAL_SCAN_PROVIDERS = ['notion', 'airtable', '__no_crm__'];
// Pseudo-provider for contacts with no known CRM origin at all (crm_provider IS NULL) — not a
// real integration, never in CONNECTABLE_PROVIDERS/user_integrations, but always scanned so
// these contacts get their own "Pas de CRM associé" section instead of being hidden or folded
// into whichever real CRM happens to be connected.
const NO_CRM_PROVIDER = '__no_crm__';
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
  return CONNECTABLE_PROVIDERS.includes(provider) || provider === NO_CRM_PROVIDER;
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
    // A row existing in user_integrations isn't enough — a stale/placeholder access_token that
    // doesn't actually decrypt (e.g. test data seeded directly in the DB) must not count as a
    // real, established connection (see getValidatedIntegrations for why getUserKey's .env
    // fallback can't be reused for this check).
    const connectedProviders = await getValidatedIntegrations(req.user.id, CONNECTABLE_PROVIDERS);

    // Contacts with no known CRM origin need somewhere to be scanned/fixed regardless of which
    // (if any) real CRMs are connected — only worth the scan if any such contact actually exists.
    const noCrmCount = await db.query(
      `SELECT 1 FROM opportunities WHERE user_id = $1 AND crm_provider IS NULL LIMIT 1`,
      [req.user.id]
    );
    const providersToScan = noCrmCount.rows.length > 0
      ? [...connectedProviders, NO_CRM_PROVIDER]
      : connectedProviders;

    const providerResults = [];
    for (const provider of providersToScan) {
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

      // __no_crm__ contacts were never in an external CRM to begin with — deleting the local
      // row (below) is the complete action, unlike Notion/Airtable where a manual checklist is
      // needed because a real CRM record is left behind (no delete API for those providers).
      let remoteAction = provider === NO_CRM_PROVIDER ? 'none' : 'manual_required';
      if (isRealWrite && token) {
        await adapter.deletePerson(token, delId);
        remoteAction = provider === 'odoo' ? 'archived' : 'deleted';
      } else if (provider !== NO_CRM_PROVIDER) {
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
// Accepts either { opportunityId } (Deal/Client Quality — id is already a Baakalai
// opportunities.id) or { provider, crmContactId } (General tab's "other issues" — id there is
// the native CRM contact id for real-API providers, resolved via findLocalOpportunity like
// preview-merge/confirm-merge already do).
router.post('/enrich-field', async (req, res, next) => {
  try {
    const { opportunityId, provider, crmContactId, field, value } = req.body;
    const SUPPORTED_FIELDS = ['sector', 'email', 'company', 'dealValue', 'name'];
    if ((!opportunityId && !(provider && crmContactId)) || !SUPPORTED_FIELDS.includes(field)) {
      return res.status(400).json({ error: `field must be one of: ${SUPPORTED_FIELDS.join(', ')}, and either opportunityId or provider+crmContactId is required` });
    }

    const opp = opportunityId
      ? (await db.query(`SELECT * FROM opportunities WHERE id = $1 AND user_id = $2`, [opportunityId, req.user.id])).rows[0]
      : await findLocalOpportunity(req.user.id, provider, crmContactId);
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    const beforeLocal = { ...opp };
    let afterLocal;
    let classifiedSector;
    if (field === 'sector') {
      // Run through the same sector-classifier agent churn-scoring uses (scope 'client_industry')
      // so opportunities.data.sector always holds a canonical sector name, not raw free text.
      classifiedSector = await classifySector(value, 'client_industry');
      const newData = { ...(opp.data || {}), sector: classifiedSector };
      await db.query(`UPDATE opportunities SET data = $1 WHERE id = $2`, [JSON.stringify(newData), opp.id]);
      afterLocal = { ...opp, data: newData };
    } else {
      const column = field === 'dealValue' ? 'deal_value' : field;
      await db.query(`UPDATE opportunities SET ${column} = $1 WHERE id = $2`, [value, opp.id]);
      afterLocal = { ...opp, [column]: value };
    }

    // Push to the live CRM too — only for providers with real write support, and only for
    // fields the generic adapter interface actually recognizes (sector/dealValue are
    // Baakalai-only concepts with no CRM-side field mapping in updatePerson).
    const CRM_RECOGNIZED_FIELDS = { email: 'email', company: 'company', name: 'name' };
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

    // sector/dealValue are Deal/Client Quality concepts; name/email/company corrections come
    // from the General tab's "other issues" — general CRM hygiene, same strate as duplicates.
    const strate = (field === 'sector' || field === 'dealValue')
      ? (opp.status === 'won' ? 'client_quality' : 'deal_quality')
      : 'duplicates';
    // opp.crm_provider can be null for locally-created/seeded contacts that still surfaced via a
    // provider's General-tab scan (the Notion/Airtable local-scan adapter isn't itself filtered
    // by provider — it lists every local opportunity). The request's own `provider` param
    // unambiguously identifies which scan needs to be invalidated; when it's absent
    // (opportunityId-based Deal/Client Quality calls) opp.crm_provider is used as before.
    const scanProvider = provider || opp.crm_provider;
    const groupId = randomUUID();
    await audit.recordChange(req.user.id, groupId, {
      strate,
      changeType: 'enrichment',
      provider: scanProvider || null,
      crmContactId: opp.crm_contact_id || null,
      opportunityId: opp.id,
      remoteAction,
      beforeData: audit.snapshotContact(opp.crm_provider, beforeCrm, beforeLocal, null),
      afterData: audit.snapshotContact(opp.crm_provider, null, afterLocal, null),
    });

    // Invalidate the cached issue list so the fixed contact stops showing up as still-flagged
    // until the next scan (same gap this session already fixed for duplicates/merge). The
    // 'duplicates' strate (General tab) is cached per real provider, not a sentinel.
    const cacheProvider = strate === 'client_quality' ? '__client_quality__'
      : strate === 'deal_quality' ? '__deal_quality__'
      : scanProvider;
    if (cacheProvider) {
      await db.query(`DELETE FROM crm_cleaning_reports WHERE user_id = $1 AND provider = $2`, [req.user.id, cacheProvider]);
    }

    res.json({ ok: true, remoteAction, sector: classifiedSector });
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

// GET /api/data-quality/score-history — historique du score pour la sparkline.
// Sentinelles `__*__` exclues (score 0 par construction, ce ne sont que des caches).
router.get('/score-history', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT provider, score, created_at FROM crm_cleaning_reports
       WHERE user_id = $1 AND provider NOT LIKE '\\_\\_%'
         AND created_at > now() - interval '90 days'
       ORDER BY created_at ASC`,
      [req.user.id]
    );

    const byProvider = new Map();
    for (const row of r.rows) {
      if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
      byProvider.get(row.provider).push({ date: row.created_at, score: row.score });
    }
    const providers = [...byProvider.entries()].map(([provider, points]) => ({ provider, points }));

    // current / delta30d : moyenne des derniers scores par provider vs il y a ~30 j
    const avgAt = (cutoff) => {
      const latest = new Map();
      for (const row of r.rows) {
        if (new Date(row.created_at) <= cutoff) latest.set(row.provider, row.score);
      }
      if (latest.size === 0) return null;
      const scores = [...latest.values()];
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    };
    const current = avgAt(new Date());
    const baseline = avgAt(new Date(Date.now() - 30 * 24 * 3600 * 1000));

    res.json({
      current,
      delta30d: current != null && baseline != null ? current - baseline : null,
      providers,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/data-quality/gdpr — contacts candidats à la purge RGPD : aucune
// activité réelle depuis 24 mois et pas client actif (won = relation en cours).
const GDPR_THRESHOLD_MONTHS = 24;
router.get('/gdpr', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, name, email, company, status,
              COALESCE(last_activity_at, created_at) AS last_activity_at
       FROM opportunities
       WHERE user_id = $1 AND status <> 'won'
         AND COALESCE(last_activity_at, created_at) < now() - interval '${GDPR_THRESHOLD_MONTHS} months'
       ORDER BY COALESCE(last_activity_at, created_at) ASC`,
      [req.user.id]
    );
    const now = Date.now();
    res.json({
      thresholdMonths: GDPR_THRESHOLD_MONTHS,
      candidates: r.rows.map(row => ({
        ...row,
        lastActivityAt: row.last_activity_at,
        monthsInactive: Math.floor((now - new Date(row.last_activity_at).getTime()) / (30.44 * 24 * 3600 * 1000)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/data-quality/gdpr/purge — suppression locale (la copie baakalai ;
// le CRM du client reste sous SA responsabilité), en un seul groupe d'historique
// donc annulable d'un clic dans l'onglet Historique.
router.post('/gdpr/purge', async (req, res, next) => {
  try {
    const { opportunityIds } = req.body;
    if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
      return res.status(400).json({ error: 'opportunityIds (non vide) requis' });
    }
    if (opportunityIds.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 contacts par purge' });
    }

    const groupId = randomUUID();
    let deleted = 0;
    for (const id of opportunityIds) {
      const rowResult = await db.query(
        `SELECT * FROM opportunities WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
      const row = rowResult.rows[0];
      if (!row) continue;

      const pl = await db.query(
        `SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1`, [id]);
      await audit.recordChange(req.user.id, groupId, {
        strate: 'gdpr',
        changeType: 'gdpr_purge',
        provider: row.crm_provider,
        crmContactId: row.crm_contact_id,
        opportunityId: id,
        remoteAction: 'none',
        beforeData: { local: row, productLineIds: pl.rows.map(p => p.product_line_id) },
        afterData: {},
      });
      await db.query(`DELETE FROM opportunities WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
      deleted++;
    }

    res.json({ deleted, groupId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
