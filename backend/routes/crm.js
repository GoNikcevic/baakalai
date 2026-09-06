/**
 * CRM Sync Routes (per-user HubSpot)
 *
 * POST /api/crm/sync-opportunity   — Push a single opportunity to HubSpot (contact + deal)
 * POST /api/crm/push-contacts      — Bulk push opportunities to HubSpot
 * POST /api/crm/sync-patterns      — Push high-confidence memory patterns as HubSpot notes
 * GET  /api/crm/status              — Check HubSpot connection status for the current user
 */

const { Router } = require('express');
const db = require('../db');
const hubspot = require('../api/hubspot');
const salesforce = require('../api/salesforce');
const pipedrive = require('../api/pipedrive');
const folk = require('../api/folk');
const odoo = require('../api/odoo');
const notionCrm = require('../api/notion-crm');
const airtableCrm = require('../api/airtable-crm');
const { decrypt, encrypt } = require('../config/crypto');
const { getValidatedIntegrations } = require('../config');
const { validateId, validateEnum } = require('../middleware/validate-params');
const crypto = require('crypto');
const logger = require('../lib/logger');
const { track } = require('../lib/track');
const crmOauth = require('../lib/crm-oauth');

const { rateLimit } = require('../lib/rate-limit');
const cleanLimit = rateLimit({ windowMs: 60000, max: 5 }); // 5 clean ops per minute
const scanLimit = rateLimit({ windowMs: 60000, max: 3 }); // 3 scans per minute

const CRM_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];
const router = Router();
router.param('id', (req, res, next, id) => validateId(req, res, next));
router.param('provider', validateEnum('provider', CRM_PROVIDERS));

/**
 * Resolve the current user's decrypted HubSpot access token.
 * Returns null if not configured.
 */
async function getUserHubspotToken(userId) {
  // Délègue à crm-token pour profiter du refresh automatique des tokens
  // OAuth (30 min de durée de vie chez HubSpot). Les clés API privées
  // passent inchangées.
  const { getUserCrmToken: resolve } = require('../lib/crm-token');
  return resolve(userId, 'hubspot');
}

// =============================================
// GET /api/crm/status — Check HubSpot connection for this user
// =============================================

router.get('/status', async (req, res, next) => {
  try {
    const token = await getUserHubspotToken(req.user.id);
    if (!token) {
      return res.json({ connected: false, reason: 'No HubSpot access token configured' });
    }
    // Verify the token works by fetching a contact
    await hubspot.getContact(token, '1').catch(() => null);
    // If we get a 404 that's fine — means the API is reachable
    res.json({ connected: true });
  } catch (err) {
    res.json({ connected: false, reason: err.message });
  }
});

// =============================================
// POST /api/crm/sync-opportunity — Sync one opportunity
// =============================================

router.post('/sync-opportunity', async (req, res, next) => {
  try {
    const { opportunityId } = req.body;
    if (!opportunityId) return res.status(400).json({ error: 'opportunityId is required' });
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    const provider = userRow.rows[0]?.active_crm_provider;
    if (!provider) return res.status(400).json({ error: 'No active CRM configured. Connect a CRM in Settings.' });
    const opportunity = await db.opportunities.get(opportunityId);
    if (!opportunity) return res.status(404).json({ error: 'Opportunity not found' });
    if (opportunity.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const result = await syncOpportunityToProvider(req.user.id, provider, opportunity);
    res.json(result);
  } catch (err) { next(err); }
});

// =============================================
// POST /api/crm/push-contacts — Bulk push
// =============================================

router.post('/push-contacts', async (req, res, next) => {
  try {
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    const provider = userRow.rows[0]?.active_crm_provider;
    if (!provider) return res.status(400).json({ error: 'No active CRM configured. Connect a CRM in Settings.' });

    const { opportunityIds } = req.body;
    const opportunities = opportunityIds
      ? await Promise.all(opportunityIds.map((id) => db.opportunities.get(id)))
      : await db.opportunities.listByUser(req.user.id, 100);

    const results = [];
    const errors = [];
    for (const opp of opportunities) {
      if (!opp) continue;
      if (opp.user_id !== req.user.id && req.user.role !== 'admin') continue;
      try {
        results.push(await syncOpportunityToProvider(req.user.id, provider, opp));
      } catch (err) {
        errors.push({ opportunityId: opp.id, name: opp.name, error: err.message });
      }
    }
    res.json({ synced: results.length, errors: errors.length, results, errorDetails: errors });
  } catch (err) { next(err); }
});

// =============================================
// POST /api/crm/sync-patterns — Push memory patterns as notes
// =============================================

router.post('/sync-patterns', async (req, res, next) => {
  try {
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    const provider = userRow.rows[0]?.active_crm_provider;
    if (!provider) return res.status(400).json({ error: 'No active CRM configured.' });

    const token = await getUserCrmToken(req.user.id, provider);
    if (!token) return res.status(400).json({ error: `${provider} not configured.` });

    const { dealId } = req.body;
    const allPatterns = await db.memoryPatterns.list({ confidence: 'Haute', userId: req.user.id });
    if (allPatterns.length === 0) {
      return res.json({ synced: false, reason: 'No high-confidence patterns found' });
    }

    if (provider === 'hubspot') {
      const noteBody = hubspot.formatPatternsAsNote(allPatterns);
      const associations = {};
      if (dealId) associations.dealId = dealId;
      const note = await hubspot.createNote(token, noteBody, associations);
      res.json({ synced: true, noteId: note.id, patternsCount: allPatterns.length });
    } else if (provider === 'salesforce') {
      const integration = await db.userIntegrations.get(req.user.id, 'salesforce');
      const instanceUrl = integration?.instance_url;
      if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });
      const noteBody = allPatterns.map(p => `[${p.type}] ${p.pattern} (${p.confidence})`).join('\n');
      const note = await salesforce.createNote(instanceUrl, token, { title: 'Baakal.ai — Memory Patterns', body: noteBody, parentId: dealId });
      res.json({ synced: true, noteId: note.id, patternsCount: allPatterns.length });
    } else {
      res.json({ synced: false, reason: `Pattern sync not yet supported for ${provider}` });
    }
  } catch (err) { next(err); }
});

// =============================================
// Shared sync logic — sync one opportunity to any CRM
// =============================================

async function syncOpportunityToProvider(userId, provider, opportunity) {
  const integration = await db.userIntegrations.get(userId, provider);
  if (!integration) throw new Error(`${provider} not configured`);
  let token;
  try { token = decrypt(integration.access_token); } catch { throw new Error('Invalid stored credentials'); }

  if (provider === 'hubspot') {
    return syncOpportunityToHubspot(token, opportunity);
  } else if (provider === 'salesforce') {
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    const instanceUrl = metadata.instance_url || integration.instance_url;
    if (!instanceUrl) throw new Error('Salesforce instance URL not configured');
    const contactData = salesforce.mapOpportunityToContact(opportunity);
    const contacts = opportunity.email ? await salesforce.searchContacts(instanceUrl, token, opportunity.email) : [];
    let contactId = contacts.length > 0 ? contacts[0].Id : null;
    if (!contactId) { contactId = (await salesforce.createContact(instanceUrl, token, contactData)).id; }
    const deal = await salesforce.createDeal(instanceUrl, token, { name: `${opportunity.name} — ${opportunity.company || 'Bakal'}`, status: opportunity.status });
    await db.opportunities.update(opportunity.id, { crm_provider: 'salesforce', crm_contact_id: contactId, crm_deal_id: deal.id });
    return { opportunityId: opportunity.id, provider: 'salesforce', contactId, dealId: deal.id };
  } else if (provider === 'pipedrive') {
    const personData = pipedrive.mapOpportunityToPerson(opportunity);
    const { person, action } = await pipedrive.upsertPerson(token, personData);
    const deal = await pipedrive.createDeal(token, { name: `${opportunity.name} — ${opportunity.company || 'Bakal'}`, personId: person.id, status: opportunity.status });
    await db.opportunities.update(opportunity.id, { crm_provider: 'pipedrive', crm_contact_id: person.id, crm_deal_id: deal.id });
    return { opportunityId: opportunity.id, provider: 'pipedrive', personId: person.id, dealId: deal.id, action };
  } else if (provider === 'folk') {
    const personData = folk.mapOpportunityToPerson(opportunity);
    const person = await folk.createPerson(token, personData);
    await db.opportunities.update(opportunity.id, { crm_provider: 'folk', crm_contact_id: person.id });
    return { opportunityId: opportunity.id, provider: 'folk', personId: person.id };
  } else if (provider === 'notion') {
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    if (!metadata.database_id) throw new Error('Notion database ID not configured');
    const prospect = { name: opportunity.name || '', email: opportunity.email || '', title: opportunity.title || '', company: opportunity.company || '', company_size: opportunity.company_size || '', linkedin_url: opportunity.linkedin_url || '' };
    const { pageId } = await notionCrm.pushProspectToNotion(token, metadata.database_id, prospect);
    await db.opportunities.update(opportunity.id, { crm_provider: 'notion', crm_contact_id: pageId });
    return { opportunityId: opportunity.id, provider: 'notion', pageId };
  } else if (provider === 'airtable') {
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    if (!metadata.base_id || !metadata.table_name) throw new Error('Airtable base/table not configured');
    const prospect = airtableCrm.mapOpportunityToProspect(opportunity);
    const { recordId } = await airtableCrm.pushProspectToAirtable(token, metadata.base_id, metadata.table_name, prospect);
    await db.opportunities.update(opportunity.id, { crm_provider: 'airtable', crm_contact_id: recordId });
    return { opportunityId: opportunity.id, provider: 'airtable', recordId };
  } else if (provider === 'odoo') {
    let creds;
    try { creds = JSON.parse(token); } catch { throw new Error('Odoo credentials are invalid JSON'); }
    const { id, action } = await odoo.upsertContact(creds, { name: opportunity.name, email: opportunity.email, title: opportunity.title, company: opportunity.company });
    const deal = await odoo.createDeal(creds, { name: `${opportunity.name} — ${opportunity.company || 'Baakalai'}`, contactId: id });
    await db.opportunities.update(opportunity.id, { crm_provider: 'odoo', crm_contact_id: String(id), crm_deal_id: String(deal.id) });
    return { opportunityId: opportunity.id, provider: 'odoo', contactId: id, dealId: deal.id, action };
  }
  throw new Error(`Unsupported CRM provider: ${provider}`);
}

async function syncOpportunityToHubspot(accessToken, opportunity) {
  const campaign = opportunity.campaign_id
    ? await db.campaigns.get(opportunity.campaign_id)
    : null;

  let contactId = opportunity.crm_contact_id || opportunity.hubspot_contact_id;
  let dealId = opportunity.crm_deal_id || opportunity.hubspot_deal_id;

  // --- Contact ---
  if (!contactId && opportunity.email) {
    // Search for existing contact by email
    const search = await hubspot.searchContacts(accessToken, opportunity.email);
    if (search.total > 0) {
      contactId = search.results[0].id;
    }
  }

  const contactProps = hubspot.mapOpportunityToContact(opportunity);

  if (contactId) {
    await hubspot.updateContact(accessToken, contactId, contactProps);
  } else {
    const created = await hubspot.createContact(accessToken, contactProps);
    contactId = created.id;
  }

  // --- Deal ---
  const dealProps = hubspot.mapOpportunityToDeal(opportunity, campaign);

  if (dealId) {
    await hubspot.updateDeal(accessToken, dealId, dealProps);
  } else {
    const created = await hubspot.createDeal(accessToken, dealProps);
    dealId = created.id;
  }

  // --- Association ---
  if (contactId && dealId) {
    await hubspot.associateContactToDeal(accessToken, contactId, dealId).catch(() => {
      // Association may already exist — non-blocking
    });
  }

  // --- Persist HubSpot IDs back to our DB (write to both old and new columns during transition) ---
  await db.opportunities.update(opportunity.id, {
    hubspot_contact_id: contactId,
    hubspot_deal_id: dealId,
    crm_provider: 'hubspot',
    crm_contact_id: contactId,
    crm_deal_id: dealId,
  });

  return {
    opportunityId: opportunity.id,
    name: opportunity.name,
    hubspotContactId: contactId,
    hubspotDealId: dealId,
    action: (opportunity.crm_contact_id || opportunity.hubspot_contact_id) ? 'updated' : 'created',
  };
}

// =============================================
// GET /api/crm/providers — List all CRM connection statuses
// =============================================

router.get('/providers', async (req, res, next) => {
  try {
    const providers = ['hubspot', 'salesforce', 'pipedrive', 'odoo', 'folk', 'notion', 'airtable'];
    const labelMap = { hubspot: 'HubSpot', salesforce: 'Salesforce', pipedrive: 'Pipedrive', odoo: 'Odoo', folk: 'Folk', notion: 'Notion', airtable: 'Airtable' };

    // A row existing in user_integrations isn't enough on its own — only count providers whose
    // stored access_token actually decrypts (excludes stale/placeholder rows, e.g. test data
    // seeded directly in the DB, from silently appearing "connected" everywhere this is checked).
    const [validated, userResult] = await Promise.all([
      getValidatedIntegrations(req.user.id, providers),
      db.query(`SELECT active_crm_provider FROM users WHERE id = $1`, [req.user.id]),
    ]);
    const connectedSet = new Set(validated);
    const activeCrm = userResult.rows[0]?.active_crm_provider || null;

    const statuses = providers.map(provider => ({
      provider,
      connected: connectedSet.has(provider),
      label: labelMap[provider] || provider,
    }));

    res.json({ providers: statuses, activeCrm });
  } catch (err) {
    next(err);
  }
});

// PUT /api/crm/active — Set the user's active/primary CRM provider
router.put('/active', async (req, res, next) => {
  try {
    const { provider } = req.body;
    const validProviders = ['hubspot', 'salesforce', 'pipedrive', 'odoo', 'folk', 'notion', 'airtable'];
    if (!provider || !validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }
    // Verify the provider is actually connected
    const integration = await db.query(
      `SELECT id FROM user_integrations WHERE user_id = $1 AND provider = $2`,
      [req.user.id, provider]
    );
    if (!integration.rows.length) {
      return res.status(400).json({ error: 'Provider not connected' });
    }
    await db.query(`UPDATE users SET active_crm_provider = $1 WHERE id = $2`, [provider, req.user.id]);
    res.json({ ok: true, activeCrm: provider });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/crm/notion/databases — List user's Notion databases
// =============================================

router.get('/notion/databases', async (req, res, next) => {
  try {
    const integration = await db.userIntegrations.get(req.user.id, 'notion');
    if (!integration) {
      return res.status(400).json({ error: 'Notion not configured. Add your integration token in Settings.' });
    }

    let token;
    try { token = decrypt(integration.access_token); } catch { return res.status(400).json({ error: 'Invalid stored Notion credentials' }); }

    const databases = await notionCrm.listDatabases(token);
    res.json({ databases });
  } catch (err) {
    // Handle Notion API errors gracefully
    if (err.code === 'unauthorized' || err.status === 401) {
      return res.status(401).json({ error: 'Notion token is invalid or expired. Re-connect in Settings.' });
    }
    next(err);
  }
});

// =============================================
// POST /api/crm/sync-to/:provider — Sync opportunity to any CRM
// =============================================

router.post('/sync-to/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { opportunityId } = req.body;

    if (!opportunityId) {
      return res.status(400).json({ error: 'opportunityId is required' });
    }

    const opportunity = await db.opportunities.get(opportunityId);
    if (!opportunity) return res.status(404).json({ error: 'Opportunity not found' });
    if (opportunity.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const integration = await db.userIntegrations.get(req.user.id, provider);
    if (!integration) {
      return res.status(400).json({ error: `${provider} not configured. Add credentials in Settings.` });
    }

    let token;
    try { token = decrypt(integration.access_token); } catch { return res.status(400).json({ error: 'Invalid stored credentials' }); }

    let result;

    if (provider === 'hubspot') {
      result = await syncOpportunityToHubspot(token, opportunity);
    } else if (provider === 'salesforce') {
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      const instanceUrl = metadata.instance_url || integration.instance_url;
      if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

      const contactData = salesforce.mapOpportunityToContact(opportunity);
      const contacts = opportunity.email ? await salesforce.searchContacts(instanceUrl, token, opportunity.email) : [];
      let contactId = contacts.length > 0 ? contacts[0].Id : null;
      if (!contactId) {
        const created = await salesforce.createContact(instanceUrl, token, contactData);
        contactId = created.id;
      }
      const deal = await salesforce.createDeal(instanceUrl, token, {
        name: `${opportunity.name} — ${opportunity.company || 'Bakal'}`,
        status: opportunity.status,
      });
      result = { opportunityId: opportunity.id, provider: 'salesforce', contactId, dealId: deal.id };
      await db.opportunities.update(opportunity.id, { crm_provider: 'salesforce', crm_contact_id: contactId, crm_deal_id: deal.id });
    } else if (provider === 'pipedrive') {
      const personData = pipedrive.mapOpportunityToPerson(opportunity);
      const { person, action } = await pipedrive.upsertPerson(token, personData);
      const deal = await pipedrive.createDeal(token, {
        name: `${opportunity.name} — ${opportunity.company || 'Bakal'}`,
        personId: person.id,
        status: opportunity.status,
      });
      result = { opportunityId: opportunity.id, provider: 'pipedrive', personId: person.id, dealId: deal.id, action };
      await db.opportunities.update(opportunity.id, { crm_provider: 'pipedrive', crm_contact_id: person.id, crm_deal_id: deal.id });
    } else if (provider === 'folk') {
      const personData = folk.mapOpportunityToPerson(opportunity);
      const person = await folk.createPerson(token, personData);
      result = { opportunityId: opportunity.id, provider: 'folk', personId: person.id };
      await db.opportunities.update(opportunity.id, { crm_provider: 'folk', crm_contact_id: person.id });
    } else if (provider === 'notion') {
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      const databaseId = metadata.database_id;
      if (!databaseId) return res.status(400).json({ error: 'Notion database ID not configured. Select a database in Settings.' });

      const prospect = {
        name: opportunity.name || '',
        email: opportunity.email || '',
        title: opportunity.title || '',
        company: opportunity.company || '',
        company_size: opportunity.company_size || '',
        linkedin_url: opportunity.linkedin_url || '',
      };
      const { pageId } = await notionCrm.pushProspectToNotion(token, databaseId, prospect);
      result = { opportunityId: opportunity.id, provider: 'notion', pageId };
      await db.opportunities.update(opportunity.id, { crm_provider: 'notion', crm_contact_id: pageId });
    } else if (provider === 'airtable') {
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      const baseId = metadata.base_id;
      const tableName = metadata.table_name;
      if (!baseId || !tableName) return res.status(400).json({ error: 'Airtable base ID and table name not configured. Update in Settings.' });

      const prospect = airtableCrm.mapOpportunityToProspect(opportunity);
      const { recordId } = await airtableCrm.pushProspectToAirtable(token, baseId, tableName, prospect);
      result = { opportunityId: opportunity.id, provider: 'airtable', recordId };
      await db.opportunities.update(opportunity.id, { crm_provider: 'airtable', crm_contact_id: recordId });
    } else if (provider === 'odoo') {
      // token is JSON string: { url, db, username, password }
      let creds;
      try { creds = JSON.parse(token); } catch { return res.status(400).json({ error: 'Odoo credentials are invalid JSON' }); }
      const { id, action } = await odoo.upsertContact(creds, {
        name: opportunity.name,
        email: opportunity.email,
        title: opportunity.title,
        company: opportunity.company,
      });
      const deal = await odoo.createDeal(creds, {
        name: `${opportunity.name} — ${opportunity.company || 'Baakalai'}`,
        contactId: id,
      });
      result = { opportunityId: opportunity.id, provider: 'odoo', contactId: id, dealId: deal.id, action };
      await db.opportunities.update(opportunity.id, { crm_provider: 'odoo', crm_contact_id: String(id), crm_deal_id: String(deal.id) });
    } else {
      return res.status(400).json({ error: `Unsupported CRM provider: ${provider}` });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =============================================
// POST /api/crm/bulk-sync/:provider — Bulk push to any CRM
// =============================================

router.post('/bulk-sync/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const integration = await db.userIntegrations.get(req.user.id, provider);
    if (!integration) {
      return res.status(400).json({ error: `${provider} not configured.` });
    }

    const opportunities = await db.opportunities.list(req.user.id);
    const results = [];
    const errors = [];

    for (const opp of opportunities) {
      try {
        // Re-use sync-to logic (simplified: just push, don't recurse route)
        let token;
        try { token = decrypt(integration.access_token); } catch { continue; }

        if (provider === 'hubspot') {
          const r = await syncOpportunityToHubspot(token, opp);
          results.push(r);
        }
        // For other CRMs, similar logic could be added
        // For now, just count
      } catch (err) {
        errors.push({ id: opp.id, name: opp.name, error: err.message });
      }
    }

    res.json({ synced: results.length, errors: errors.length, total: opportunities.length });
  } catch (err) {
    next(err);
  }
});

// =============================================
// GET /api/crm/airtable/tables — List tables in user's Airtable base
// =============================================

router.get('/airtable/tables', async (req, res, next) => {
  try {
    const integration = await db.userIntegrations.get(req.user.id, 'airtable');
    if (!integration) {
      return res.status(400).json({ error: 'Airtable not configured. Add your API key in Settings.' });
    }

    let token;
    try { token = decrypt(integration.access_token); } catch { return res.status(400).json({ error: 'Invalid stored Airtable credentials' }); }

    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    const baseId = req.query.baseId || metadata.base_id;
    if (!baseId) return res.status(400).json({ error: 'Airtable base ID not configured. Pass baseId query param or update in Settings.' });

    const { tables } = await airtableCrm.listAirtableTables(token, baseId);
    res.json({ tables });
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      return res.status(401).json({ error: 'Airtable token is invalid or expired. Re-connect in Settings.' });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  CRM Data Cleaning & Import
// ═══════════════════════════════════════════════════

const crmCleaning = require('../lib/crm-cleaning-agent');

// GET /api/crm/scan/:provider — Return cached scan report (<24h) or run fresh scan
router.get('/scan/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const cached = await db.crmCleaningReports.getLatestByProvider(req.user.id, provider);
    if (cached) {
      return res.json({
        score: cached.score,
        totalContacts: cached.total_contacts,
        summary: cached.summary,
        issues: cached.issues,
        reportId: cached.id,
        cachedAt: cached.created_at,
      });
    }
    // No recent report — run a fresh scan
    const report = await crmCleaning.scanCRM(req.user.id, provider);
    const saved = await db.crmCleaningReports.create({
      userId: req.user.id,
      provider,
      score: report.score,
      totalContacts: report.totalContacts,
      summary: report.summary,
      issues: report.issues,
    });
    res.json({ ...report, reportId: saved.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/scan/:provider — Run a CRM health scan (always fresh)
router.post('/scan/:provider', scanLimit, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const report = await crmCleaning.scanCRM(req.user.id, provider);

    // Save report to DB
    const saved = await db.crmCleaningReports.create({
      userId: req.user.id,
      provider,
      score: report.score,
      totalContacts: report.totalContacts,
      summary: report.summary,
      issues: report.issues,
    });

    res.json({ ...report, reportId: saved.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/clean/:provider — Apply selected fixes
router.post('/clean/:provider', cleanLimit, async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { reportId, fixes } = req.body;
    if (!fixes || !Array.isArray(fixes)) {
      return res.status(400).json({ error: 'fixes array is required' });
    }

    // Validate fix structure
    for (const fix of fixes) {
      if (!fix.type || typeof fix.type !== 'string') {
        return res.status(400).json({ error: 'Each fix must have a string "type"' });
      }
      if (!['auto_fix_caps', 'delete', 'merge', 'archive', 'review', 'verify_emails'].includes(fix.action)) {
        return res.status(400).json({ error: `Invalid fix action: ${fix.action}` });
      }
      // Validate contactIds are strings/numbers, not objects
      const ids = fix.contactIds || (fix.contacts || []).map(c => c.id);
      if (ids.some(id => typeof id !== 'string' && typeof id !== 'number')) {
        return res.status(400).json({ error: 'contactIds must be strings or numbers' });
      }
    }

    // Validate that all contactIds belong to the authenticated user
    const allContactIds = [];
    for (const fix of fixes) {
      if (Array.isArray(fix.contactIds)) allContactIds.push(...fix.contactIds);
      if (fix.contactId) allContactIds.push(fix.contactId);
      if (Array.isArray(fix.contacts)) {
        for (const c of fix.contacts) { if (c.id) allContactIds.push(c.id); }
      }
    }
    if (allContactIds.length > 0) {
      const uniqueIds = [...new Set(allContactIds)];
      const placeholders = uniqueIds.map((_, i) => `$${i + 2}`).join(',');
      const owned = await db.query(
        `SELECT id FROM opportunities WHERE user_id = $1 AND id IN (${placeholders})`,
        [req.user.id, ...uniqueIds]
      );
      const ownedSet = new Set(owned.rows.map(r => r.id));
      const filtered = uniqueIds.filter(id => !ownedSet.has(id));
      if (filtered.length > 0) {
        console.warn(`[SECURITY] User ${req.user.id} tried to clean ${filtered.length} contacts they don't own: ${filtered.join(', ')}`);
        // Remove unauthorized contactIds from fixes
        for (const fix of fixes) {
          if (Array.isArray(fix.contactIds)) fix.contactIds = fix.contactIds.filter(id => ownedSet.has(id));
          if (fix.contactId && !ownedSet.has(fix.contactId)) fix.contactId = null;
          if (Array.isArray(fix.contacts)) fix.contacts = fix.contacts.filter(c => ownedSet.has(c.id));
        }
      }
    }

    const result = await crmCleaning.applyFixes(req.user.id, provider, fixes);

    // Update report if provided
    if (reportId) {
      await db.crmCleaningReports.update(reportId, {
        status: result.errors.length === 0 ? 'resolved' : 'partially_fixed',
        fixesApplied: result,
      });
    }

    // Invalidate the cached scan for this provider regardless — a fix just changed contact
    // data (caps corrected, contact archived/deleted, emails verified), so the next scan read
    // (e.g. Data Quality's Duplicates tab, which doesn't pass reportId) must not keep serving
    // the pre-fix snapshot.
    await db.query(`DELETE FROM crm_cleaning_reports WHERE user_id = $1 AND provider = $2`, [req.user.id, provider]);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/cleaning-reports — List user's cleaning reports
router.get('/cleaning-reports', async (req, res, next) => {
  try {
    const reports = await db.crmCleaningReports.listByUser(req.user.id);
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/enrich — Enrich contacts with missing data via web search
router.post('/enrich', async (req, res, next) => {
  try {
    const { issueType = 'all', contactIds, limit = 20 } = req.body;
    const { enrichContacts } = require('../lib/enrich-agent');
    const result = await enrichContacts(req.user.id, issueType, { contactIds, limit: Math.min(limit, 50) });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/crm/bulk-update — Update multiple contacts at once
router.post('/bulk-update', async (req, res, next) => {
  try {
    const { ids, update } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (!update || typeof update !== 'object') {
      return res.status(400).json({ error: 'update object is required' });
    }
    // Only allow safe fields
    const allowed = ['status'];
    const safeUpdate = {};
    for (const key of allowed) {
      if (update[key] !== undefined) safeUpdate[key] = update[key];
    }
    if (Object.keys(safeUpdate).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    const setClauses = Object.keys(safeUpdate).map((k, i) => `${k} = $${i + 3}`);
    const values = [req.user.id, ids, ...Object.values(safeUpdate)];
    await db.query(
      `UPDATE opportunities SET ${setClauses.join(', ')}, updated_at = NOW() WHERE user_id = $1 AND id = ANY($2)`,
      values
    );
    res.json({ updated: ids.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/bulk-delete — Delete multiple contacts
router.post('/bulk-delete', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    await db.query(
      `DELETE FROM opportunities WHERE user_id = $1 AND id = ANY($2)`,
      [req.user.id, ids]
    );
    res.json({ deleted: ids.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/crm/import/:provider — Import contacts/deals FROM CRM INTO Baakalai
router.post('/import/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const token = await getUserCrmToken(req.user.id, provider);
    if (!token) return res.status(400).json({ error: `${provider} not connected` });

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    if (provider === 'pipedrive') {
      const persons = await pipedrive.listAllPersons(token);

      for (const raw of (persons || [])) {
        try {
          const email = Array.isArray(raw.email)
            ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
            : (raw.email || null);

          if (!email) { skipped++; continue; }

          // Check if already imported
          const existing = await db.opportunities.findByEmail(req.user.id, email, provider);
          if (existing) { skipped++; continue; }

          await db.opportunities.create({
            userId: req.user.id,
            name: raw.name || 'Unknown',
            email,
            title: raw.job_title || null,
            company: raw.org_name || raw.org_id?.name || null,
            status: 'imported',
            crmProvider: 'pipedrive',
            crmContactId: String(raw.id),
            lastActivityAt: extractActivityDate(provider, raw),
          });
          imported++;
        } catch (err) {
          errors.push({ name: raw.name, error: err.message });
        }
      }
    } else if (provider === 'odoo') {
      let creds;
      try { creds = JSON.parse(token); } catch { return res.status(400).json({ error: 'Odoo credentials invalid' }); }

      const contacts = await odoo.listAllContacts(creds);
      for (const raw of contacts) {
        try {
          if (!raw.email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, raw.email, provider);
          if (existing) { skipped++; continue; }
          await db.opportunities.create({
            userId: req.user.id,
            name: raw.name || 'Unknown',
            email: raw.email,
            title: raw.function || null,
            company: raw.company_name || (raw.parent_id ? raw.parent_id[1] : null),
            status: 'imported',
            crmProvider: 'odoo',
            crmContactId: String(raw.id),
            lastActivityAt: extractActivityDate(provider, raw),
          });
          imported++;
        } catch (err) {
          errors.push({ name: raw.name, error: err.message });
        }
      }
    } else if (provider === 'salesforce') {
      const integration = await db.query(
        `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
      );
      const instanceUrl = integration.rows[0]?.instance_url;
      if (!instanceUrl) throw new Error('Salesforce instance URL not configured');
      const sf = require('../api/salesforce');
      const contacts = await sf.listContacts(instanceUrl, token);

      for (const raw of contacts) {
        try {
          if (!raw.email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, raw.email, provider);
          if (existing) { skipped++; continue; }
          await db.opportunities.create({
            userId: req.user.id,
            name: raw.name || 'Unknown',
            email: raw.email,
            title: raw.title || null,
            company: raw.company || null,
            status: 'imported',
            crmProvider: 'salesforce',
            crmContactId: String(raw.id),
            lastActivityAt: extractActivityDate(provider, raw),
            crmOwnerId: raw.ownerId || null,
          });
          imported++;
        } catch (err) { errors.push({ name: raw.name, error: err.message }); }
      }
    } else if (provider === 'hubspot') {
      // Les trois dernières propriétés portent la récence commerciale : sans
      // elles aucun deal ne peut être détecté dormant (lib/crm-activity-date.js).
      const res2 = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=500&properties=email,firstname,lastname,jobtitle,company,hs_last_sales_activity_timestamp,notes_last_contacted,lastmodifieddate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res2.ok) {
        const errBody = await res2.text().catch(() => '');
        return res.status(502).json({ error: `HubSpot API ${res2.status}: ${errBody.slice(0, 200)}` });
      }
      const data = await res2.json();
      for (const c of (data.results || [])) {
        try {
          const email = c.properties?.email;
          if (!email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, email, provider);
          if (existing) { skipped++; continue; }
          await db.opportunities.create({
            userId: req.user.id,
            name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim() || 'Unknown',
            email,
            title: c.properties?.jobtitle || null,
            company: c.properties?.company || null,
            status: 'imported',
            crmProvider: 'hubspot',
            crmContactId: String(c.id),
            lastActivityAt: extractActivityDate(provider, c),
          });
          imported++;
        } catch (err) { errors.push({ error: err.message }); }
      }
    } else if (provider === 'notion') {
      const integration = await db.userIntegrations.get(req.user.id, 'notion');
      if (!integration) return res.status(400).json({ error: 'Notion not connected' });
      const notionToken = decrypt(integration.access_token);
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      const databaseId = metadata.database_id;
      if (!databaseId) return res.status(400).json({ error: 'Notion database not selected. Configure it in Settings.' });

      const contacts = await notionCrm.queryContacts(notionToken, databaseId);
      for (const raw of contacts) {
        try {
          // Dans une base CRM Notion, la propriété title est souvent
          // l'entreprise ; la personne vit dans « Contact Principal ».
          const company = raw.company || raw.name || null;
          const name = raw.contact || raw.name || raw.company || 'Unknown';
          const email = raw.email || null;
          if (!email) { skipped++; continue; }

          const lastActivityAt = extractActivityDate(provider, raw);
          const statusNorm = notionCrm.normalizeNotionStatus(raw.status);
          const dealValue = typeof raw.dealValue === 'number' ? raw.dealValue : null;

          const existing = await db.opportunities.findByEmail(req.user.id, email, provider);
          if (existing) {
            const updates = {};
            // Monotone : une resynchronisation ne fait jamais rajeunir un deal.
            if (lastActivityAt && (!existing.last_activity_at
                || new Date(lastActivityAt) > new Date(existing.last_activity_at))) {
              updates.lastActivityAt = lastActivityAt;
            }
            if (dealValue != null && Number(existing.deal_value || 0) !== dealValue) {
              updates.dealValue = dealValue;
            }
            if (raw.contact && raw.contact !== existing.name) updates.name = raw.contact;
            if (company && company !== existing.company) updates.company = company;
            if (statusNorm && statusNorm !== existing.status) {
              updates.status = statusNorm;
              if (statusNorm === 'won' && !existing.won_date) {
                updates.wonDate = lastActivityAt || new Date().toISOString();
              }
              if (statusNorm === 'lost' && !existing.lost_date) {
                updates.lostDate = lastActivityAt || new Date().toISOString();
              }
            }
            if (Object.keys(updates).length > 0) {
              await db.opportunities.update(existing.id, updates);
              updated++;
            } else skipped++;
            continue;
          }

          await db.opportunities.create({
            userId: req.user.id,
            name,
            email,
            title: raw.title || null,
            company,
            status: statusNorm || 'imported',
            crmProvider: 'notion',
            crmContactId: raw.notionPageId || null,
            lastActivityAt,
            dealValue,
            wonDate: statusNorm === 'won' ? (lastActivityAt || new Date().toISOString()) : null,
            lostDate: statusNorm === 'lost' ? (lastActivityAt || new Date().toISOString()) : null,
          });
          imported++;
        } catch (err) { errors.push({ name: raw.name, error: err.message }); }
      }
    } else if (provider === 'airtable') {
      const integration = await db.userIntegrations.get(req.user.id, 'airtable');
      if (!integration) return res.status(400).json({ error: 'Airtable not connected' });
      const airtableKey = decrypt(integration.access_token);
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      if (!metadata.base_id || !metadata.table_name) return res.status(400).json({ error: 'Airtable base/table not configured. Set it in Settings.' });

      const contacts = await airtableCrm.listRecords(airtableKey, metadata.base_id, metadata.table_name);
      for (const raw of contacts) {
        try {
          const email = raw.email || null;
          if (!email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, email, provider);
          if (existing) { skipped++; continue; }
          await db.opportunities.create({
            userId: req.user.id,
            name: raw.name || 'Unknown',
            email,
            title: raw.title || null,
            company: raw.company || null,
            status: 'imported',
            crmProvider: 'airtable',
            crmContactId: raw.airtableRecordId || null,
            lastActivityAt: extractActivityDate(provider, raw),
          });
          imported++;
        } catch (err) { errors.push({ name: raw.name, error: err.message }); }
      }
    } else {
      return res.status(400).json({ error: `Import not yet supported for ${provider}` });
    }

    track(req.user.id, 'import_done', { provider, imported, updated, skipped });
    res.json({ imported, updated, skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    track(req.user.id, 'import_failed', { provider: req.params.provider, error: String(err.message).slice(0, 200) });
    next(err);
  }
});

// GET /api/crm/pipedrive/pipelines — List Pipedrive pipelines
router.get('/pipedrive/pipelines', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'pipedrive');
    if (!token) return res.status(400).json({ error: 'Pipedrive not connected' });
    const pipelines = await pipedrive.getPipelines(token);
    res.json({ pipelines });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/pipedrive/stages/:pipelineId — List stages for a pipeline
router.get('/pipedrive/stages/:pipelineId', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'pipedrive');
    if (!token) return res.status(400).json({ error: 'Pipedrive not connected' });
    const stages = await pipedrive.getStages(token, req.params.pipelineId);
    res.json({ stages });
  } catch (err) {
    next(err);
  }
});

// ── Salesforce-specific routes ──

// GET /api/crm/salesforce/campaigns — List Salesforce campaigns
router.get('/salesforce/campaigns', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const campaigns = await sf.listCampaigns(instanceUrl, token);
    res.json({ campaigns });
  } catch (err) { next(err); }
});

// GET /api/crm/salesforce/campaigns/:id/members — List campaign members
router.get('/salesforce/campaigns/:id/members', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const members = await sf.getCampaignMembers(instanceUrl, token, req.params.id);
    res.json({ members });
  } catch (err) { next(err); }
});

// POST /api/crm/salesforce/campaigns — Create a Salesforce campaign
router.post('/salesforce/campaigns', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const result = await sf.createCampaign(instanceUrl, token, req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// POST /api/crm/salesforce/campaigns/:id/add-member — Add contact to campaign
router.post('/salesforce/campaigns/:id/add-member', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const result = await sf.addToCampaign(instanceUrl, token, req.params.id, req.body.contactId, req.body.status);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ── Salesforce Email Messages (Fonteva / transactional) ──

// GET /api/crm/salesforce/emails — List email messages (Fonteva + SF transactional)
router.get('/salesforce/emails', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const emails = await sf.getEmailMessages(instanceUrl, token, {
      contactEmail: req.query.email || undefined,
      contactId: req.query.contactId || undefined,
      limit: parseInt(req.query.limit) || 200,
      since: req.query.since || undefined,
    });
    res.json({ emails });
  } catch (err) { next(err); }
});

// GET /api/crm/salesforce/email-stats — Aggregated email stats
router.get('/salesforce/email-stats', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const stats = await sf.getEmailMessageStats(instanceUrl, token, {
      since: req.query.since || 'LAST_N_DAYS:90',
    });
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /api/crm/salesforce/contact-emails/:email — Email activity for a specific contact
router.get('/salesforce/contact-emails/:email', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'salesforce');
    if (!token) return res.status(400).json({ error: 'Salesforce not connected' });
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) return res.status(400).json({ error: 'Salesforce instance URL not configured' });

    const sf = require('../api/salesforce');
    const emails = await sf.getContactEmailActivity(instanceUrl, token, req.params.email);
    res.json({ emails });
  } catch (err) { next(err); }
});

// ── Odoo-specific routes ──

// GET /api/crm/odoo/stages — List CRM stages
router.get('/odoo/stages', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'odoo');
    if (!token) return res.status(400).json({ error: 'Odoo not connected' });
    let creds;
    try { creds = JSON.parse(token); } catch { return res.status(400).json({ error: 'Odoo credentials invalid' }); }
    const stages = await odoo.getStages(creds);
    res.json({ stages });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/odoo/invoices — List invoices (optionally for a contact)
router.get('/odoo/invoices', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'odoo');
    if (!token) return res.status(400).json({ error: 'Odoo not connected' });
    let creds;
    try { creds = JSON.parse(token); } catch { return res.status(400).json({ error: 'Odoo credentials invalid' }); }
    const contactId = req.query.contactId ? parseInt(req.query.contactId, 10) : null;
    const invoices = await odoo.getInvoices(creds, { contactId });
    res.json({ invoices });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/odoo/deals — List CRM deals/opportunities
router.get('/odoo/deals', async (req, res, next) => {
  try {
    const token = await getUserCrmToken(req.user.id, 'odoo');
    if (!token) return res.status(400).json({ error: 'Odoo not connected' });
    let creds;
    try { creds = JSON.parse(token); } catch { return res.status(400).json({ error: 'Odoo credentials invalid' }); }
    const deals = await odoo.getDeals(creds);
    res.json({ deals });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/client/search?q=... — Fuzzy name/email/company search (general assistant's
// lookup_client action). Must stay registered BEFORE /client/:id below — both match a single
// path segment, and Express tries routes in registration order, so /client/search would
// otherwise be swallowed by /client/:id with id="search".
router.get('/client/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ clients: [] });
    const clients = await db.opportunities.search(req.user.id, q, 8);
    res.json({ clients });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/client/:id — Get full client detail (opportunity + nurture emails + CRM activities)
router.get('/client/:id', async (req, res, next) => {
  try {
    const opp = await db.opportunities.get(req.params.id);
    if (!opp) return res.status(404).json({ error: 'Client not found' });
    if (opp.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    // Get nurture emails for this contact
    const emails = await db.query(
      `SELECT id, subject, body, status, sent_at, trigger_id, created_at
       FROM nurture_emails WHERE opportunity_id = $1 OR to_email = $2
       ORDER BY created_at DESC LIMIT 20`,
      [opp.id, opp.email]
    );

    // Get CRM activities based on provider
    let crmActivities = [];
    let invoices = [];
    if (opp.crm_contact_id) {
      try {
        const token = await getUserCrmToken(req.user.id, opp.crm_provider);
        if (token && opp.crm_provider === 'pipedrive') {
          crmActivities = await pipedrive.getActivities(token, parseInt(opp.crm_contact_id, 10));
        } else if (token && opp.crm_provider === 'salesforce') {
          const sf = require('../api/salesforce');
          const integration = await db.query(`SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]);
          const instanceUrl = integration.rows[0]?.instance_url;
          if (!instanceUrl) throw new Error('Salesforce instance URL not configured');
          crmActivities = await sf.getActivities(instanceUrl, token, opp.crm_contact_id);
        } else if (token && opp.crm_provider === 'odoo') {
          let creds;
          try { creds = JSON.parse(token); } catch { creds = null; }
          if (creds) {
            crmActivities = await odoo.getActivities(creds, parseInt(opp.crm_contact_id, 10));
            invoices = await odoo.getInvoices(creds, { contactId: parseInt(opp.crm_contact_id, 10) });
          }
        }
      } catch { /* ignore */ }
    }

    res.json({
      client: opp,
      emails: emails.rows,
      crmActivities,
      invoices,
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// POST /api/crm/churn/score — Run churn scoring for current user
// =============================================
router.post('/churn/score', async (req, res, next) => {
  try {
    const { scoreAllForUser } = require('../lib/churn-scoring');
    const { getUserKey } = require('../config');

    // Try to get deals from connected CRM for better scoring
    let deals = [];
    for (const provider of ['pipedrive', 'salesforce', 'hubspot']) {
      const token = await getUserKey(req.user.id, provider);
      if (!token) continue;
      try {
        if (provider === 'pipedrive') deals = await pipedrive.getDeals(token, 500);
        else if (provider === 'salesforce') {
          const sf = require('../api/salesforce');
          const integ = await db.query(`SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]);
          const sfInstanceUrl = integ.rows[0]?.instance_url;
          if (!sfInstanceUrl) throw new Error('Salesforce instance URL not configured');
          deals = await sf.getDeals(sfInstanceUrl, token);
        }
        break;
      } catch { /* scoring works without deals */ }
    }

    const result = await scoreAllForUser(req.user.id, { deals });
    res.json(result);
  } catch (err) { next(err); }
});

// =============================================
// GET /api/crm/churn/summary — Get churn risk summary
// =============================================
router.get('/churn/summary', async (req, res, next) => {
  try {
    // Churn risk is a retention concept scoped to won clients — an active deal isn't a client
    // yet, so it must never be counted here (see ChurnPage.jsx / ClientsPage.jsx for the
    // matching frontend filters).
    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE churn_score >= 76) AS critical,
        COUNT(*) FILTER (WHERE churn_score >= 51 AND churn_score < 76) AS high,
        COUNT(*) FILTER (WHERE churn_score >= 26 AND churn_score < 51) AS medium,
        COUNT(*) FILTER (WHERE churn_score < 26 OR churn_score IS NULL) AS low,
        COUNT(*) FILTER (WHERE churn_score IS NOT NULL) AS scored,
        ROUND(AVG(churn_score) FILTER (WHERE churn_score IS NOT NULL)) AS avg_score
      FROM opportunities WHERE user_id = $1 AND status = 'won'`,
      [req.user.id]
    );
    const row = result.rows[0] || {};
    res.json({
      critical: parseInt(row.critical) || 0,
      high: parseInt(row.high) || 0,
      medium: parseInt(row.medium) || 0,
      low: parseInt(row.low) || 0,
      scored: parseInt(row.scored) || 0,
      avgScore: parseInt(row.avg_score) || 0,
    });
  } catch (err) { next(err); }
});

// =============================================
// GET /api/crm/team-owners — List team members with their contact counts
// =============================================
router.get('/team-owners', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        u.id, u.name, u.email, tm.role,
        COUNT(o.id) AS contact_count
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      LEFT JOIN opportunities o ON o.owner_id = tm.user_id
      WHERE tm.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)
      GROUP BY u.id, u.name, u.email, tm.role
      ORDER BY contact_count DESC
    `, [req.user.id]);
    res.json({ owners: result.rows });
  } catch (err) { next(err); }
});

// =============================================
// Product Lines (verticals / multi-product support)
// =============================================

// GET /api/crm/product-lines — List product lines for the team
router.get('/product-lines', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT pl.*, COUNT(opl.opportunity_id) AS contact_count
      FROM product_lines pl
      LEFT JOIN opportunity_product_lines opl ON opl.product_line_id = pl.id
      WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)
      GROUP BY pl.id
      ORDER BY pl.name
    `, [req.user.id]);
    res.json({ productLines: result.rows });
  } catch (err) { next(err); }
});

// POST /api/crm/product-lines — Create a product line
router.post('/product-lines', async (req, res, next) => {
  try {
    const { name, description, icon, targetSectors, valueProp, painPoints } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    let teamResult = await db.query(
      `SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1`, [req.user.id]
    );
    let teamId = teamResult.rows[0]?.team_id;

    // Auto-create a team for solo users who don't have one yet
    if (!teamId) {
      const user = await db.query(`SELECT name, email FROM users WHERE id = $1`, [req.user.id]);
      const userName = user.rows[0]?.name || user.rows[0]?.email?.split('@')[0] || 'My Team';
      const team = await db.query(
        `INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id`,
        [`${userName}'s Team`, req.user.id]
      );
      teamId = team.rows[0].id;
      await db.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`,
        [teamId, req.user.id]
      );
    }

    const result = await db.query(
      `INSERT INTO product_lines (team_id, name, description, icon, target_sectors, value_prop, pain_points)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [teamId, name, description || null, icon || null, targetSectors || null, valueProp || null, painPoints || null]
    );
    res.json({ productLine: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/crm/product-lines/:id — Update a product line
router.patch('/product-lines/:id', async (req, res, next) => {
  try {
    const { name, description, icon, targetSectors, valueProp, painPoints } = req.body;
    const result = await db.query(
      `UPDATE product_lines SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        icon = COALESCE($3, icon),
        target_sectors = COALESCE($4, target_sectors),
        value_prop = COALESCE($5, value_prop),
        pain_points = COALESCE($6, pain_points)
       WHERE id = $7 AND team_id = (SELECT team_id FROM team_members WHERE user_id = $8 LIMIT 1)
       RETURNING *`,
      [name, description, icon, targetSectors, valueProp, painPoints, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ productLine: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/crm/product-lines/:id
router.delete('/product-lines/:id', async (req, res, next) => {
  try {
    // Verify team membership
    const result = await db.query(
      `DELETE FROM product_lines WHERE id = $1 AND team_id = (SELECT team_id FROM team_members WHERE user_id = $2 LIMIT 1) RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rowCount === 0) return res.status(403).json({ error: 'Access denied' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/crm/product-lines/:id/assign — Assign contacts to a product line
router.post('/product-lines/:id/assign', async (req, res, next) => {
  try {
    const { opportunityIds } = req.body;
    if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
      return res.status(400).json({ error: 'opportunityIds array required' });
    }
    // Validate opportunity ownership
    const validOpps = await db.query(
      `SELECT id FROM opportunities WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [req.user.id, opportunityIds]
    );
    const validIds = new Set(validOpps.rows.map(r => r.id));
    const filtered = opportunityIds.filter(id => validIds.has(id));

    for (const oppId of filtered) {
      await db.query(
        `INSERT INTO opportunity_product_lines (opportunity_id, product_line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [oppId, req.params.id]
      );
    }
    res.json({ assigned: filtered.length });
  } catch (err) { next(err); }
});

// POST /api/crm/product-lines/:id/unassign — Remove contacts from a product line
router.post('/product-lines/:id/unassign', async (req, res, next) => {
  try {
    const { opportunityIds } = req.body;
    if (!Array.isArray(opportunityIds) || opportunityIds.length === 0) {
      return res.status(400).json({ error: 'opportunityIds array required' });
    }
    for (const oppId of opportunityIds) {
      await db.query(
        `DELETE FROM opportunity_product_lines WHERE opportunity_id = $1 AND product_line_id = $2`,
        [oppId, req.params.id]
      );
    }
    res.json({ removed: opportunityIds.length });
  } catch (err) { next(err); }
});

// GET /api/crm/client/:id/timeline — Unified activity timeline
router.get('/client/:id/timeline', async (req, res, next) => {
  try {
    const opp = await db.opportunities.get(req.params.id);
    if (!opp) return res.status(404).json({ error: 'Client not found' });
    if (opp.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const timeline = [];

    // 1. Nurture emails
    const emails = await db.query(
      `SELECT id, subject, status, sent_at, created_at
       FROM nurture_emails WHERE opportunity_id = $1 OR to_email = $2
       ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 50`,
      [opp.id, opp.email]
    );
    for (const e of emails.rows) {
      timeline.push({
        type: 'email_sent',
        date: e.sent_at || e.created_at,
        subject: e.subject,
        status: e.status,
        source: 'nurture',
        id: e.id,
      });
    }

    // 2. Campaign activities (prospect_activities by email)
    if (opp.email) {
      const activities = await db.query(
        `SELECT pa.id, pa.type, pa.happened_at, pa.source, c.name AS campaign_name
         FROM prospect_activities pa
         LEFT JOIN campaigns c ON c.id = pa.campaign_id
         WHERE pa.lead_email = $1 AND pa.user_id = $2
         ORDER BY pa.happened_at DESC LIMIT 50`,
        [opp.email, req.user.id]
      );
      const eventMap = {
        emailsOpened: 'open', emailsClicked: 'click', emailsReplied: 'reply',
        emailsBounced: 'bounce', emailsUnsubscribed: 'unsubscribe',
      };
      for (const a of activities.rows) {
        timeline.push({
          type: 'campaign_activity',
          date: a.happened_at,
          campaign_name: a.campaign_name || 'Unknown campaign',
          event: eventMap[a.type] || a.type,
          source: a.source || 'lemlist',
          id: a.id,
        });
      }
    }

    // 3. CRM activities (from connected CRM provider)
    if (opp.crm_contact_id) {
      try {
        const token = await getUserCrmToken(req.user.id, opp.crm_provider);
        let crmActivities = [];
        if (token && opp.crm_provider === 'pipedrive') {
          crmActivities = await pipedrive.getActivities(token, parseInt(opp.crm_contact_id, 10));
        } else if (token && opp.crm_provider === 'salesforce') {
          const sf = require('../api/salesforce');
          const integration = await db.query(`SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [req.user.id]);
          const instanceUrl = integration.rows[0]?.instance_url;
          if (instanceUrl) crmActivities = await sf.getActivities(instanceUrl, token, opp.crm_contact_id);
        } else if (token && opp.crm_provider === 'odoo') {
          let creds;
          try { creds = JSON.parse(token); } catch { creds = null; }
          if (creds) crmActivities = await odoo.getActivities(creds, parseInt(opp.crm_contact_id, 10));
        }
        for (const a of crmActivities) {
          timeline.push({
            type: 'crm_activity',
            date: a.dueDate || a.date || a.update_time,
            subject: a.subject || a.summary || '',
            activity_type: a.type || 'note',
            done: a.done || false,
            source: opp.crm_provider,
            id: a.id,
          });
        }
      } catch { /* CRM activities are best-effort */ }
    }

    // Sort by date descending, limit to 50
    timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    res.json({ timeline: timeline.slice(0, 50) });
  } catch (err) {
    next(err);
  }
});

// GET /api/crm/client/:id/product-lines — Get product lines for a contact
router.get('/client/:id/product-lines', async (req, res, next) => {
  try {
    const opp = await db.query(`SELECT id FROM opportunities WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!opp.rows.length) return res.status(404).json({ error: 'Contact not found' });

    const result = await db.query(`
      SELECT pl.* FROM product_lines pl
      JOIN opportunity_product_lines opl ON opl.product_line_id = pl.id
      WHERE opl.opportunity_id = $1
      ORDER BY pl.name
    `, [req.params.id]);
    res.json({ productLines: result.rows });
  } catch (err) { next(err); }
});

// =============================================
// CRM Field Mappings
// =============================================

// GET /api/crm/fields/:provider — Fetch available CRM fields
router.get('/fields/:provider', async (req, res, next) => {
  try {
    const { fetchCrmFields } = require('../lib/crm-field-mapper');
    const { getUserKey } = require('../config');
    const provider = req.params.provider;
    let credentials = await getUserKey(req.user.id, provider);
    if (!credentials) return res.status(400).json({ error: `${provider} not connected` });

    // Salesforce needs instanceUrl + accessToken
    if (provider === 'salesforce') {
      const integration = await db.query(
        `SELECT access_token, instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`,
        [req.user.id]
      );
      if (!integration.rows[0]) return res.status(400).json({ error: 'Salesforce not connected' });
      const { decrypt } = require('../config/crypto');
      credentials = {
        accessToken: decrypt(integration.rows[0].access_token),
        instanceUrl: integration.rows[0].instance_url,
      };
    }

    const fields = await fetchCrmFields(provider, credentials);
    res.json({ fields });
  } catch (err) { next(err); }
});

// GET /api/crm/mappings — Get saved field mappings
router.get('/mappings', async (req, res, next) => {
  try {
    const { getMappings } = require('../lib/crm-field-mapper');
    const mappings = await getMappings(req.user.id);
    res.json({ mappings });
  } catch (err) { next(err); }
});

// POST /api/crm/mappings — Save a field mapping
router.post('/mappings', async (req, res, next) => {
  try {
    const { saveMapping } = require('../lib/crm-field-mapper');
    const { crmProvider, crmField, crmFieldName, baakalaiField, mappingValues } = req.body;
    if (!crmProvider || !crmField || !baakalaiField) {
      return res.status(400).json({ error: 'crmProvider, crmField, and baakalaiField are required' });
    }
    const id = await saveMapping(req.user.id, { crmProvider, crmField, crmFieldName, baakalaiField, mappingValues });
    res.json({ id });
  } catch (err) { next(err); }
});

// DELETE /api/crm/mappings/:id — Delete a mapping
router.delete('/mappings/:id', async (req, res, next) => {
  try {
    const { deleteMapping } = require('../lib/crm-field-mapper');
    await deleteMapping(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================
// Auto-import helper (used by first-diagnostic)
// =============================================
async function importContactsForUser(userId, provider) {
  const token = await getUserCrmToken(userId, provider);
  if (!token && !['notion', 'airtable'].includes(provider)) return { imported: 0 };

  let contacts = [];

  if (provider === 'pipedrive') {
    const raw = await pipedrive.listAllPersons(token);
    contacts = (raw || []).map(r => ({
      name: r.name || 'Unknown',
      email: Array.isArray(r.email) ? (r.email.find(e => e.primary)?.value || r.email[0]?.value || null) : (r.email || null),
      title: r.job_title || null,
      company: r.org_name || r.org_id?.name || null,
      crmContactId: String(r.id),
    }));
  } else if (provider === 'hubspot') {
    const raw = await hubspot.listAllContacts(token);
    contacts = (raw || []).map(r => ({
      name: r.name || 'Unknown',
      email: r.email || null,
      title: r.job_title || null,
      company: r.org_name || null,
      crmContactId: String(r.id),
    }));
  } else if (provider === 'odoo') {
    let creds;
    try { creds = JSON.parse(token); } catch { return { imported: 0 }; }
    const raw = await odoo.listAllContacts(creds);
    contacts = (raw || []).map(r => ({
      name: r.name || 'Unknown',
      email: r.email || null,
      title: r.function || null,
      company: r.company_name || (r.parent_id ? r.parent_id[1] : null),
      crmContactId: String(r.id),
    }));
  } else if (provider === 'salesforce') {
    const integration = await db.query(
      `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`, [userId]
    );
    const instanceUrl = integration.rows[0]?.instance_url;
    if (!instanceUrl) throw new Error('Salesforce instance URL not configured');
    const raw = await salesforce.listContacts(instanceUrl, token);
    contacts = (raw || []).map(r => ({
      name: r.name || 'Unknown',
      email: r.email || null,
      title: r.title || null,
      company: r.company || null,
      crmContactId: String(r.id),
      crmOwnerId: r.ownerId || null,
    }));
  } else if (provider === 'notion') {
    const integration = await db.userIntegrations.get(userId, 'notion');
    if (!integration) return { imported: 0 };
    const notionToken = decrypt(integration.access_token);
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    if (!metadata.database_id) return { imported: 0 };
    const raw = await notionCrm.queryContacts(notionToken, metadata.database_id);
    contacts = (raw || []).map(r => ({
      name: r.name || r.company || 'Unknown',
      email: r.email || null,
      title: r.title || null,
      company: r.company || null,
      crmContactId: r.notionPageId || null,
    }));
  } else if (provider === 'airtable') {
    const integration = await db.userIntegrations.get(userId, 'airtable');
    if (!integration) return { imported: 0 };
    const airtableKey = decrypt(integration.access_token);
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    if (!metadata.base_id || !metadata.table_name) return { imported: 0 };
    const raw = await airtableCrm.listRecords(airtableKey, metadata.base_id, metadata.table_name);
    contacts = (raw || []).map(r => ({
      name: r.name || 'Unknown',
      email: r.email || null,
      title: r.title || null,
      company: r.company || null,
      crmContactId: r.airtableRecordId || null,
    }));
  }

  let imported = 0;
  for (const c of contacts) {
    if (!c.email) continue;
    try {
      const existing = await db.opportunities.findByEmail(userId, c.email, provider);
      if (existing) continue;
      await db.opportunities.create({
        userId,
        name: c.name,
        email: c.email,
        title: c.title,
        company: c.company,
        status: 'imported',
        crmProvider: provider,
        crmContactId: c.crmContactId,
        crmOwnerId: c.crmOwnerId || null,
      });
      imported++;
    } catch { /* skip individual failures */ }
  }
  return { imported };
}

// =============================================
// POST /api/crm/first-diagnostic — Run full CRM diagnostic after first import
// Returns: health scan + deal coach + churn summary + quick stats
// =============================================
router.post('/first-diagnostic', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Use active CRM, fallback to auto-detect
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [userId]);
    let connectedProvider = userRow.rows[0]?.active_crm_provider || null;
    if (!connectedProvider) {
      const { getUserKey } = require('../config');
      for (const p of ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable']) {
        const key = await getUserKey(userId, p);
        if (key) { connectedProvider = p; break; }
      }
    }

    // Load contacts — auto-import if DB is empty but CRM is connected
    let opps = await db.opportunities.listByUser(userId, 500);
    if (opps.length === 0 && connectedProvider) {
      try {
        await importContactsForUser(userId, connectedProvider);
        opps = await db.opportunities.listByUser(userId, 500);
      } catch (importErr) {
        console.error('[first-diagnostic] auto-import failed:', importErr.message);
      }
    }

    // Run scan + churn + deal coach in parallel
    const [scanResult, churnResult, dealCoachResult] = await Promise.all([
      // 1. CRM Health Scan
      connectedProvider
        ? require('../lib/crm-cleaning-agent').scanCRM(userId, connectedProvider).catch(err => ({ score: null, error: err.message }))
        : Promise.resolve({ score: null, skipped: true }),

      // 2. Churn scoring
      require('../lib/churn-scoring').scoreAllForUser(userId).catch(err => ({ error: err.message })),

      // 3. Deal Coach (top stagnant deals)
      opps.length >= 3
        ? require('../lib/agents/deal-coach').run(userId).catch(err => ({ suggestions: [], error: err.message }))
        : Promise.resolve({ suggestions: [], skipped: true }),
    ]);

    // 4. Quick stats from imported contacts
    const totalContacts = opps.length;
    const statusCounts = {};
    const companyCounts = {};
    let withEmail = 0;
    let withCompany = 0;

    for (const o of opps) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
      if (o.email) withEmail++;
      if (o.company) {
        withCompany++;
        companyCounts[o.company] = (companyCounts[o.company] || 0) + 1;
      }
    }

    const topCompanies = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // 5. Churn summary
    let churnSummary = { critical: 0, high: 0, medium: 0, low: 0 };
    if (!churnResult?.error) {
      const freshOpps = await db.opportunities.listByUser(userId, 500);
      for (const o of freshOpps) {
        const s = o.churn_score || 0;
        if (s >= 76) churnSummary.critical++;
        else if (s >= 51) churnSummary.high++;
        else if (s >= 26) churnSummary.medium++;
        else churnSummary.low++;
      }
    }

    res.json({
      provider: connectedProvider,
      contacts: {
        total: totalContacts,
        withEmail,
        withCompany,
        byStatus: statusCounts,
        topCompanies,
      },
      health: scanResult?.error ? null : {
        score: scanResult.score,
        totalContacts: scanResult.totalContacts,
        issues: (scanResult.issues || []).slice(0, 8),
        summary: scanResult.summary,
      },
      churn: churnSummary,
      dealCoach: {
        suggestions: (dealCoachResult.suggestions || []).slice(0, 5),
        coached: dealCoachResult.coached || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// POST /api/crm/auto-clean — Auto-fix safe CRM issues (no thread required)
// =============================================
router.post('/auto-clean', cleanLimit, async (req, res, next) => {
  try {
    const { getUserKey } = require('../config');
    const { scanCRM, applyFixes } = require('../lib/crm-cleaning-agent');

    const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
    let provider = null;
    for (const p of providers) {
      const key = await getUserKey(req.user.id, p);
      if (key) { provider = p; break; }
    }
    if (!provider) return res.json({ error: 'No CRM connected', applied: 0 });

    const scan = await scanCRM(req.user.id, provider);
    if (!scan.issues || scan.issues.length === 0) {
      return res.json({ score: scan.score, applied: 0, message: 'No issues found' });
    }

    // Auto-fix only truly safe issues (formatting only)
    const safeFixes = [];
    const reviewItems = [];
    for (const issue of scan.issues) {
      if (issue.type === 'format_name_caps' && issue.contacts?.length > 0) {
        safeFixes.push({ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts });
      } else if (issue.type === 'duplicate_email' && issue.contacts?.length >= 2) {
        // Duplicates require manual review — no auto-merge
        reviewItems.push({ type: issue.type, action: 'review', contacts: issue.contacts });
      } else if (issue.type === 'invalid_email' && issue.contacts?.length > 0) {
        // Invalid emails require manual review — no auto-delete
        reviewItems.push({ type: issue.type, action: 'review', contacts: issue.contacts });
      }
    }

    let fixResult = { applied: 0, skipped: 0, errors: [] };
    if (safeFixes.length > 0) {
      fixResult = await applyFixes(req.user.id, provider, safeFixes);
    }

    res.json({
      score: scan.score,
      totalIssues: scan.issues.length,
      autoFixed: fixResult.applied,
      needsReview: reviewItems,
      remainingManual: scan.issues.length - safeFixes.length,
      issues: scan.issues.map(i => ({ type: i.type, count: i.count, suggestedAction: i.suggestedAction })),
    });
  } catch (err) {
    next(err);
  }
});

// Helper: get CRM token for any provider (with auto-refresh for Salesforce OAuth)
// Delegated to shared utility to avoid circular deps
const { getUserCrmToken } = require('../lib/crm-token');
const { extractActivityDate } = require('../lib/crm-activity-date');

// =============================================
// Autopilot settings
// =============================================

// GET /api/crm/autopilot/settings
router.get('/autopilot/settings', async (req, res, next) => {
  try {
    const { getAutopilotSettings } = require('../lib/conversation-autopilot');
    const settings = await getAutopilotSettings(req.user.id);
    res.json(settings);
  } catch (err) { next(err); }
});

// PATCH /api/crm/autopilot/settings — Enable/disable autopilot
router.patch('/autopilot/settings', async (req, res, next) => {
  try {
    const { enabled, maxTurns, channels } = req.body;
    const updates = {};
    if (enabled !== undefined) updates.autopilot_enabled = enabled;
    if (maxTurns !== undefined) updates.autopilot_max_turns = Math.min(Math.max(maxTurns, 1), 10);
    if (channels !== undefined) updates.autopilot_channels = channels;

    await db.query(
      `UPDATE users SET settings = COALESCE(settings, '{}')::jsonb || $1::jsonb WHERE id = $2`,
      [JSON.stringify(updates), req.user.id]
    );
    res.json({ ok: true, ...updates });
  } catch (err) { next(err); }
});

// PATCH /api/crm/autopilot/contact/:id — Enable/disable autopilot per contact
router.patch('/autopilot/contact/:id', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await db.query(
      `UPDATE opportunities SET autopilot_enabled = $1 WHERE id = $2 AND user_id = $3`,
      [enabled, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/crm/autopilot/queue — List pending/sent autopilot messages
router.get('/autopilot/queue', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT aq.*, o.name as contact_name, o.company
       FROM autopilot_queue aq
       LEFT JOIN opportunities o ON o.id = aq.opportunity_id
       WHERE aq.user_id = $1
       ORDER BY aq.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ queue: result.rows });
  } catch (err) { next(err); }
});

// DELETE /api/crm/autopilot/queue/:id — Cancel a pending autopilot message
router.delete('/autopilot/queue/:id', async (req, res, next) => {
  try {
    await db.query(
      `UPDATE autopilot_queue SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// =============================================
// Salesforce OAuth
// =============================================

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

const _sfOauthStates = new Map();

// Cleanup expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _sfOauthStates) {
    if (val.expiresAt < now) _sfOauthStates.delete(key);
  }
}, 300000).unref();

// GET /api/crm/salesforce/connect — Start Salesforce OAuth flow using client's own Connected App
router.get('/salesforce/connect', async (req, res, next) => {
  try {
    if (_sfOauthStates.size >= 1000) return res.status(429).json({ error: 'Too many pending OAuth requests' });

    // Connected App du client (DB) sinon app centrale Baakalai (env) —
    // le un-clic marche alors sans aucune intégration préexistante.
    const integration = await db.userIntegrations.get(req.user.id, 'salesforce');
    const metadata = typeof integration?.metadata === 'string' ? JSON.parse(integration.metadata) : (integration?.metadata || {});
    const creds = crmOauth.salesforceCredentials(metadata);
    if (!creds) {
      return res.status(400).json({ error: 'No Salesforce Connected App configured. Save your Consumer Key and Secret first.' });
    }
    const clientId = creds.clientId;

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Derive login host from stored instance URL
    let loginHost = 'login.salesforce.com';
    if (integration?.instance_url) {
      try {
        const host = new URL(integration.instance_url).hostname;
        if (/\.(my\.salesforce\.com|salesforce\.com|lightning\.force\.com)$/.test(host)) {
          loginHost = host;
        }
      } catch {}
    }

    _sfOauthStates.set(state, {
      userId: req.user.id,
      expiresAt: Date.now() + 600000,
      codeVerifier,
      loginHost,
      // Retour wizard vs settings : le wizard restaure son brouillon via
      // ?crm_connected=, comme pour hubspot/pipedrive.
      from: req.query.from === 'wizard' ? 'wizard' : 'settings',
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: APP_URL + '/api/crm/salesforce/callback',
      scope: 'api refresh_token',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    res.json({ url: `https://${loginHost}/services/oauth2/authorize?${params}` });
  } catch (err) { next(err); }
});

// GET /api/crm/salesforce/callback — Salesforce OAuth callback (public, no auth)
router.get('/salesforce/callback', async (req, res) => {
  logger.info('salesforce-oauth', `Callback hit: ${req.originalUrl}, APP_URL=${APP_URL}`);

  // États du diagnostic public (lead magnet, lib/oauth-states) : le refus
  // comme le succès repartent vers la landing, jamais vers /settings.
  const sharedStates = require('../lib/oauth-states');
  const LANDING_URL = process.env.LANDING_URL || 'https://baakal.ai';
  const diagData = req.query.state ? sharedStates.get(req.query.state) : null;
  const isDiagnostic = diagData && diagData.diagnostic && diagData.provider === 'salesforce';

  // Handle user denial or Salesforce error
  if (req.query.error) {
    logger.warn('salesforce-oauth', `OAuth error: ${req.query.error} — ${req.query.error_description || ''}`);
    if (isDiagnostic) {
      sharedStates.delete(req.query.state);
      return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=` + encodeURIComponent(req.query.error));
    }
    return res.redirect(APP_URL + '/settings?crm_error=' + encodeURIComponent(req.query.error));
  }

  const { code, state } = req.query;
  if (!code) {
    return res.redirect(APP_URL + '/settings?crm_error=missing_code');
  }

  if (isDiagnostic) {
    sharedStates.delete(state);
    if (diagData.expiresAt < Date.now()) {
      return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=expired`);
    }
    try {
      const creds = crmOauth.salesforceCredentials(null);
      if (!creds) return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=unavailable`);
      const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: APP_URL + '/api/crm/salesforce/callback',
          code_verifier: diagData.codeVerifier,
        }),
      });
      if (!tokenRes.ok) {
        logger.warn('salesforce-oauth', `Diagnostic token exchange failed: ${(await tokenRes.text()).slice(0, 200)}`);
        return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=token`);
      }
      const tokens = await tokenRes.json();
      // Une seule lecture avec le token, jamais stocké — seul le rapport reste.
      const { runOauthDiagnostic } = require('./public-diagnostic');
      const { id, ownerKey } = await runOauthDiagnostic('salesforce', tokens, diagData.lang);
      return res.redirect(`${LANDING_URL}/diagnostic?r=${id}&k=${ownerKey}`);
    } catch (err) {
      logger.error('salesforce-oauth', `Diagnostic salesforce failed: ${err.message}`);
      return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=failed`);
    }
  }

  const oauthData = _sfOauthStates.get(state);

  if (!oauthData || oauthData.expiresAt < Date.now()) {
    return res.redirect(APP_URL + '/settings?crm_error=invalid_state');
  }
  _sfOauthStates.delete(state);

  const tokenHost = oauthData.loginHost || 'login.salesforce.com';

  try {
    // Connected App du client (DB) sinon app centrale Baakalai (env)
    const integration = await db.userIntegrations.get(oauthData.userId, 'salesforce');
    const prevMetadata = typeof integration?.metadata === 'string' ? JSON.parse(integration.metadata) : (integration?.metadata || {});
    const creds = crmOauth.salesforceCredentials(prevMetadata);
    if (!creds) {
      logger.error('salesforce-oauth', `No Connected App credentials found for user ${oauthData.userId}`);
      return res.redirect(APP_URL + '/settings?crm_error=salesforce_no_credentials');
    }
    const { clientId, clientSecret } = creds;

    const tokenRes = await fetch(`https://${tokenHost}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: APP_URL + '/api/crm/salesforce/callback',
        code_verifier: oauthData.codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error('salesforce-oauth', `Token exchange failed: ${err}`);
      return res.redirect(APP_URL + '/settings?crm_error=salesforce_token_failed');
    }

    const tokens = await tokenRes.json();

    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    // Preserve Connected App credentials in metadata (absent en central :
    // le refresh retombera sur les env vars via salesforceCredentials)
    await db.userIntegrations.upsert(oauthData.userId, 'salesforce', {
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      metadata: {
        consumerKey: prevMetadata.consumerKey,
        encryptedConsumerSecret: prevMetadata.encryptedConsumerSecret,
        central: creds.central || undefined,
        instance_url: tokens.instance_url,
        oauth: true,
        loginHost: tokenHost,
      },
      expiresAt,
      instanceUrl: tokens.instance_url,
    });

    logger.info('salesforce-oauth', `Salesforce connected for user ${oauthData.userId}: ${tokens.instance_url}`);

    // Auto-set as active CRM if none is set
    await db.query(
      `UPDATE users SET active_crm_provider = 'salesforce' WHERE id = $1 AND (active_crm_provider IS NULL OR active_crm_provider = '')`,
      [oauthData.userId]
    );

    track(oauthData.userId, 'crm_connected', { provider: 'salesforce', oauth: true });

    // Auto-trigger CRM sync in background after OAuth connection
    const { syncCRM } = require('../lib/crm-sync');
    syncCRM(oauthData.userId).catch((err) => {
      logger.error('salesforce-oauth', `Background CRM sync failed for user ${oauthData.userId}: ${err.message}`);
    });

    const landing = oauthData.from === 'wizard' ? '/' : '/settings';
    res.redirect(APP_URL + landing + '?crm_connected=salesforce');
  } catch (err) {
    logger.error('salesforce-oauth', `Salesforce OAuth failed: ${err.message}`);
    res.redirect(APP_URL + '/settings?crm_error=salesforce_failed');
  }
});

// POST /api/crm/salesforce/refresh-token — Refresh Salesforce access token
router.post('/salesforce/refresh-token', async (req, res, next) => {
  try {
    const integration = await db.userIntegrations.get(req.user.id, 'salesforce');
    if (!integration || !integration.refresh_token) {
      return res.status(400).json({ error: 'No Salesforce refresh token available' });
    }

    const refreshToken = decrypt(integration.refresh_token);
    const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
    const refreshHost = metadata.loginHost || 'login.salesforce.com';

    // Connected App du client (metadata) sinon app centrale Baakalai (env)
    const creds = crmOauth.salesforceCredentials(metadata);
    if (!creds) {
      return res.status(400).json({ error: 'No Connected App credentials found. Please reconnect Salesforce.' });
    }
    const { clientId, clientSecret } = creds;

    const tokenRes = await fetch(`https://${refreshHost}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error('salesforce-oauth', `Token refresh failed (${refreshHost}): ${err}`);
      return res.status(502).json({ error: 'Salesforce token refresh failed' });
    }

    const tokens = await tokenRes.json();
    const encryptedAccess = encrypt(tokens.access_token);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    // Si Salesforce fait tourner le refresh token (rotation), persister le
    // nouveau — l'ancien devient invalide.
    await db.userIntegrations.upsert(req.user.id, 'salesforce', {
      accessToken: encryptedAccess,
      ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
      expiresAt,
    });

    if (tokens.instance_url) {
      await db.query(
        `UPDATE user_integrations SET instance_url = $1 WHERE user_id = $2 AND provider = 'salesforce'`,
        [tokens.instance_url, req.user.id]
      );
    }

    logger.info('salesforce-oauth', `Token refreshed for user ${req.user.id}`);
    res.json({ ok: true, expiresAt });
  } catch (err) { next(err); }
});

// Validate + normalize Salesforce instance URL (SSRF guard). Returns the
// https origin, or null si invalide. On ne garde jamais le chemin : un
// utilisateur colle souvent l'URL de la page où il se trouve
// (.../lightning/page/home) et les appels API concatènent /services/data
// dessus. lightning.force.com est l'hôte de l'UI, pas de l'API — on le
// convertit vers my.salesforce.com (même sous-domaine).
function normalizeSalesforceUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    let host = parsed.hostname;
    if (!/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.(my\.salesforce\.com|salesforce\.com|lightning\.force\.com|force\.com|visual\.force\.com)$/.test(host)) {
      return null;
    }
    host = host.replace(/\.lightning\.force\.com$/, '.my.salesforce.com');
    return `https://${host}`;
  } catch { return null; }
}

// POST /api/crm/salesforce/manual-connect — Two payload shapes:
// { consumerKey, consumerSecret, instanceUrl } — save the user's External Client App
//   credentials, then the client calls GET /salesforce/connect to run the OAuth flow.
// { accessToken, instanceUrl } — store a session/bearer token pasted directly
//   (fallback: expires in 2-24h, never auto-refreshed).
router.post('/salesforce/manual-connect', async (req, res, next) => {
  try {
    const { accessToken, consumerKey, consumerSecret, instanceUrl } = req.body;
    const hasCredentials = consumerKey && consumerSecret;
    if (!instanceUrl || (!accessToken && !hasCredentials)) {
      return res.status(400).json({ error: 'instanceUrl plus either accessToken or consumerKey+consumerSecret are required' });
    }
    const normalizedUrl = normalizeSalesforceUrl(instanceUrl);
    if (!normalizedUrl) {
      return res.status(400).json({ error: 'instanceUrl must be a valid Salesforce HTTPS URL (e.g. https://mycompany.my.salesforce.com)' });
    }

    if (hasCredentials) {
      // access_token is NOT NULL in schema: placeholder on first insert,
      // replaced by the OAuth callback; existing token kept on update.
      const existing = await db.userIntegrations.get(req.user.id, 'salesforce');
      await db.userIntegrations.upsert(req.user.id, 'salesforce', {
        ...(existing ? {} : { accessToken: '' }),
        // Wipe any previous OAuth state: a stale refresh_token would be
        // replayed against the new Connected App credentials and fail.
        refreshToken: null,
        expiresAt: null,
        metadata: {
          consumerKey: String(consumerKey).trim(),
          encryptedConsumerSecret: encrypt(String(consumerSecret).trim()),
          instance_url: normalizedUrl,
          oauth: false,
        },
        instanceUrl: normalizedUrl,
      });
      logger.info('salesforce-manual', `Connected App credentials saved for user ${req.user.id}: ${normalizedUrl}`);
      return res.json({ ok: true, status: 'credentials_saved' });
    }

    const encryptedAccess = encrypt(accessToken);
    await db.userIntegrations.upsert(req.user.id, 'salesforce', {
      accessToken: encryptedAccess,
      metadata: { instance_url: normalizedUrl, oauth: false },
      instanceUrl: normalizedUrl,
    });

    // Auto-set as active CRM if none is set
    await db.query(
      `UPDATE users SET active_crm_provider = 'salesforce' WHERE id = $1 AND (active_crm_provider IS NULL OR active_crm_provider = '')`,
      [req.user.id]
    );

    // Test the connection
    try {
      await salesforce.listContacts(normalizedUrl, accessToken);
      logger.info('salesforce-manual', `Salesforce connected for user ${req.user.id}: ${normalizedUrl}`);
      res.json({ ok: true, status: 'connected' });
    } catch (testErr) {
      logger.warn('salesforce-manual', `Connection test failed: ${testErr.message}`);
      res.json({ ok: true, status: 'saved_but_test_failed', message: testErr.message });
    }
  } catch (err) { next(err); }
});

// PATCH /api/crm/salesforce/instance-url — Update just the instance URL for existing connection
router.patch('/salesforce/instance-url', async (req, res, next) => {
  try {
    const { instanceUrl } = req.body;
    if (!instanceUrl) return res.status(400).json({ error: 'instanceUrl is required' });
    const normalizedUrl = normalizeSalesforceUrl(instanceUrl);
    if (!normalizedUrl) {
      return res.status(400).json({ error: 'instanceUrl must be a valid Salesforce HTTPS URL' });
    }

    // Check that a Salesforce integration already exists
    const existing = await db.query(
      `SELECT id FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`,
      [req.user.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'No Salesforce connection found. Connect Salesforce first.' });
    }

    await db.query(
      `UPDATE user_integrations SET instance_url = $1, updated_at = NOW() WHERE user_id = $2 AND provider = 'salesforce'`,
      [normalizedUrl, req.user.id]
    );

    logger.info('salesforce', `Instance URL updated for user ${req.user.id}: ${normalizedUrl}`);
    res.json({ ok: true, status: 'updated' });
  } catch (err) { next(err); }
});

// GET /api/crm/reactivation-stats — Reactivation KPIs
router.get('/reactivation-stats', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [reactivated, emailsSent, pipeline] = await Promise.all([
      // Deals successfully reactivated (attributed)
      db.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(deal_value), 0) as revenue,
               json_agg(json_build_object(
                 'id', o.id, 'name', o.name, 'company', o.company,
                 'dealValue', o.deal_value, 'reactivatedAt', o.reactivated_at,
                 'wonDate', o.won_date
               ) ORDER BY o.reactivated_at DESC) as deals
        FROM opportunities o
        WHERE o.user_id = $1 AND o.reactivated_at IS NOT NULL
      `, [userId]),
      // Reactivation emails sent (last 90 days)
      db.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE replied_at IS NOT NULL) as replied,
               COUNT(*) FILTER (WHERE status = 'pending') as pending
        FROM nurture_emails
        WHERE user_id = $1 AND metadata->>'chain' = 'deal_reactivation'
          AND created_at > NOW() - INTERVAL '90 days'
      `, [userId]),
      // Pipeline ouvert + deals stagnants. Stagnance mesurée sur
      // last_activity_at (signal métier) et non updated_at, réécrit en masse
      // par chaque import — même piège que stepNurture, corrigé le 04/08.
      db.query(`
        SELECT
          COUNT(*) as open_count,
          COALESCE(SUM(deal_value), 0) as open_value,
          COUNT(*) FILTER (
            WHERE COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '14 days'
              AND deal_value IS NOT NULL AND deal_value > 0
          ) as count,
          COALESCE(SUM(deal_value) FILTER (
            WHERE COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '14 days'
              AND deal_value IS NOT NULL AND deal_value > 0
          ), 0) as potential_revenue
        FROM opportunities
        WHERE user_id = $1 AND status NOT IN ('won', 'lost')
      `, [userId]),
    ]);

    const stats = reactivated.rows[0];
    const emails = emailsSent.rows[0];
    const pipe = pipeline.rows[0];

    res.json({
      reactivated: {
        count: parseInt(stats.count),
        revenue: parseFloat(stats.revenue) || 0,
        deals: stats.count > 0 ? stats.deals : [],
      },
      emails: {
        sent: parseInt(emails.total),
        replied: parseInt(emails.replied),
        pending: parseInt(emails.pending),
        replyRate: emails.total > 0 ? Math.round((emails.replied / emails.total) * 100) : 0,
      },
      pipeline: {
        stagnantDeals: parseInt(pipe.count),
        potentialRevenue: parseFloat(pipe.potential_revenue) || 0,
        openDeals: parseInt(pipe.open_count),
        totalValue: parseFloat(pipe.open_value) || 0,
      },
      conversionRate: emails.total > 0 ? Math.round((stats.count / emails.total) * 100) : 0,
    });
  } catch (err) { next(err); }
});

// =============================================
// OAuth produit — HubSpot & Pipedrive
// =============================================
// Contrairement à Salesforce (Connected App par client), l'app OAuth est la
// nôtre : credentials en env (HUBSPOT_CLIENT_ID/SECRET, PIPEDRIVE_CLIENT_ID/
// SECRET). Tant qu'elles ne sont pas posées, /connect répond 501 et le
// frontend retombe sur le champ clé API.

const _crmOauthStates = require('../lib/oauth-states');
const LANDING_URL = process.env.LANDING_URL || 'https://baakal.ai';

// GET /api/crm/:provider/connect — démarre le flow OAuth (hubspot|pipedrive)
router.get('/:provider(hubspot|pipedrive)/connect', async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!crmOauth.isConfigured(provider)) {
      return res.status(501).json({ error: `${provider} OAuth is not configured yet — paste an API key instead` });
    }
    if (_crmOauthStates.size >= 1000) return res.status(429).json({ error: 'Too many pending OAuth requests' });

    const state = crypto.randomBytes(16).toString('hex');
    // `from` pilote la redirection retour : le wizard vit sur /, pas /settings.
    const from = req.query.from === 'wizard' ? 'wizard' : 'settings';
    _crmOauthStates.set(state, { userId: req.user.id, provider, from, expiresAt: Date.now() + 600000 });

    const url = crmOauth.authorizeUrl(provider, {
      redirectUri: `${APP_URL}/api/crm/${provider}/callback`,
      state,
    });
    res.json({ url });
  } catch (err) { next(err); }
});

// GET /api/crm/:provider/callback — retour OAuth (public, pas de JWT :
// bypass explicite dans middleware/auth.js, comme salesforce/callback)
router.get('/:provider(hubspot|pipedrive)/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state } = req.query;

  const oauthData = _crmOauthStates.get(state);
  const from = oauthData?.from || 'settings';
  // Les states du diagnostic public (sans compte) reviennent sur la landing.
  const fail = (reason) => res.redirect(oauthData?.diagnostic
    ? `${LANDING_URL}/diagnostic?oauth_error=${encodeURIComponent(reason)}`
    : `${APP_URL}${from === 'wizard' ? '/' : '/settings'}?crm_error=${encodeURIComponent(reason)}`);

  if (req.query.error) {
    logger.warn('crm-oauth', `${provider} OAuth error: ${req.query.error} — ${req.query.error_description || ''}`);
    return fail(req.query.error);
  }
  if (!code) return fail('missing_code');
  if (!oauthData || oauthData.provider !== provider || oauthData.expiresAt < Date.now()) {
    return fail('invalid_state');
  }
  _crmOauthStates.delete(state);

  try {
    const tokens = await crmOauth.exchangeCode(provider, {
      code,
      redirectUri: `${APP_URL}/api/crm/${provider}/callback`,
    });

    // Diagnostic public : le token sert à UNE lecture puis est jeté — rien
    // n'est stocké hors le rapport agrégé. Require paresseux (cycle sinon).
    if (oauthData.diagnostic) {
      const { runOauthDiagnostic } = require('./public-diagnostic');
      const { id, ownerKey } = await runOauthDiagnostic(provider, tokens, oauthData.lang);
      logger.info('crm-oauth', `${provider} diagnostic public via OAuth: rapport ${id}`);
      return res.redirect(`${LANDING_URL}/diagnostic?r=${id}&k=${ownerKey}`);
    }

    // Marge de 60 s sur l'expiration pour que le refresh parte avant le 401.
    const expiresAt = new Date(Date.now() + Math.max(60, (tokens.expires_in || 1800) - 60) * 1000).toISOString();

    await db.userIntegrations.upsert(oauthData.userId, provider, {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
      // apiDomain : Pipedrive OAuth impose d'appeler le domaine de la société
      // ({api_domain}/api/v1), pas api.pipedrive.com.
      metadata: { oauth: true, ...(tokens.api_domain ? { apiDomain: tokens.api_domain } : {}) },
    });

    await db.query(
      `UPDATE users SET active_crm_provider = $2 WHERE id = $1 AND (active_crm_provider IS NULL OR active_crm_provider = '')`,
      [oauthData.userId, provider]
    );

    track(oauthData.userId, 'crm_connected', { provider, oauth: true });

    const { syncCRM } = require('../lib/crm-sync');
    syncCRM(oauthData.userId).catch((err) => {
      logger.error('crm-oauth', `Background CRM sync failed for user ${oauthData.userId}: ${err.message}`);
    });

    logger.info('crm-oauth', `${provider} connected via OAuth for user ${oauthData.userId}`);
    res.redirect(`${APP_URL}${from === 'wizard' ? '/' : '/settings'}?crm_connected=${provider}`);
  } catch (err) {
    logger.error('crm-oauth', `${provider} OAuth failed: ${err.message}`);
    return fail(`${provider}_failed`);
  }
});

// GET /api/crm/reading-summary — Compte-rendu de lecture du CRM.
// Affiché juste après le premier import (wizard) et comme premier message
// du chat : « voilà ce que j'ai lu, voilà ce qui dort, voilà ce qui manque ».
// Pur SQL sur opportunities — aucune dépendance à l'analyse IA, donc
// disponible dans la seconde qui suit l'import.
// Seuil de dormance : 30 jours — le standard défendable du marché (14 j
// classait « dormant » presque tout CRM à cycle long et diluait le chiffre).
router.get('/reading-summary', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [totals, topDormant] = await Promise.all([
      // Stagnance sur COALESCE(last_activity_at, created_at) — jamais
      // updated_at, réécrit en masse par chaque import (cf. reactivation-stats).
      db.query(`
        SELECT
          COUNT(*) as total_deals,
          COALESCE(SUM(deal_value), 0) as total_value,
          COUNT(*) FILTER (WHERE status NOT IN ('won', 'lost')) as open_deals,
          COALESCE(SUM(deal_value) FILTER (WHERE status NOT IN ('won', 'lost')), 0) as open_value,
          COUNT(*) FILTER (
            WHERE status NOT IN ('won', 'lost')
              AND COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '30 days'
              AND deal_value IS NOT NULL AND deal_value > 0
          ) as dormant_count,
          COALESCE(SUM(deal_value) FILTER (
            WHERE status NOT IN ('won', 'lost')
              AND COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '30 days'
              AND deal_value IS NOT NULL AND deal_value > 0
          ), 0) as dormant_value,
          COUNT(*) FILTER (
            WHERE status NOT IN ('won', 'lost')
              AND COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '30 days'
              AND (deal_value IS NULL OR deal_value = 0)
          ) as dormant_no_value,
          COUNT(*) FILTER (WHERE deal_value IS NULL OR deal_value = 0) as missing_value,
          COUNT(*) FILTER (WHERE last_activity_at IS NULL) as missing_activity,
          COUNT(*) FILTER (WHERE company IS NULL OR company = '') as missing_company
        FROM opportunities
        WHERE user_id = $1
      `, [userId]),
      // Top 3 par valeur × ancienneté : un deal moyen oublié depuis 200 jours
      // mérite de passer devant un gros deal calme depuis 31 jours.
      db.query(`
        SELECT id, name, company, deal_value,
               GREATEST(0, EXTRACT(DAY FROM NOW() - COALESCE(last_activity_at, created_at)))::int as days_inactive
        FROM opportunities
        WHERE user_id = $1 AND status NOT IN ('won', 'lost')
          AND COALESCE(last_activity_at, created_at) < NOW() - INTERVAL '30 days'
          AND deal_value IS NOT NULL AND deal_value > 0
        ORDER BY deal_value * GREATEST(1, EXTRACT(DAY FROM NOW() - COALESCE(last_activity_at, created_at))) DESC
        LIMIT 3
      `, [userId]),
    ]);

    const row = totals.rows[0];
    const openValue = parseFloat(row.open_value) || 0;
    const dormantValue = parseFloat(row.dormant_value) || 0;

    const { track } = require('../lib/track');
    track(userId, 'reading_summary_viewed', {
      dormant: parseInt(row.dormant_count),
      dormantNoValue: parseInt(row.dormant_no_value),
      openDeals: parseInt(row.open_deals),
    });

    res.json({
      totalDeals: parseInt(row.total_deals),
      totalValue: parseFloat(row.total_value) || 0,
      openDeals: parseInt(row.open_deals),
      openValue,
      dormant: {
        count: parseInt(row.dormant_count),
        value: dormantValue,
        // Les deals dormants SANS montant : invisibles avant — or c'est le cas
        // type du CRM de PME mal renseigné, le manque devient l'accroche.
        noValueCount: parseInt(row.dormant_no_value),
        sharePct: openValue > 0 ? Math.round((dormantValue / openValue) * 100) : null,
        top: topDormant.rows.map(d => ({
          id: d.id,
          name: d.name,
          company: d.company,
          dealValue: parseFloat(d.deal_value) || 0,
          daysInactive: d.days_inactive,
        })),
      },
      dataGaps: {
        missingValue: parseInt(row.missing_value),
        missingActivity: parseInt(row.missing_activity),
        missingCompany: parseInt(row.missing_company),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.syncOpportunityToHubspot = syncOpportunityToHubspot;
module.exports.syncOpportunityToProvider = syncOpportunityToProvider;
module.exports.importContactsForUser = importContactsForUser;
module.exports.getUserHubspotToken = getUserHubspotToken;
module.exports.getUserCrmToken = getUserCrmToken;
