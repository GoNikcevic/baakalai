/**
 * Salesforce API Client
 *
 * Handles contacts, opportunities (deals), and notes via Salesforce REST API.
 * All API functions require an explicit accessToken + instanceUrl (per-user isolation).
 */

async function sfFetch(instanceUrl, accessToken, endpoint, options = {}) {
  if (!accessToken || !instanceUrl) {
    throw new Error('Salesforce credentials required (accessToken + instanceUrl)');
  }
  const url = `${instanceUrl}/services/data/v58.0${endpoint}`;
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
      new Error(`Salesforce API ${res.status}: ${body}`),
      { status: res.status }
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Contacts ──

async function createContact(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Contact', {
    method: 'POST',
    body: JSON.stringify({
      FirstName: data.firstName || '',
      LastName: data.lastName || data.name || 'Unknown',
      Email: data.email || '',
      Title: data.title || '',
      Company: data.company || '',
    }),
  });
}

async function searchContacts(instanceUrl, accessToken, email) {
  const query = `SELECT Id, FirstName, LastName, Email, Title FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}'`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return result.records || [];
}

// ── Opportunities (Deals) ──

async function createDeal(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Opportunity', {
    method: 'POST',
    body: JSON.stringify({
      Name: data.name || 'Bakal Opportunity',
      StageName: mapStatusToStage(data.status),
      CloseDate: data.closeDate || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
      Description: data.description || '',
    }),
  });
}

async function updateDeal(instanceUrl, accessToken, dealId, data) {
  return sfFetch(instanceUrl, accessToken, `/sobjects/Opportunity/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      StageName: mapStatusToStage(data.status),
      Description: data.description || undefined,
    }),
  });
}

async function getDeals(instanceUrl, accessToken, limit = 100) {
  const query = `SELECT Id, Name, StageName, Amount, CloseDate, CreatedDate FROM Opportunity ORDER BY CreatedDate DESC LIMIT ${limit}`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(r => ({
    id: r.Id,
    name: r.Name,
    stage: r.StageName,
    amount: r.Amount,
    closeDate: r.CloseDate,
    createdAt: r.CreatedDate,
  }));
}

// ── Notes ──

async function createNote(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Note', {
    method: 'POST',
    body: JSON.stringify({
      Title: data.title || 'Bakal Note',
      Body: data.body || '',
      ParentId: data.parentId,
    }),
  });
}

// ── Helpers ──

function mapStatusToStage(status) {
  const map = {
    new: 'Prospecting',
    interested: 'Qualification',
    meeting: 'Needs Analysis',
    negotiation: 'Negotiation/Review',
    won: 'Closed Won',
    lost: 'Closed Lost',
  };
  return map[status] || 'Prospecting';
}

function mapOpportunityToContact(opp) {
  const parts = (opp.name || '').split(' ');
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Unknown',
    email: opp.email || '',
    title: opp.title || '',
    company: opp.company || '',
  };
}

module.exports = {
  createContact,
  searchContacts,
  createDeal,
  updateDeal,
  getDeals,
  createNote,
  mapStatusToStage,
  mapOpportunityToContact,
};
