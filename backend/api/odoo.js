/**
 * Odoo API Client (JSON-RPC)
 *
 * Connects to Odoo CRM, Sales, Contacts, and Invoicing modules.
 * Uses JSON-RPC 2.0 protocol (not REST).
 *
 * Auth: database + username + password (or API key for Odoo 14+).
 * Credentials stored as JSON in user_integrations.access_token:
 *   { "url": "https://mycompany.odoo.com", "db": "mydb", "username": "...", "password": "..." }
 */

const { withRetry } = require('../lib/retry');

let _uidCache = new Map(); // url+db+user → uid

// ── URL validation (SSRF prevention) ──

const BLOCKED_HOSTS_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|\[::1\])/;

function isValidOdooUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (BLOCKED_HOSTS_RE.test(parsed.hostname)) return false;
    // Must have a real domain (not just an IP unless it's a public one)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) return false; // block all raw IPs
    return true;
  } catch { return false; }
}

// ── JSON-RPC helpers ──

async function jsonRpc(url, service, method, args) {
  if (!isValidOdooUrl(url)) {
    throw new Error('Invalid Odoo URL — must be HTTPS with a valid domain (e.g. https://mycompany.odoo.com)');
  }
  return withRetry(async () => {
    const res = await fetch(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        id: Date.now(),
        params: { service, method, args },
      }),
    });
    if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) {
      const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
      throw new Error(`Odoo: ${msg}`);
    }
    return data.result;
  }, { maxRetries: 2, baseDelay: 1000 });
}

async function authenticate(creds) {
  const { url, db, username, password } = creds;
  const cacheKey = `${url}|${db}|${username}`;
  if (_uidCache.has(cacheKey)) return _uidCache.get(cacheKey);

  const uid = await jsonRpc(url, 'common', 'authenticate', [db, username, password, {}]);
  if (!uid) throw new Error('Odoo authentication failed — check credentials');
  _uidCache.set(cacheKey, uid);
  return uid;
}

async function call(creds, model, method, args = [], kwargs = {}) {
  const { url, db, username, password } = creds;
  const uid = await authenticate(creds);
  return jsonRpc(url, 'object', 'execute_kw', [db, uid, password, model, method, args, kwargs]);
}

// ── Contacts (res.partner) ──

async function listContacts(creds, { limit = 500, offset = 0 } = {}) {
  const ids = await call(creds, 'res.partner', 'search', [
    [['is_company', '=', false], ['email', '!=', false]],
  ], { limit, offset });
  if (!ids || ids.length === 0) return [];

  return call(creds, 'res.partner', 'read', [ids], {
    fields: ['id', 'name', 'email', 'phone', 'function', 'company_name', 'parent_id', 'write_date', 'create_date', 'country_id', 'city'],
  });
}

async function listAllContacts(creds) {
  const all = [];
  let offset = 0;
  const LIMIT = 500;
  while (true) {
    const batch = await listContacts(creds, { limit: LIMIT, offset });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < LIMIT) break;
    offset += LIMIT;
    if (all.length >= 10000) break;
  }
  return all;
}

async function searchContactByEmail(creds, email) {
  const ids = await call(creds, 'res.partner', 'search', [
    [['email', '=ilike', email]],
  ], { limit: 1 });
  if (!ids || ids.length === 0) return null;
  const contacts = await call(creds, 'res.partner', 'read', [ids], {
    fields: ['id', 'name', 'email', 'phone', 'function', 'company_name', 'parent_id'],
  });
  return contacts[0] || null;
}

async function createContact(creds, data) {
  const id = await call(creds, 'res.partner', 'create', [{
    name: data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
    email: data.email || false,
    phone: data.phone || false,
    function: data.title || false,
    company_name: data.company || false,
  }]);
  return { id };
}

async function updateContact(creds, contactId, data) {
  const vals = {};
  if (data.name) vals.name = data.name;
  if (data.email) vals.email = data.email;
  if (data.phone) vals.phone = data.phone;
  if (data.title) vals.function = data.title;
  if (data.company) vals.company_name = data.company;
  await call(creds, 'res.partner', 'write', [[contactId], vals]);
  return { id: contactId };
}

// Archive (not `unlink`) — res.partner is frequently FK-referenced by crm.lead/account.move,
// so a hard delete can fail on those constraints and is irreversible anyway, defeating undo.
// `listContacts`'s search implicitly excludes active=false records (Odoo ORM default), so
// archived contacts disappear from future scans with no extra filtering needed.
async function archiveContact(creds, contactId) {
  await call(creds, 'res.partner', 'write', [[contactId], { active: false }]);
  return { id: contactId };
}

async function unarchiveContact(creds, contactId) {
  await call(creds, 'res.partner', 'write', [[contactId], { active: true }]);
  return { id: contactId };
}

async function upsertContact(creds, data) {
  if (data.email) {
    const existing = await searchContactByEmail(creds, data.email);
    if (existing) {
      await updateContact(creds, existing.id, data);
      return { id: existing.id, action: 'updated' };
    }
  }
  const created = await createContact(creds, data);
  return { id: created.id, action: 'created' };
}

// ── CRM Leads/Opportunities (crm.lead) ──

async function getDeals(creds, { limit = 100 } = {}) {
  // A bare [] domain implicitly filters active=true in Odoo's ORM, silently excluding lost
  // leads (Odoo marks a lead "lost" by archiving it, active=false) — the '|' includes both.
  const ids = await call(creds, 'crm.lead', 'search', [['|', ['active', '=', true], ['active', '=', false]]], { limit, order: 'write_date desc' });
  if (!ids || ids.length === 0) return [];

  const deals = await call(creds, 'crm.lead', 'read', [ids], {
    fields: ['id', 'name', 'partner_id', 'stage_id', 'probability', 'expected_revenue', 'type', 'write_date', 'create_date', 'active', 'date_closed'],
  });

  // is_won lives on crm.stage, not crm.lead itself — resolve once and cross-reference.
  const stages = await getStages(creds);
  const wonStageIds = new Set(stages.filter(s => s.isWon).map(s => s.id));

  return deals.map(d => {
    const stageId = d.stage_id?.[0] || null;
    const isWon = stageId != null && wonStageIds.has(stageId);
    const status = isWon ? 'won' : (d.active === false ? 'lost' : 'open');
    return {
      id: d.id,
      name: d.name,
      personId: d.partner_id?.[0] || null,
      contactName: d.partner_id?.[1] || null,
      stage: d.stage_id?.[1] || null,
      stageId,
      status,
      probability: d.probability,
      value: d.expected_revenue || 0,
      type: d.type, // 'lead' or 'opportunity'
      updatedAt: d.write_date,
      createdAt: d.create_date,
      closeDate: d.date_closed || null,
    };
  });
}

async function createDeal(creds, data) {
  const id = await call(creds, 'crm.lead', 'create', [{
    name: data.name || 'Baakalai Opportunity',
    partner_id: data.contactId || false,
    type: 'opportunity',
    expected_revenue: data.value || 0,
  }]);
  return { id };
}

// ── Pipeline Stages (crm.stage) ──

async function getStages(creds) {
  const ids = await call(creds, 'crm.stage', 'search', [[]], { order: 'sequence asc' });
  if (!ids || ids.length === 0) return [];

  const stages = await call(creds, 'crm.stage', 'read', [ids], {
    fields: ['id', 'name', 'sequence', 'is_won'],
  });
  return stages.map(s => ({
    id: s.id,
    name: s.name,
    order: s.sequence,
    isWon: s.is_won,
  }));
}

// ── Invoices (account.move) ──

async function getInvoices(creds, { contactId, limit = 50 } = {}) {
  const domain = [['move_type', '=', 'out_invoice']];
  if (contactId) domain.push(['partner_id', '=', contactId]);

  const ids = await call(creds, 'account.move', 'search', [domain], { limit, order: 'invoice_date desc' });
  if (!ids || ids.length === 0) return [];

  const invoices = await call(creds, 'account.move', 'read', [ids], {
    fields: ['id', 'name', 'partner_id', 'amount_total', 'amount_residual', 'state', 'invoice_date', 'invoice_date_due', 'payment_state'],
  });
  return invoices.map(i => ({
    id: i.id,
    number: i.name,
    contactId: i.partner_id?.[0] || null,
    contactName: i.partner_id?.[1] || null,
    total: i.amount_total,
    remaining: i.amount_residual,
    state: i.state, // draft, posted, cancel
    paymentState: i.payment_state, // not_paid, in_payment, paid, partial, reversed
    date: i.invoice_date,
    dueDate: i.invoice_date_due,
  }));
}

// ── Activities (mail.activity) ──

async function getActivities(creds, contactId) {
  const ids = await call(creds, 'mail.activity', 'search', [
    [['res_model', '=', 'res.partner'], ['res_id', '=', contactId]],
  ], { limit: 50, order: 'date_deadline desc' });
  if (!ids || ids.length === 0) return [];

  const activities = await call(creds, 'mail.activity', 'read', [ids], {
    fields: ['id', 'activity_type_id', 'summary', 'note', 'date_deadline', 'state'],
  });
  return activities.map(a => ({
    id: a.id,
    type: a.activity_type_id?.[1] || 'task',
    subject: a.summary || '',
    note: a.note || '',
    dueDate: a.date_deadline,
    state: a.state,
  }));
}

// ── Notes (mail.message on res.partner) ──

async function createNote(creds, { contactId, content }) {
  return call(creds, 'mail.message', 'create', [{
    model: 'res.partner',
    res_id: contactId,
    body: content,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note',
  }]);
}

// ── Health check ──

async function testConnection(creds) {
  try {
    const uid = await authenticate(creds);
    return { success: true, uid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  isValidOdooUrl,
  authenticate,
  listContacts,
  listAllContacts,
  searchContactByEmail,
  createContact,
  updateContact,
  archiveContact,
  unarchiveContact,
  upsertContact,
  getDeals,
  createDeal,
  getStages,
  getInvoices,
  getActivities,
  createNote,
  testConnection,
};
