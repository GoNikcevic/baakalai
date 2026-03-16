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

  // Resolve the user's HubSpot token
  const accessToken = await getTokenForUser(opportunity.user_id);
  if (!accessToken) return null;

  console.log(`[hubspot-sync] Status change → ${newStatus} for opportunity ${opportunityId} (user ${opportunity.user_id})`);

  const campaign = opportunity.campaign_id
    ? await db.campaigns.get(opportunity.campaign_id)
    : null;

  try {
    let contactId = opportunity.hubspot_contact_id;
    let dealId = opportunity.hubspot_deal_id;

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

    // --- Persist IDs ---
    await db.opportunities.update(opportunity.id, {
      hubspot_contact_id: contactId,
      hubspot_deal_id: dealId,
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
  const patterns = await db.memoryPatterns.list({ confidence: 'Haute' });
  if (patterns.length === 0) return { synced: 0, reason: 'No high-confidence patterns' };

  // Find all users who have a HubSpot integration
  const result = await db.query(
    "SELECT DISTINCT o.user_id, o.hubspot_deal_id FROM opportunities o " +
    "INNER JOIN user_integrations ui ON ui.user_id = o.user_id AND ui.provider = 'hubspot' " +
    "WHERE o.hubspot_deal_id IS NOT NULL AND o.status NOT IN ('won', 'lost')"
  );

  if (result.rows.length === 0) return { synced: 0, reason: 'No active HubSpot deals' };

  const noteBody = hubspot.formatPatternsAsNote(patterns);
  let synced = 0;

  // Group by user to avoid fetching the same token multiple times
  const byUser = {};
  for (const row of result.rows) {
    if (!byUser[row.user_id]) byUser[row.user_id] = [];
    byUser[row.user_id].push(row.hubspot_deal_id);
  }

  for (const [userId, dealIds] of Object.entries(byUser)) {
    const accessToken = await getTokenForUser(userId);
    if (!accessToken) continue;

    for (const dealId of dealIds) {
      try {
        await hubspot.createNote(accessToken, noteBody, { dealId });
        synced++;
      } catch (err) {
        console.warn(`[hubspot-sync] Failed to push patterns to deal ${dealId} (user ${userId}):`, err.message);
      }
    }
  }

  console.log(`[hubspot-sync] Pushed ${patterns.length} patterns to ${synced} deals`);
  return { synced, patternsCount: patterns.length };
}

module.exports = { onStatusChange, pushPatternsToDeals };
