/**
 * Folk CRM API Client
 *
 * Handles contacts and companies via Folk REST API.
 * All API functions require an explicit apiKey (per-user isolation).
 */

const BASE_URL = 'https://api.folk.app/v1';

async function folkFetch(apiKey, endpoint, options = {}) {
  if (!apiKey) {
    throw new Error('Folk API key is required');
  }
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(
      new Error(`Folk API ${res.status}: ${body}`),
      { status: res.status }
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── People ──

async function createPerson(apiKey, data) {
  return folkFetch(apiKey, '/people', {
    method: 'POST',
    body: JSON.stringify({
      firstName: data.firstName || '',
      lastName: data.lastName || data.name || '',
      emails: data.email ? [{ value: data.email }] : [],
      jobTitle: data.title || '',
      company: data.company || '',
    }),
  });
}

async function searchPeople(apiKey, query) {
  return folkFetch(apiKey, `/people?search=${encodeURIComponent(query)}&limit=10`);
}

// ── Companies ──

async function createCompany(apiKey, data) {
  return folkFetch(apiKey, '/companies', {
    method: 'POST',
    body: JSON.stringify({
      name: data.company || data.name || '',
      domain: data.website || '',
    }),
  });
}

// ── Notes / Activities ──

async function createNote(apiKey, data) {
  return folkFetch(apiKey, '/notes', {
    method: 'POST',
    body: JSON.stringify({
      content: data.body || data.content || '',
      personId: data.personId || undefined,
      companyId: data.companyId || undefined,
    }),
  });
}

// ── Helpers ──

function mapOpportunityToPerson(opp) {
  const parts = (opp.name || '').split(' ');
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    email: opp.email || '',
    title: opp.title || '',
    company: opp.company || '',
    name: opp.name || '',
  };
}

module.exports = {
  createPerson,
  searchPeople,
  createCompany,
  createNote,
  mapOpportunityToPerson,
};
