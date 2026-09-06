/**
 * Job: HubSpot Sync (per-user)
 *
 * Called by the refinement loop when a prospect status changes to "interested" or "meeting".
 * Creates/updates HubSpot contacts and deals, and pushes high-confidence memory patterns as notes.
 * Each user's own HubSpot token is fetched from user_integrations.
 */

const db = require('../../db');
const hubspot = require('../../api/hubspot');
const { decrypt } = require('../../config/crypto');

/**
 * Resolve a user's decrypted HubSpot access token.
 */
async function getTokenForUser(userId) {
  const integration = await db.userIntegrations.get(userId, 'hubspot');
  if (!integration) return null;
  try {
    return decrypt(integration.access_token);
  } catch {
    return null;
  }
}

/**
 * Sync a single opportunity to HubSpot when its status changes.
 * Called from the campaigns/opportunities update flow.
 */
async function onStatusChange({ opportunityId, newStatus }) {
  // Only sync on meaningful status transitions
  const syncStatuses = ['interested', 'meeting', 'negotiation', 'won', 'lost'];
  if (!syncStatuses.includes(newStatus)) return null;

  const opportunity = await db.opportunities.get(opportunityId);
  if (!opportunity) return null;

  // Only sync to HubSpot if the user's active CRM IS HubSpot
  const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [opportunity.user_id]);
  const activeCrm = userRow.rows[0]?.active_crm_provider;
  if (activeCrm && activeCrm !== 'hubspot') return null;

  const accessToken = await getTokenForUser(opportunity.user_id);
  if (!accessToken) return null;

  console.log(`[hubspot-sync] Status change → ${newStatus} for opportunity ${opportunityId} (user ${opportunity.user_id})`);

  const campaign = opportunity.campaign_id
    ? await db.campaigns.get(opportunity.campaign_id)
    : null;

  try {
    let contactId = opportunity.crm_contact_id || opportunity.hubspot_contact_id;
    let dealId = opportunity.crm_deal_id || opportunity.hubspot_deal_id;

    // --- Create or update contact ---
    const contactProps = hubspot.mapOpportunityToContact(opportunity);

    if (!contactId && opportunity.email) {
      const search = await hubspot.searchContacts(accessToken, opportunity.email);
      if (search.total > 0) contactId = search.results[0].id;
    }

    if (contactId) {
      await hubspot.updateContact(accessToken, contactId, contactProps);
    } else {
      const created = await hubspot.createContact(accessToken, contactProps);
      contactId = created.id;
    }

    // --- Create or update deal ---
    const dealProps = hubspot.mapOpportunityToDeal(opportunity, campaign);
    dealProps.dealstage = hubspot.mapStatusToDealStage(newStatus);

    if (dealId) {
      await hubspot.updateDeal(accessToken, dealId, dealProps);
    } else {
      const created = await hubspot.createDeal(accessToken, dealProps);
      dealId = created.id;
    }

    // --- Associate ---
    if (contactId && dealId) {
      await hubspot.associateContactToDeal(accessToken, contactId, dealId).catch(() => {});
    }

    // --- Persist IDs (write to both old and new columns during transition) ---
    await db.opportunities.update(opportunity.id, {
      hubspot_contact_id: contactId,
      hubspot_deal_id: dealId,
      crm_provider: 'hubspot',
      crm_contact_id: contactId,
      crm_deal_id: dealId,
    });

    // --- Add a note with context on "meeting" status ---
    if (newStatus === 'meeting' && dealId) {
      const noteBody = [
        `<strong>Meeting planifié</strong>`,
        campaign ? `<p>Campagne: ${campaign.name}</p>` : '',
        campaign?.sector ? `<p>Secteur: ${campaign.sector}</p>` : '',
        `<p>Source: Bakal prospection automatisée</p>`,
      ].filter(Boolean).join('');

      await hubspot.createNote(accessToken, noteBody, { contactId, dealId }).catch((err) =>
        console.warn(`[hubspot-sync] Note creation failed: ${err.message}`)
      );
    }

    console.log(`[hubspot-sync] Synced opportunity ${opportunityId} → contact=${contactId}, deal=${dealId}`);
    return { contactId, dealId };
  } catch (err) {
    console.error(`[hubspot-sync] Failed for opportunity ${opportunityId}:`, err.message);
    return null;
  }
}

/**
 * Push high-confidence memory patterns to HubSpot as notes on a deal.
 * Called by the memory consolidation job or manually.
 * Now iterates per-user: each user's deals get notes via their own token.
 */
async function pushPatternsToDeals() {
  // Find all users who have HubSpot as active CRM with active deals
  const result = await db.query(
    "SELECT DISTINCT o.user_id, COALESCE(o.crm_deal_id, o.hubspot_deal_id) AS crm_deal_id FROM opportunities o " +
    "INNER JOIN user_integrations ui ON ui.user_id = o.user_id AND ui.provider = 'hubspot' " +
    "INNER JOIN users u ON u.id = o.user_id AND (u.active_crm_provider = 'hubspot' OR u.active_crm_provider IS NULL) " +
    "WHERE o.crm_provider = 'hubspot' AND o.crm_deal_id IS NOT NULL AND o.status NOT IN ('won', 'lost')"
  );

  if (result.rows.length === 0) return { synced: 0, reason: 'No active HubSpot deals' };

  let synced = 0;
  let totalPatterns = 0;

  // Group by user to fetch per-user patterns and tokens
  const byUser = {};
  for (const row of result.rows) {
    if (!byUser[row.user_id]) byUser[row.user_id] = [];
    byUser[row.user_id].push(row.crm_deal_id);
  }

  for (const [userId, dealIds] of Object.entries(byUser)) {
    const accessToken = await getTokenForUser(userId);
    if (!accessToken) continue;

    const patterns = await db.memoryPatterns.list({ confidence: 'Haute', userId });
    if (patterns.length === 0) continue;
    totalPatterns += patterns.length;

    const noteBody = hubspot.formatPatternsAsNote(patterns);

    for (const dealId of dealIds) {
      try {
        await hubspot.createNote(accessToken, noteBody, { dealId });
        synced++;
      } catch (err) {
        console.warn(`[hubspot-sync] Failed to push patterns to deal ${dealId} (user ${userId}):`, err.message);
      }
    }
  }

  console.log(`[hubspot-sync] Pushed ${totalPatterns} patterns to ${synced} deals`);
  return { synced, patternsCount: totalPatterns };
}

module.exports = { onStatusChange, pushPatternsToDeals };
