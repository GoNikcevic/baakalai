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
    throw new Error('Invalid Odoo URL, must be HTTPS with a valid domain (e.g. https://mycompany.odoo.com)');
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
  if (!uid) throw new Error('Odoo authentication failed, check credentials');
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
    // `user_id` = le commercial en charge du contact (res.users). Il manquait :
    // lib/crm-owner-resolver.js le cherchait sur un objet qui ne l'avait jamais
    // demandé, et renvoyait donc null sur toutes les lignes Odoo.
    fields: ['id', 'name', 'email', 'phone', 'function', 'company_name', 'parent_id', 'write_date', 'create_date', 'country_id', 'city', 'user_id'],
  });
}

/**
 * Les SOCIÉTÉS (lot 2, migration 124).
 *
 * Chez Odoo, société et personne sont le MÊME objet, `res.partner` : c'est
 * `is_company` qui les sépare. `listContacts` filtre donc sur `false`, et
 * celle-ci sur `true`.
 *
 * Forme normalisée commune aux quatre connecteurs, pour que lib/accounts.js
 * n'ait pas à savoir quel CRM lui parle.
 */
async function listCompanies(creds, { limit = 500, offset = 0 } = {}) {
  const ids = await call(creds, 'res.partner', 'search', [
    [['is_company', '=', true]],
  ], { limit, offset });
  if (!ids || ids.length === 0) return [];

  const raw = await call(creds, 'res.partner', 'read', [ids], {
    fields: ['id', 'name', 'website', 'city', 'industry_id', 'user_id', 'create_date'],
  });
  return (raw || []).map(c => ({
    id: String(c.id),
    name: c.name || null,
    // Odoo rend les relations sous forme de couple [id, libellé], et `false`
    // quand le champ est vide · jamais null, ce qui piège tous les `||`.
    industry: Array.isArray(c.industry_id) ? c.industry_id[1] : null,
    website: c.website || null,
    city: c.city || null,
    ownerId: Array.isArray(c.user_id) ? String(c.user_id[0]) : null,
    createdAt: c.create_date || null,
  }));
}

async function listAllCompanies(creds) {
  const all = [];
  let offset = 0;
  const LIMIT = 500;
  for (;;) {
    const batch = await listCompanies(creds, { limit: LIMIT, offset });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < LIMIT) break;
    offset += LIMIT;
    if (all.length >= 10000) break; // même garde-fou que listAllContacts
  }
  return all;
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
  let ids = await call(creds, 'res.partner', 'search', [
    [['email', '=ilike', email]],
  ], { limit: 1 });
  if (!ids || ids.length === 0) {
    // Un contact archivé garde son email mais est invisible pour la recherche
    // par défaut (l'ORM filtre active=true) : sans ce second passage, chaque
    // re-push d'un contact archivé en recréait un doublon actif à côté.
    // Deux passages plutôt qu'un seul avec active_test:false, pour qu'un
    // homonyme actif gagne toujours sur l'archivé.
    ids = await call(creds, 'res.partner', 'search', [
      [['email', '=ilike', email]],
    ], { limit: 1, context: { active_test: false } });
  }
  if (!ids || ids.length === 0) return null;
  const contacts = await call(creds, 'res.partner', 'read', [ids], {
    fields: ['id', 'name', 'email', 'phone', 'function', 'company_name', 'parent_id'],
  });
  return contacts[0] || null;
}

async function contactExists(creds, contactId) {
  const ids = await call(creds, 'res.partner', 'search', [
    [['id', '=', contactId]],
  ], { limit: 1, context: { active_test: false } });
  return Boolean(ids && ids.length);
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

// Archive (not `unlink`) · res.partner is frequently FK-referenced by crm.lead/account.move,
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
  // L'ID connu (posé par un import ou un push précédent) prime sur l'email :
  // l'email peut diverger entre baakalai et Odoo, et un contact sans email
  // n'a aucun autre critère de matching · chaque re-sync le recréait.
  if (data.contactId) {
    const id = parseInt(data.contactId, 10);
    if (Number.isInteger(id) && await contactExists(creds, id)) {
      await updateContact(creds, id, data);
      return { id, action: 'updated' };
    }
  }
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
  // leads (Odoo marks a lead "lost" by archiving it, active=false) · the '|' includes both.
  const ids = await call(creds, 'crm.lead', 'search', [['|', ['active', '=', true], ['active', '=', false]]], { limit, order: 'write_date desc' });
  if (!ids || ids.length === 0) return [];

  const deals = await call(creds, 'crm.lead', 'read', [ids], {
    // activity_date_deadline vient du mixin mail.activity (hérité par crm.lead) ·
    // la date de la prochaine activité planifiée, telle qu'affichée dans Odoo.
    // `company_currency` et `user_id` complètent la forme normalisée commune
    // aux quatre CRM : la devise du montant, sans laquelle toute somme de CA au
    // niveau compte est fausse dès qu'une société travaille en deux monnaies,
    // et le commercial de l'AFFAIRE, distinct de celui du contact.
    fields: ['id', 'name', 'partner_id', 'stage_id', 'probability', 'expected_revenue', 'type', 'write_date', 'create_date', 'active', 'date_closed', 'activity_date_deadline', 'company_currency', 'user_id'],
  });

  // is_won lives on crm.stage, not crm.lead itself · resolve once and cross-reference.
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
      // Odoo ne distingue pas société et personne : `res.partner` est les deux,
      // et c'est `parent_id` sur le partenaire, pas sur la lead, qui dit
      // laquelle. Le champ est déclaré ici pour que la forme normalisée soit la
      // même sur les quatre CRM · le renseigner demande une lecture
      // supplémentaire de res.partner, à faire quand un besoin réel le
      // justifiera. Déclarer null vaut mieux que ne pas déclarer : l'appelant
      // sait alors que la question a été posée.
      accountId: null,
      accountName: null,
      stage: d.stage_id?.[1] || null,
      stageId,
      status,
      probability: d.probability,
      value: d.expected_revenue || 0,
      // Odoo renvoie ses Many2one en [id, libellé] · le libellé d'une devise
      // EST son code ISO ('EUR', 'USD'). NULL si le champ manque, jamais un
      // repli : une devise supposée fausse une somme sans le dire.
      currency: Array.isArray(d.company_currency) ? (d.company_currency[1] || null) : null,
      ownerId: Array.isArray(d.user_id) ? (d.user_id[0] != null ? String(d.user_id[0]) : null) : null,
      // Odoo n'a pas de pipeline au sens Pipedrive ou HubSpot · ses étapes sont
      // globales. Déclaré à NULL pour que la forme reste la même sur les quatre.
      pipelineId: null,
      type: d.type, // 'lead' or 'opportunity'
      updatedAt: d.write_date,
      createdAt: d.create_date,
      closeDate: d.date_closed || null,
      nextActivityDate: d.activity_date_deadline || null,
    };
  });
}

// active_test:false · une lead « perdue » est archivée par Odoo, elle existe
// toujours ; sans le contexte, on la croirait supprimée et on la recréerait.
async function dealExists(creds, dealId) {
  const ids = await call(creds, 'crm.lead', 'search', [
    [['id', '=', dealId]],
  ], { limit: 1, context: { active_test: false } });
  return Boolean(ids && ids.length);
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

// ── Introspection du schéma · moteur de découverte (lot 1) ──
//
// Odoo ne sépare pas société et personne : `res.partner` est les DEUX, et
// c'est `is_company` sur l'enregistrement qui tranche. Un moteur qui cherche
// deux objets distincts ne trouvera donc jamais son compte ici · l'inventaire
// le déclare une fois pour toutes plutôt que de laisser chaque appelant s'y
// casser les dents.
const ODOO_OBJECTS = [
  { name: 'res.partner', label: 'Contacts et sociétés', custom: false },
  { name: 'crm.lead', label: 'Pistes et opportunités', custom: false },
];

async function listObjectSchemas() {
  return ODOO_OBJECTS.map(o => ({ ...o }));
}

/** Les champs d'un modèle, forme normalisée commune aux quatre connecteurs. */
async function getObjectFields(creds, model) {
  const raw = await call(creds, model, 'fields_get', [], {
    attributes: ['string', 'type', 'selection', 'relation', 'store'],
  });
  return Object.entries(raw || {})
    // Les champs calculés non stockés ne décrivent pas l'usage : ils se
    // recalculent à la lecture et sont toujours « remplis ».
    .filter(([, f]) => f.store !== false)
    .map(([key, f]) => ({
      key,
      name: f.string || key,
      type: f.type,
      // Un champ maison porte le préfixe x_ par convention Odoo, et les modules
      // tiers n'en posent pas d'autre marqueur lisible ici.
      custom: key.startsWith('x_'),
      referenceTo: f.relation || null,
      options: Array.isArray(f.selection)
        ? f.selection.map(([id, label]) => ({ id: String(id), label: String(label) }))
        : [],
    }));
}

/** Un échantillon d'enregistrements, lu puis agrégé puis jeté. */
async function sampleRecords(creds, model, fields, { limit = 200 } = {}) {
  if (!fields || fields.length === 0) return [];
  return await call(creds, model, 'search_read', [[]], {
    fields, limit, order: 'write_date desc',
    // Une piste perdue est ARCHIVÉE chez Odoo · sans ce contexte, l'échantillon
    // ne verrait que les affaires vivantes et conclurait qu'aucune ne se perd.
    context: { active_test: false },
  });
}

module.exports = {
  isValidOdooUrl,
  authenticate,
  listObjectSchemas,
  getObjectFields,
  sampleRecords,
  listContacts,
  listAllContacts,
  listAllCompanies,
  searchContactByEmail,
  contactExists,
  createContact,
  updateContact,
  archiveContact,
  unarchiveContact,
  upsertContact,
  getDeals,
  dealExists,
  createDeal,
  getStages,
  getInvoices,
  getActivities,
  createNote,
  testConnection,
};
