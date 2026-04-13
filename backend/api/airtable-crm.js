/**
 * Airtable CRM Client
 *
 * Handles pushing prospects as records to Airtable bases via the REST API.
 * All API functions require an explicit apiKey (per-user personal access token).
 */

const AIRTABLE_BASE_URL = 'https://api.airtable.com/v0';

/**
 * Generic fetch wrapper for Airtable API calls.
 */
async function airtableFetch(apiKey, url, options = {}) {
  if (!apiKey) {
    throw new Error('Airtable API key is required');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(
      new Error(`Airtable API ${res.status}: ${body}`),
      { status: res.status }
    );
  }

  return res.json();
}

// ── Push Single Prospect ──

/**
 * Push a prospect to an Airtable table as a record.
 * @param {string} apiKey — user's Airtable API key or personal access token
 * @param {string} baseId — Airtable base ID (e.g., appXXXXXX)
 * @param {string} tableName — table name or ID
 * @param {object} prospect — { name, email, title, company, company_size, linkedin_url }
 * @returns {{ recordId: string }}
 */
async function pushProspectToAirtable(apiKey, baseId, tableName, prospect) {
  const url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;

  const fields = {};
  if (prospect.name) fields['Name'] = prospect.name;
  if (prospect.email) fields['Email'] = prospect.email;
  if (prospect.title) fields['Title'] = prospect.title;
  if (prospect.company) fields['Company'] = prospect.company;
  if (prospect.company_size) fields['Company Size'] = prospect.company_size;
  if (prospect.linkedin_url) fields['LinkedIn URL'] = prospect.linkedin_url;
  if (prospect.status) fields['Status'] = prospect.status;

  const data = await airtableFetch(apiKey, url, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });

  return { recordId: data.id };
}

// ── Push Multiple Prospects (batched) ──

/**
 * Push multiple prospects to Airtable (batch of 10 — Airtable limit per request).
 * @param {string} apiKey
 * @param {string} baseId
 * @param {string} tableName
 * @param {Array<object>} prospects
 * @returns {{ records: Array<{ recordId: string, name: string }> }}
 */
async function pushProspectsToAirtable(apiKey, baseId, tableName, prospects) {
  const url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`;
  const BATCH_SIZE = 10;
  const allRecords = [];

  for (let i = 0; i < prospects.length; i += BATCH_SIZE) {
    const batch = prospects.slice(i, i + BATCH_SIZE);

    const records = batch.map((prospect) => {
      const fields = {};
      if (prospect.name) fields['Name'] = prospect.name;
      if (prospect.email) fields['Email'] = prospect.email;
      if (prospect.title) fields['Title'] = prospect.title;
      if (prospect.company) fields['Company'] = prospect.company;
      if (prospect.company_size) fields['Company Size'] = prospect.company_size;
      if (prospect.linkedin_url) fields['LinkedIn URL'] = prospect.linkedin_url;
      if (prospect.status) fields['Status'] = prospect.status;
      return { fields };
    });

    const data = await airtableFetch(apiKey, url, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });

    for (const rec of (data.records || [])) {
      allRecords.push({ recordId: rec.id, name: rec.fields?.Name || '' });
    }
  }

  return { records: allRecords };
}

// ── List Tables in a Base ──

/**
 * List tables in an Airtable base (for configuration UI).
 * @param {string} apiKey
 * @param {string} baseId
 * @returns {{ tables: Array<{ id: string, name: string }> }}
 */
async function listAirtableTables(apiKey, baseId) {
  const url = `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`;

  const data = await airtableFetch(apiKey, url);

  return {
    tables: (data.tables || []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || '',
    })),
  };
}

// ── Helpers ──

/**
 * Map an opportunity record to Airtable prospect fields.
 */
function mapOpportunityToProspect(opportunity) {
  return {
    name: opportunity.name || '',
    email: opportunity.email || '',
    title: opportunity.title || '',
    company: opportunity.company || '',
    company_size: opportunity.company_size || '',
    linkedin_url: opportunity.linkedin_url || '',
    status: opportunity.status || 'new',
  };
}

module.exports = {
  pushProspectToAirtable,
  pushProspectsToAirtable,
  listAirtableTables,
  mapOpportunityToProspect,
};
