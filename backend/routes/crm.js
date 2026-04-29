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
    const statuses = [];

    for (const provider of providers) {
      const integration = await db.userIntegrations.get(req.user.id, provider);
      statuses.push({
        provider,
        connected: !!integration,
        label: labelMap[provider] || provider,
      });
    }

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
    const baseId = metadata.base_id;
    if (!baseId) return res.status(400).json({ error: 'Airtable base ID not configured. Update in Settings.' });

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

    // Try to get deals from CRM for better scoring
    let deals = [];
    const token = await getUserKey(req.user.id, 'pipedrive');
    if (token) {
      try {
        deals = await pipedrive.getDeals(token, 500);
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
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const teamResult = await db.query(
      `SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1`, [req.user.id]
    );
    const teamId = teamResult.rows[0]?.team_id;
    if (!teamId) return res.status(400).json({ error: 'No team found' });

    const result = await db.query(
      `INSERT INTO product_lines (team_id, name, description, icon) VALUES ($1, $2, $3, $4) RETURNING *`,
      [teamId, name, description || null, icon || null]
    );
    res.json({ productLine: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/crm/product-lines/:id
router.delete('/product-lines/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM product_lines WHERE id = $1`, [req.params.id]);
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

// Helper: get CRM token for any provider
async function getUserCrmToken(userId, provider) {
  const { getUserKey } = require('../config');
  return getUserKey(userId, provider);
}

module.exports = router;
module.exports.syncOpportunityToHubspot = syncOpportunityToHubspot;
module.exports.getUserHubspotToken = getUserHubspotToken;
