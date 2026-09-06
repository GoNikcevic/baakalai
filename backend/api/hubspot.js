/**
 * HubSpot API Client
 *
 * Handles contacts, deals, and activities (notes/tasks) via HubSpot v3 API.
 * All API functions require an explicit accessToken parameter (per-user isolation).
 */

const { withRetry } = require('../lib/retry');

const BASE_URL = 'https://api.hubapi.com';

async function hubspotFetch(accessToken, endpoint, options = {}) {
  if (!accessToken) {
    throw new Error('HubSpot access token is required');
  }
  return withRetry(async () => {
    const url = `${BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(
        new Error(`HubSpot API ${res.status}: ${body}`),
        { status: res.status }
      );
    }

    // 204 No Content
    if (res.status === 204) return null;
    return res.json();
  }, { maxRetries: 3, baseDelay: 1000 });
}

// =============================================
// Contacts
// =============================================

async function createContact(accessToken, properties) {
  return hubspotFetch(accessToken, '/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function updateContact(accessToken, contactId, properties) {
  return hubspotFetch(accessToken, `/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}

async function getContact(accessToken, contactId) {
  return hubspotFetch(accessToken, `/crm/v3/objects/contacts/${contactId}`);
}

async function searchContacts(accessToken, email) {
  return hubspotFetch(accessToken, '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: 'EQ',
          value: email,
        }],
      }],
    }),
  });
}

// =============================================
// Deals
// =============================================

async function createDeal(accessToken, properties) {
  return hubspotFetch(accessToken, '/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({ properties }),
  });
}

async function updateDeal(accessToken, dealId, properties) {
  return hubspotFetch(accessToken, `/crm/v3/objects/deals/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}

async function getDeal(accessToken, dealId) {
  return hubspotFetch(accessToken, `/crm/v3/objects/deals/${dealId}`);
}

async function getDealStageLabels(accessToken) {
  // dealstage renvoie l'id interne d'étape (ex. "appointmentscheduled"), pas le libellé
  // que l'utilisateur voit — /crm/v3/pipelines/deals donne la correspondance, tous
  // pipelines confondus (les ids d'étape sont uniques au portail).
  const data = await hubspotFetch(accessToken, '/crm/v3/pipelines/deals');
  const map = new Map();
  for (const p of (data.results || [])) {
    for (const s of (p.stages || [])) map.set(String(s.id), s.label);
  }
  return map;
}

async function getDeals(accessToken, limit = 100) {
  // hs_is_closed / hs_is_closed_won are default calculated properties on every HubSpot portal —
  // the native won/lost signal, independent of the pipeline's (fully customizable) dealstage IDs.
  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
    associations: 'contacts',
    properties: 'dealname,amount,dealstage,closedate,hs_is_closed,hs_is_closed_won,hs_lastmodifieddate',
  });
  const data = await hubspotFetch(accessToken, `/crm/v3/objects/deals?${params.toString()}`);
  return (data.results || []).map(d => {
    const p = d.properties || {};
    const isWon = p.hs_is_closed_won === 'true';
    const isClosed = p.hs_is_closed === 'true';
    return {
      id: d.id,
      name: p.dealname || '',
      stage: p.dealstage || '',
      status: isWon ? 'won' : (isClosed ? 'lost' : 'open'),
      value: p.amount ? parseFloat(p.amount) : null,
      personId: d.associations?.contacts?.results?.[0]?.id || null,
      closeDate: p.closedate || null,
      updatedAt: p.hs_lastmodifieddate || null,
    };
  });
}

// =============================================
// Associations (link contact ↔ deal)
// =============================================

async function associateContactToDeal(accessToken, contactId, dealId) {
  return hubspotFetch(
    accessToken,
    `/crm/v3/objects/contacts/${contactId}/associations/deals/${dealId}/contact_to_deal`,
    { method: 'PUT' }
  );
}

// =============================================
// Notes (engagements)
// =============================================

async function createNote(accessToken, body, associations = {}) {
  const payload = {
    properties: {
      hs_note_body: body,
      hs_timestamp: new Date().toISOString(),
    },
  };

  if (associations.contactId || associations.dealId) {
    payload.associations = [];
    if (associations.contactId) {
      payload.associations.push({
        to: { id: associations.contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
      });
    }
    if (associations.dealId) {
      payload.associations.push({
        to: { id: associations.dealId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
      });
    }
  }

  return hubspotFetch(accessToken, '/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// =============================================
// Helpers
// =============================================

/**
 * Map a Bakal opportunity to HubSpot contact properties.
 */
function mapOpportunityToContact(opportunity) {
  const props = {
    firstname: opportunity.name?.split(' ')[0] || '',
    lastname: opportunity.name?.split(' ').slice(1).join(' ') || '',
    jobtitle: opportunity.title || '',
    company: opportunity.company || '',
  };
  if (opportunity.email) props.email = opportunity.email;
  return props;
}

/**
 * Map a Bakal opportunity to HubSpot deal properties.
 */
function mapOpportunityToDeal(opportunity, campaign) {
  return {
    dealname: `${opportunity.company || opportunity.name} — ${campaign?.name || 'Bakal'}`,
    pipeline: 'default',
    dealstage: mapStatusToDealStage(opportunity.status),
    description: [
      campaign?.name ? `Campagne: ${campaign.name}` : '',
      campaign?.sector ? `Secteur: ${campaign.sector}` : '',
      opportunity.title ? `Poste: ${opportunity.title}` : '',
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Map Bakal opportunity status to HubSpot deal stage.
 * Default pipeline stages: appointmentscheduled, qualifiedtobuy,
 * presentationscheduled, decisionmakerboughtin, contractsent, closedwon, closedlost
 */
function mapStatusToDealStage(status) {
  const stageMap = {
    new: 'appointmentscheduled',
    interested: 'qualifiedtobuy',
    meeting: 'presentationscheduled',
    negotiation: 'decisionmakerboughtin',
    won: 'closedwon',
    lost: 'closedlost',
  };
  return stageMap[status] || 'appointmentscheduled';
}

/**
 * Format memory patterns as a HubSpot note body (HTML).
 */
function formatPatternsAsNote(patterns) {
  const lines = patterns.map((p) =>
    `<li><strong>[${p.category}]</strong> ${p.pattern} <em>(${p.confidence})</em></li>`
  );
  return `<h3>Bakal — Patterns haute confiance</h3><ul>${lines.join('')}</ul>`;
}

// =============================================
// List all contacts (paginated)
// =============================================

async function listAllContacts(accessToken, { limit = 10000 } = {}) {
  const all = [];
  let after;
  while (all.length < limit) {
    // Les trois dernières propriétés portent la récence commerciale. Sans elles,
    // aucun deal ne peut être détecté comme dormant : voir lib/crm-activity-date.js.
    let url = '/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,jobtitle,company,hubspot_owner_id'
      + ',country,city'
      + ',hs_last_sales_activity_timestamp,notes_last_contacted,lastmodifieddate';
    if (after) url += `&after=${after}`;
    const data = await hubspotFetch(accessToken, url);
    const results = data.results || [];
    for (const c of results) {
      all.push({
        id: c.id,
        name: `${c.properties?.firstname || ''} ${c.properties?.lastname || ''}`.trim(),
        email: c.properties?.email,
        job_title: c.properties?.jobtitle,
        org_name: c.properties?.company,
        owner_id: c.properties?.hubspot_owner_id,
        country: c.properties?.country || null,
        city: c.properties?.city || null,
        // Ce connecteur aplatit `properties` : sans cette ligne, les dates
        // demandées ci-dessus seraient récupérées puis jetées.
        lastActivityAt: extractActivityDate('hubspot', c),
      });
    }
    if (!data.paging?.next?.after || results.length === 0) break;
    after = data.paging.next.after;
  }
  return all;
}

async function archiveContact(accessToken, contactId) {
  return hubspotFetch(accessToken, `/crm/v3/objects/contacts/${contactId}`, {
    method: 'DELETE',
  });
}

// Diagnostic public : liste paginée des deals au format attendu par
// computeReport (routes/public-diagnostic.js), aligné sur la version
// Pipedrive. notes_last_updated est la « Last Activity Date » des deals.
// Scopes requis du token private app : crm.objects.deals.read
// (+ crm.objects.companies.read pour les noms de sociétés, optionnel).
async function listDealsForDiagnostic(accessToken, { maxDeals = 2000 } = {}) {
  const raw = [];
  let after;
  while (raw.length < maxDeals) {
    let url = '/crm/v3/objects/deals?limit=100&associations=companies'
      + '&properties=dealname,amount,createdate,notes_last_updated,hs_is_closed,hs_is_closed_won';
    if (after) url += `&after=${after}`;
    const data = await hubspotFetch(accessToken, url);
    const results = data.results || [];
    for (const d of results) {
      const p = d.properties || {};
      raw.push({
        name: p.dealname || null,
        companyId: d.associations?.companies?.results?.[0]?.id || null,
        value: parseFloat(p.amount) || 0,
        currency: 'EUR',
        status: p.hs_is_closed_won === 'true' ? 'won' : p.hs_is_closed === 'true' ? 'lost' : 'open',
        addTime: p.createdate,
        lastActivity: p.notes_last_updated || null,
      });
    }
    if (!data.paging?.next?.after || results.length === 0) break;
    after = data.paging.next.after;
  }

  // Noms de sociétés en batch (100 max/appel). Best-effort : un token sans le
  // scope companies donne un diagnostic valide, seuls les noms manquent.
  const companyNames = {};
  const ids = [...new Set(raw.map(d => d.companyId).filter(Boolean))];
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = await hubspotFetch(accessToken, '/crm/v3/objects/companies/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          inputs: ids.slice(i, i + 100).map(id => ({ id })),
          properties: ['name'],
        }),
      });
      for (const c of batch.results || []) companyNames[c.id] = c.properties?.name || null;
    }
  } catch (err) {
    if (err.status !== 403) throw err;
  }

  // Fallback « — » : société associée mais nom illisible (scope manquant) —
  // compte dans pctCompany sans afficher un nom bidon dans le top 3.
  return raw.map(({ companyId, ...d }) => ({
    ...d,
    company: companyId ? (companyNames[companyId] || '—') : null,
  }));
}

module.exports = {
  // Contacts
  createContact,
  updateContact,
  getContact,
  searchContacts,
  listAllContacts,
  archiveContact,
  // Deals
  createDeal,
  updateDeal,
  getDeal,
  getDeals,
  getDealStageLabels,
  listDealsForDiagnostic,
  // Associations
  associateContactToDeal,
  // Notes
  createNote,
  // Helpers
  mapOpportunityToContact,
  mapOpportunityToDeal,
  mapStatusToDealStage,
  formatPatternsAsNote,
};
