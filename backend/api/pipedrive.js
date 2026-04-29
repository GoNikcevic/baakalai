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

/**
 * Search a person by email. Returns the first match or null.
 * Pipedrive search returns { items: [{ item: {...}, result_score }] }
 */
async function searchPersonByEmail(apiToken, email) {
  if (!email) return null;
  const data = await pdFetch(apiToken, `/persons/search?term=${encodeURIComponent(email)}&fields=email&limit=1`);
  const items = data?.items || data || [];
  if (items.length === 0) return null;
  return items[0]?.item || items[0] || null;
}

async function updatePerson(apiToken, personId, data) {
  const body = {};
  if (data.name) body.name = data.name;
  if (data.email) body.email = [{ value: data.email, primary: true }];
  if (data.title || data.job_title) body.job_title = data.title || data.job_title;
  if (data.orgId || data.org_id) body.org_id = data.orgId || data.org_id;
  if (data.phone) body.phone = [{ value: data.phone, primary: true }];
  return pdFetch(apiToken, `/persons/${personId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function deletePerson(apiToken, personId) {
  return pdFetch(apiToken, `/persons/${personId}`, { method: 'DELETE' });
}

/**
 * Upsert a person: search by email, update if found, create if not.
 * Returns { person, action: 'created' | 'updated' }
 */
async function upsertPerson(apiToken, data) {
  if (data.email) {
    const existing = await searchPersonByEmail(apiToken, data.email);
    if (existing) {
      const updated = await updatePerson(apiToken, existing.id, data);
      return { person: updated, action: 'updated' };
    }
  }
  const created = await createPerson(apiToken, data);
  return { person: created, action: 'created' };
}

/**
 * List all persons with pagination. Pipedrive returns max 500 per page.
 * Returns flat array of all persons.
 */
async function listAllPersons(apiToken, { limit = 500 } = {}) {
  const all = [];
  let start = 0;
  while (true) {
    const data = await pdFetch(apiToken, `/persons?start=${start}&limit=${limit}`);
    if (!data || !Array.isArray(data)) break;
    all.push(...data);
    // Check for more pages — pdFetch returns json.data, but we need additional_data
    // which is at json level. Workaround: if we got exactly `limit` results, there might be more.
    if (data.length < limit) break;
    start += limit;
    if (all.length >= 10000) break; // Safety cap
  }
  return all;
}

// ── Pipelines & Stages ──

async function getPipelines(apiToken) {
  const data = await pdFetch(apiToken, '/pipelines');
  return (data || []).map(p => ({
    id: p.id,
    name: p.name,
    active: p.active,
    dealCount: p.deals_count || 0,
  }));
}

async function getStages(apiToken, pipelineId) {
  const endpoint = pipelineId
    ? `/stages?pipeline_id=${pipelineId}`
    : '/stages';
  const data = await pdFetch(apiToken, endpoint);
  return (data || []).map(s => ({
    id: s.id,
    name: s.name,
    pipelineId: s.pipeline_id,
    order: s.order_nr,
  }));
}

// ── Fields & Activities ──

async function getPersonFields(apiToken) {
  const data = await pdFetch(apiToken, '/personFields');
  return (data || []).map(f => ({
    id: f.id,
    key: f.key,
    name: f.name,
    fieldType: f.field_type,
    options: f.options || [],
  }));
}

async function getActivities(apiToken, personId) {
  const data = await pdFetch(apiToken, `/activities?person_id=${personId}&limit=50&sort=due_date DESC`);
  return (data || []).map(a => ({
    id: a.id,
    type: a.type,
    subject: a.subject,
    done: a.done,
    dueDate: a.due_date,
    note: a.note,
  }));
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
    updatedAt: d.update_time || d.add_time,
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

// ── Users (Pipedrive team members) ──

async function getUsers(apiToken) {
  const data = await pdFetch(apiToken, '/users');
  return (data || []).map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active_flag,
  }));
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
  searchPersonByEmail,
  updatePerson,
  deletePerson,
  upsertPerson,
  listAllPersons,
  getPipelines,
  getStages,
  getPersonFields,
  getActivities,
  createDeal,
  updateDeal,
  getDeals,
  createNote,
  getUsers,
  mapOpportunityToPerson,
};
