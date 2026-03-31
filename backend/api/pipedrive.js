/**
 * Pipedrive API Client
 *
 * Handles persons (contacts), deals, and notes via Pipedrive REST API.
 * All API functions require an explicit apiToken (per-user isolation).
 */

const BASE_URL = 'https://api.pipedrive.com/v1';

async function pdFetch(apiToken, endpoint, options = {}) {
  if (!apiToken) {
    throw new Error('Pipedrive API token is required');
  }
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${sep}api_token=${apiToken}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(
      new Error(`Pipedrive API ${res.status}: ${body}`),
      { status: res.status }
    );
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Pipedrive error: ${json.error || 'Unknown'}`);
  }
  return json.data;
}

// ── Persons (Contacts) ──

async function createPerson(apiToken, data) {
  return pdFetch(apiToken, '/persons', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
      email: data.email ? [{ value: data.email, primary: true }] : undefined,
      org_id: data.orgId || undefined,
      job_title: data.title || undefined,
    }),
  });
}

async function searchPersons(apiToken, term) {
  return pdFetch(apiToken, `/persons/search?term=${encodeURIComponent(term)}&limit=5`);
}

// ── Deals ──

async function createDeal(apiToken, data) {
  return pdFetch(apiToken, '/deals', {
    method: 'POST',
    body: JSON.stringify({
      title: data.name || 'Bakal Opportunity',
      person_id: data.personId || undefined,
      stage_id: data.stageId || undefined,
      status: data.status === 'won' ? 'won' : data.status === 'lost' ? 'lost' : 'open',
    }),
  });
}

async function updateDeal(apiToken, dealId, data) {
  return pdFetch(apiToken, `/deals/${dealId}`, {
    method: 'PUT',
    body: JSON.stringify({
      status: data.status === 'won' ? 'won' : data.status === 'lost' ? 'lost' : 'open',
      stage_id: data.stageId || undefined,
    }),
  });
}

async function getDeals(apiToken, limit = 100) {
  const deals = await pdFetch(apiToken, `/deals?limit=${limit}&sort=add_time DESC`);
  return (deals || []).map(d => ({
    id: d.id,
    name: d.title,
    stage: d.stage_id,
    status: d.status,
    value: d.value,
    personId: d.person_id?.value || d.person_id,
    createdAt: d.add_time,
  }));
}

// ── Notes ──

async function createNote(apiToken, data) {
  return pdFetch(apiToken, '/notes', {
    method: 'POST',
    body: JSON.stringify({
      content: data.body || data.content || '',
      deal_id: data.dealId || undefined,
      person_id: data.personId || undefined,
    }),
  });
}

// ── Helpers ──

function mapOpportunityToPerson(opp) {
  const parts = (opp.name || '').split(' ');
  return {
    name: opp.name || 'Unknown',
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    email: opp.email || '',
    title: opp.title || '',
  };
}

module.exports = {
  createPerson,
  searchPersons,
  createDeal,
  updateDeal,
  getDeals,
  createNote,
  mapOpportunityToPerson,
};
