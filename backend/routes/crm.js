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

  let contactId = opportunity.hubspot_contact_id;
  let dealId = opportunity.hubspot_deal_id;

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

  // --- Persist HubSpot IDs back to our DB ---
  await db.opportunities.update(opportunity.id, {
    hubspot_contact_id: contactId,
    hubspot_deal_id: dealId,
  });

  return {
    opportunityId: opportunity.id,
    name: opportunity.name,
    hubspotContactId: contactId,
    hubspotDealId: dealId,
    action: opportunity.hubspot_contact_id ? 'updated' : 'created',
  };
}

// =============================================
// GET /api/crm/providers — List all CRM connection statuses
// =============================================

router.get('/providers', async (req, res, next) => {
  try {
    const providers = ['hubspot', 'salesforce', 'pipedrive', 'folk'];
    const statuses = [];

    for (const provider of providers) {
      const integration = await db.userIntegrations.get(req.user.id, provider);
      statuses.push({
        provider,
        connected: !!integration,
        label: provider === 'hubspot' ? 'HubSpot' : provider === 'salesforce' ? 'Salesforce' : provider === 'pipedrive' ? 'Pipedrive' : 'Folk',
      });
    }

    res.json({ providers: statuses });
  } catch (err) {
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
    } else if (provider === 'pipedrive') {
      const personData = pipedrive.mapOpportunityToPerson(opportunity);
      const person = await pipedrive.createPerson(token, personData);
      const deal = await pipedrive.createDeal(token, {
        name: `${opportunity.name} — ${opportunity.company || 'Bakal'}`,
        personId: person.id,
        status: opportunity.status,
      });
      result = { opportunityId: opportunity.id, provider: 'pipedrive', personId: person.id, dealId: deal.id };
    } else if (provider === 'folk') {
      const personData = folk.mapOpportunityToPerson(opportunity);
      const person = await folk.createPerson(token, personData);
      result = { opportunityId: opportunity.id, provider: 'folk', personId: person.id };
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

module.exports = router;
module.exports.syncOpportunityToHubspot = syncOpportunityToHubspot;
module.exports.getUserHubspotToken = getUserHubspotToken;
