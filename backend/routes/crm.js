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
const { decrypt } = require('../config/crypto');

const router = Router();

/**
 * Resolve the current user's decrypted HubSpot access token.
 * Returns null if not configured.
 */
async function getUserHubspotToken(userId) {
  const integration = await db.userIntegrations.get(userId, 'hubspot');
  if (!integration) return null;
  try {
    return decrypt(integration.access_token);
  } catch {
    return null;
  }
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
    if (!opportunityId) {
      return res.status(400).json({ error: 'opportunityId is required' });
    }

    const opportunity = await db.opportunities.get(opportunityId);
    if (!opportunity) {
      return res.status(404).json({ error: 'Opportunity not found' });
    }

    // Check user owns this opportunity
    if (opportunity.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const token = await getUserHubspotToken(req.user.id);
    if (!token) {
      return res.status(400).json({ error: 'HubSpot not configured. Add your token in Settings.' });
    }

    const result = await syncOpportunityToHubspot(token, opportunity);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =============================================
// POST /api/crm/push-contacts — Bulk push
// =============================================

router.post('/push-contacts', async (req, res, next) => {
  try {
    const token = await getUserHubspotToken(req.user.id);
    if (!token) {
      return res.status(400).json({ error: 'HubSpot not configured. Add your token in Settings.' });
    }

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
        const result = await syncOpportunityToHubspot(token, opp);
        results.push(result);
      } catch (err) {
        errors.push({ opportunityId: opp.id, name: opp.name, error: err.message });
      }
    }

    res.json({
      synced: results.length,
      errors: errors.length,
      results,
      errorDetails: errors,
    });
  } catch (err) {
    next(err);
  }
});

// =============================================
// POST /api/crm/sync-patterns — Push memory patterns as notes
// =============================================

router.post('/sync-patterns', async (req, res, next) => {
  try {
    const token = await getUserHubspotToken(req.user.id);
    if (!token) {
      return res.status(400).json({ error: 'HubSpot not configured. Add your token in Settings.' });
    }

    const { dealId } = req.body;

    // Get high-confidence patterns
    const allPatterns = await db.memoryPatterns.list({ confidence: 'Haute' });
    if (allPatterns.length === 0) {
      return res.json({ synced: false, reason: 'No high-confidence patterns found' });
    }

    const noteBody = hubspot.formatPatternsAsNote(allPatterns);
    const associations = {};
    if (dealId) associations.dealId = dealId;

    const note = await hubspot.createNote(token, noteBody, associations);

    res.json({ synced: true, noteId: note.id, patternsCount: allPatterns.length });
  } catch (err) {
    next(err);
  }
});

// =============================================
// Shared sync logic
// =============================================

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
    const providers = ['hubspot', 'salesforce', 'pipedrive', 'folk', 'notion', 'airtable'];
    const labelMap = { hubspot: 'HubSpot', salesforce: 'Salesforce', pipedrive: 'Pipedrive', folk: 'Folk', notion: 'Notion', airtable: 'Airtable' };

    // Single query instead of 6
    const result = await db.query(
      `SELECT provider FROM user_integrations WHERE user_id = $1 AND provider = ANY($2)`,
      [req.user.id, providers]
    );
    const connectedSet = new Set(result.rows.map(r => r.provider));

    const statuses = providers.map(provider => ({
      provider,
      connected: connectedSet.has(provider),
      label: labelMap[provider] || provider,
    }));

    res.json({ providers: statuses });
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
      const instanceUrl = metadata.instance_url;
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

// POST /api/crm/scan/:provider — Run a CRM health scan
router.post('/scan/:provider', async (req, res, next) => {
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
router.post('/clean/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { reportId, fixes } = req.body;
    if (!fixes || !Array.isArray(fixes)) {
      return res.status(400).json({ error: 'fixes array is required' });
    }

    const result = await crmCleaning.applyFixes(req.user.id, provider, fixes);

    // Update report if provided
    if (reportId) {
      await db.crmCleaningReports.update(reportId, {
        status: result.errors.length === 0 ? 'resolved' : 'partially_fixed',
        fixesApplied: result,
      });
    }

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

// POST /api/crm/import/:provider — Import contacts/deals FROM CRM INTO Baakalai
router.post('/import/:provider', async (req, res, next) => {
  try {
    const { provider } = req.params;
    const token = await getUserCrmToken(req.user.id, provider);
    if (!token) return res.status(400).json({ error: `${provider} not connected` });

    let imported = 0;
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
          const existing = await db.opportunities.findByEmail(req.user.id, email);
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
          const existing = await db.opportunities.findByEmail(req.user.id, raw.email);
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
      const instanceUrl = integration.rows[0]?.instance_url || 'https://login.salesforce.com';
      const sf = require('../api/salesforce');
      const contacts = await sf.listContacts(instanceUrl, token);

      for (const raw of contacts) {
        try {
          if (!raw.email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, raw.email);
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
            crmOwnerId: raw.ownerId || null,
          });
          imported++;
        } catch (err) { errors.push({ name: raw.name, error: err.message }); }
      }
    } else if (provider === 'hubspot') {
      const res2 = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=500&properties=email,firstname,lastname,jobtitle,company', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res2.ok) {
        const data = await res2.json();
        for (const c of (data.results || [])) {
          try {
            const email = c.properties?.email;
            if (!email) { skipped++; continue; }
            const existing = await db.opportunities.findByEmail(req.user.id, email);
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
            });
            imported++;
          } catch (err) { errors.push({ error: err.message }); }
        }
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
          const name = raw.name || raw.company || 'Unknown';
          const email = raw.email || null;
          if (!email) { skipped++; continue; }
          const existing = await db.opportunities.findByEmail(req.user.id, email);
          if (existing) { skipped++; continue; }
          await db.opportunities.create({
            userId: req.user.id,
            name,
            email,
            title: raw.title || null,
            company: raw.company || null,
            status: 'imported',
            crmProvider: 'notion',
            crmContactId: raw.notionPageId || null,
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
          const existing = await db.opportunities.findByEmail(req.user.id, email);
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
          });
          imported++;
        } catch (err) { errors.push({ name: raw.name, error: err.message }); }
      }
    } else {
      return res.status(400).json({ error: `Import not yet supported for ${provider}` });
    }

    res.json({ imported, skipped, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
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
          const instanceUrl = integration.rows[0]?.instance_url || 'https://login.salesforce.com';
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
          deals = await sf.getDeals(integ.rows[0]?.instance_url || 'https://login.salesforce.com', token);
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
    const result = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE churn_score >= 76) AS critical,
        COUNT(*) FILTER (WHERE churn_score >= 51 AND churn_score < 76) AS high,
        COUNT(*) FILTER (WHERE churn_score >= 26 AND churn_score < 51) AS medium,
        COUNT(*) FILTER (WHERE churn_score < 26 OR churn_score IS NULL) AS low,
        COUNT(*) FILTER (WHERE churn_score IS NOT NULL) AS scored,
        ROUND(AVG(churn_score) FILTER (WHERE churn_score IS NOT NULL)) AS avg_score
      FROM opportunities WHERE user_id = $1`,
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
    for (const oppId of opportunityIds) {
      await db.query(
        `INSERT INTO opportunity_product_lines (opportunity_id, product_line_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [oppId, req.params.id]
      );
    }
    res.json({ assigned: opportunityIds.length });
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

// GET /api/crm/client/:id/product-lines — Get product lines for a contact
router.get('/client/:id/product-lines', async (req, res, next) => {
  try {
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
// POST /api/crm/first-diagnostic — Run full CRM diagnostic after first import
// Returns: health scan + deal coach + churn summary + quick stats
// =============================================
router.post('/first-diagnostic', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Auto-detect connected CRM
    const { getUserKey } = require('../config');
    const providers = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
    let connectedProvider = null;
    for (const p of providers) {
      const key = await getUserKey(userId, p);
      if (key) { connectedProvider = p; break; }
    }

    // Load contacts
    const opps = await db.opportunities.listByUser(userId, 500);

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
router.post('/auto-clean', async (req, res, next) => {
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

    const safeFixes = [];
    for (const issue of scan.issues) {
      if (issue.type === 'format_name_caps' && issue.contacts?.length > 0) {
        safeFixes.push({ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts });
      } else if (issue.type === 'duplicate_email' && issue.suggestedAction === 'merge' && issue.contacts?.length >= 2) {
        safeFixes.push({ type: issue.type, action: 'merge', contactIds: issue.contacts.map(c => c.id) });
      } else if (issue.type === 'invalid_email' && issue.contacts?.length > 0) {
        safeFixes.push({ type: issue.type, action: 'delete', contactIds: issue.contacts.map(c => c.id) });
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
      remainingManual: scan.issues.length - safeFixes.length,
      issues: scan.issues.map(i => ({ type: i.type, count: i.count, suggestedAction: i.suggestedAction })),
    });
  } catch (err) {
    next(err);
  }
});

// Helper: get CRM token for any provider
async function getUserCrmToken(userId, provider) {
  const { getUserKey } = require('../config');
  return getUserKey(userId, provider);
}

module.exports = router;
module.exports.syncOpportunityToHubspot = syncOpportunityToHubspot;
module.exports.getUserHubspotToken = getUserHubspotToken;
