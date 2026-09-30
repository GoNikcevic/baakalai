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
      // isCrmUpstreamError : cf. le même commentaire dans api/salesforce.js · un
      // 401/403 HubSpot ne doit pas devenir un 401/403 Baakalai (déconnexion
      // erronée de l'utilisateur pour un problème côté CRM, pas Baakalai).
      throw Object.assign(
        new Error(`HubSpot API ${res.status}: ${body}`),
        { status: res.status, isCrmUpstreamError: true }
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

// `properties` est optionnel : sans lui, HubSpot ne renvoie que son jeu par
// défaut, qui ne contient pas `pipeline`. resolveDealStage() en a besoin.
async function getDeal(accessToken, dealId, properties = null) {
  const qs = properties?.length
    ? `?properties=${encodeURIComponent(properties.join(','))}`
    : '';
  return hubspotFetch(accessToken, `/crm/v3/objects/deals/${dealId}${qs}`);
}

async function getDealStageLabels(accessToken) {
  // dealstage renvoie l'id interne d'étape (ex. "appointmentscheduled"), pas le libellé
  // que l'utilisateur voit · /crm/v3/pipelines/deals donne la correspondance, tous
  // pipelines confondus (les ids d'étape sont uniques au portail).
  const pipelines = await getDealPipelines(accessToken);
  const map = new Map();
  for (const p of pipelines) {
    for (const s of p.stages) map.set(s.id, s.name);
  }
  return map;
}

/**
 * Pipelines de deals et leurs étapes, avec l'ordre d'affichage.
 *
 * getDealStageLabels() n'en garde que la correspondance id → libellé, ce qui
 * suffit à la synchro mais pas à dessiner un pipeline : il y faut l'ordre des
 * étapes et leur regroupement. Les deux lisent le même endpoint.
 */
async function getDealPipelines(accessToken) {
  const data = await hubspotFetch(accessToken, '/crm/v3/pipelines/deals');
  return (data.results || []).map(p => ({
    id: String(p.id),
    name: p.label || String(p.id),
    order: p.displayOrder ?? 0,
    stages: (p.stages || []).map(s => ({
      // Cet id est celui que la propriété `dealstage` porte sur chaque deal :
      // c'est lui qui sert de clé de rapprochement avec crm_stage_id.
      id: String(s.id),
      name: s.label || String(s.id),
      order: s.displayOrder ?? 0,
      // metadata.isClosed et metadata.probability sont posés par HubSpot sur
      // TOUT pipeline, y compris personnalisé : c'est le seul moyen de trouver
      // l'étape gagnée ou perdue d'un pipeline dont on ne connaît pas les ids.
      closed: String(s.metadata?.isClosed) === 'true',
      won: Number(s.metadata?.probability) === 1,
    })),
  }));
}

/**
 * Étape à écrire sur un deal EXISTANT, pour un statut baakalai donné.
 *
 * mapStatusToDealStage() ne connaît que les ids du pipeline par défaut
 * (`appointmentscheduled`, `qualifiedtobuy`…). Les appliquer à un deal rangé
 * dans un pipeline personnalisé écrit un id qui n'y existe pas. On résout donc
 * l'étape DANS le pipeline du deal, et on renonce quand on ne sait pas :
 *   - gagné ou perdu : trouvés par metadata, fiables sur tout pipeline ;
 *   - statuts intermédiaires : seulement sur le pipeline par défaut ;
 *   - sinon : null, le stage n'est pas touché.
 *
 * @returns {Promise<string|null>} id d'étape à écrire, ou null s'il n'y a rien
 *   à faire (deal absent, étape non résolue, ou deal déjà sur la bonne étape).
 */
async function resolveDealStage(accessToken, dealId, status) {
  let deal;
  try {
    deal = await getDeal(accessToken, dealId, ['dealstage', 'pipeline']);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
  if (!deal) return null;

  const pipelineId = deal.properties?.pipeline || null;
  const currentStage = deal.properties?.dealstage || null;

  let target = null;
  if (status === 'won' || status === 'lost') {
    const pipelines = await getDealPipelines(accessToken);
    const pipeline = pipelines.find(p => p.id === String(pipelineId));
    if (!pipeline) return null;
    const wanted = status === 'won';
    target = pipeline.stages.find(s => s.closed && s.won === wanted)?.id || null;
  } else if (pipelineId === 'default') {
    target = mapStatusToDealStage(status);
  }

  if (!target || target === currentStage) return null;
  return target;
}

/**
 * Écrit UNIQUEMENT l'étape d'un deal existant.
 *
 * À utiliser partout où un deal est déjà lié : mapOpportunityToDeal() reconstruit
 * `dealname`, `description` et `pipeline`, ce qui renomme le deal du client,
 * écrase sa description et le déplace vers le pipeline par défaut. Ces trois
 * champs n'ont leur place qu'à la création d'un deal par baakalai.
 *
 * @returns {Promise<string|null>} l'étape écrite, ou null si rien n'a été écrit.
 */
async function updateDealStage(accessToken, dealId, status) {
  const dealstage = await resolveDealStage(accessToken, dealId, status);
  if (!dealstage) return null;
  await updateDeal(accessToken, dealId, { dealstage });
  return dealstage;
}

async function getDeals(accessToken, limit = 10000) {
  // hs_is_closed / hs_is_closed_won are default calculated properties on every HubSpot portal · 
  // the native won/lost signal, independent of the pipeline's (fully customizable) dealstage IDs.
  // Paginé via le curseur `after` (pages de 100, le max de l'API v3) : le plafond
  // de 100 sans pagination laissait les deals anciens des vrais portails sans
  // mapping won/lost · donc invisibles comme clients.
  const deals = [];
  let after = null;
  do {
    const params = new URLSearchParams({
      limit: String(Math.min(limit - deals.length, 100)),
      // `companies` en plus de `contacts` · un deal HubSpot est très souvent
      // associé à une société sans l'être à personne, et l'association company
      // ne coûte rien de plus ici. Sans elle, ces deals restent orphelins pour
      // toujours et rien ne permet d'écrire une règle de rattachement commune
      // aux quatre CRM.
      associations: 'contacts,companies',
      // `deal_currency_code`, `hubspot_owner_id`, `pipeline` et `createdate`
      // sont des propriétés par défaut de tout portail HubSpot · elles ne
      // coûtent rien de plus dans le même appel et il manquait sans elles la
      // devise du montant (donc toute somme de CA était fausse dès qu'un
      // portail n'était pas mono-devise), le commercial de l'affaire, le
      // pipeline qui donne son sens à l'étape, et la date de naissance de
      // l'affaire, qui est ce qui mesure la stagnation.
      properties: 'dealname,amount,deal_currency_code,dealstage,pipeline,closedate,createdate,hubspot_owner_id,hs_is_closed,hs_is_closed_won,hs_lastmodifieddate,hs_next_activity_date',
    });
    if (after) params.set('after', after);
    const data = await hubspotFetch(accessToken, `/crm/v3/objects/deals?${params.toString()}`);
    for (const d of data.results || []) {
      const p = d.properties || {};
      const isWon = p.hs_is_closed_won === 'true';
      const isClosed = p.hs_is_closed === 'true';
      deals.push({
        id: d.id,
        name: p.dealname || '',
        stage: p.dealstage || '',
        stageId: p.dealstage || null,
        pipelineId: p.pipeline || null,
        status: isWon ? 'won' : (isClosed ? 'lost' : 'open'),
        value: p.amount ? parseFloat(p.amount) : null,
        // NULL et non 'EUR' · HubSpot codait la devise en dur côté diagnostic,
        // ce qui passait tant qu'un montant vivait sur une ligne de contact.
        // Au niveau compte on somme, et une devise supposée fausse un total.
        currency: p.deal_currency_code || null,
        ownerId: p.hubspot_owner_id || null,
        personId: d.associations?.contacts?.results?.[0]?.id || null,
        accountId: d.associations?.companies?.results?.[0]?.id || null,
        accountName: null,
        closeDate: p.closedate || null,
        createdAt: p.createdate || null,
        updatedAt: p.hs_lastmodifieddate || null,
        nextActivityDate: p.hs_next_activity_date || null,
      });
    }
    after = data.paging?.next?.after || null;
  } while (after && deals.length < limit);
  return deals;
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

/**
 * Read a contact's engagements (logged emails + notes) for the
 * response-analysis-agent. Same shape as pipedrive/odoo getActivities:
 * { id, type, subject, note, dueDate }.
 *
 * Le contenu des emails loggés exige le scope `sales-email-read` (et la
 * lecture des notes peut être refusée selon le portail) : chaque type
 * d'objet dégrade en silence sur 403 au lieu de faire échouer l'analyse.
 */
async function getActivities(accessToken, contactId) {
  const [emails, notes] = await Promise.all([
    fetchContactEngagements(accessToken, contactId, 'emails',
      ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp']),
    fetchContactEngagements(accessToken, contactId, 'notes',
      ['hs_note_body', 'hs_timestamp']),
  ]);

  // Seuls les emails ENTRANTS comptent : HubSpot logge aussi nos propres
  // envois (direction EMAIL/FORWARDED_EMAIL), qui ne sont pas des réponses.
  const activities = [
    ...emails
      .filter(e => e.properties?.hs_email_direction === 'INCOMING_EMAIL')
      .map(e => ({
        id: e.id,
        type: 'email_received',
        subject: e.properties?.hs_email_subject || '',
        note: stripHtml(e.properties?.hs_email_text || ''),
        dueDate: e.properties?.hs_timestamp || null,
      })),
    ...notes.map(n => ({
      id: n.id,
      type: 'note',
      subject: '',
      note: stripHtml(n.properties?.hs_note_body || ''),
      dueDate: n.properties?.hs_timestamp || null,
    })),
  ];

  return activities
    .sort((a, b) => new Date(b.dueDate || 0) - new Date(a.dueDate || 0))
    .slice(0, 50);
}

async function fetchContactEngagements(accessToken, contactId, objectType, properties) {
  try {
    const assoc = await hubspotFetch(
      accessToken,
      `/crm/v4/objects/contacts/${contactId}/associations/${objectType}?limit=50`
    );
    const ids = (assoc?.results || []).map(r => r.toObjectId).filter(Boolean);
    if (ids.length === 0) return [];

    const batch = await hubspotFetch(accessToken, `/crm/v3/objects/${objectType}/batch/read`, {
      method: 'POST',
      body: JSON.stringify({
        inputs: ids.map(id => ({ id: String(id) })),
        properties,
      }),
    });
    return batch?.results || [];
  } catch (err) {
    if (err.status === 403) return []; // scope manquant sur ce type d'objet
    throw err;
  }
}

// hs_note_body (et parfois hs_email_text) arrivent en HTML.
function stripHtml(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    dealname: `${opportunity.company || opportunity.name}, ${campaign?.name || 'Bakal'}`,
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
  return `<h3>Bakal, Patterns haute confiance</h3><ul>${lines.join('')}</ul>`;
}

// =============================================
// List all contacts (paginated)
// =============================================

/**
 * Les SOCIÉTÉS (lot 2, migration 124).
 *
 * `hs_object_id` n'est pas demandé : l'identifiant est déjà `d.id` à la racine
 * de l'objet, et le réclamer en propriété ne fait que grossir la réponse.
 *
 * Forme normalisée commune aux quatre connecteurs, pour que lib/accounts.js
 * n'ait pas à savoir quel CRM lui parle.
 */
async function listAllCompanies(accessToken, { limit = 10000 } = {}) {
  const all = [];
  let after;
  while (all.length < limit) {
    let url = '/crm/v3/objects/companies?limit=100&properties=name,domain,industry,city,hubspot_owner_id,createdate';
    if (after) url += `&after=${after}`;
    const data = await hubspotFetch(accessToken, url);
    for (const c of data.results || []) {
      const p = c.properties || {};
      all.push({
        id: String(c.id),
        name: p.name || null,
        industry: p.industry || null,
        website: p.domain || null,
        city: p.city || null,
        ownerId: p.hubspot_owner_id || null,
        createdAt: p.createdate || null,
      });
    }
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

async function listAllContacts(accessToken, { limit = 10000 } = {}) {
  const all = [];
  let after;
  while (all.length < limit) {
    // Les trois dernières propriétés portent la récence commerciale. Sans elles,
    // aucun deal ne peut être détecté comme dormant : voir lib/crm-activity-date.js.
    let url = '/crm/v3/objects/contacts?limit=100&properties=email,firstname,lastname,jobtitle,company,hubspot_owner_id'
      + ',country,city'
      // `createdate` alimente opportunities.crm_created_at (migration 113) :
      // sans elle, HubSpot ne renvoie aucune date de naissance du contact.
      + ',createdate'
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
        createdAt: c.properties?.createdate || null,
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

  // Fallback « · » : société associée mais nom illisible (scope manquant) · 
  // compte dans pctCompany sans afficher un nom bidon dans le top 3.
  return raw.map(({ companyId, ...d }) => ({
    ...d,
    company: companyId ? (companyNames[companyId] || ' ') : null,
  }));
}

// =============================================
// Introspection du schéma · moteur de découverte (lot 1)
// =============================================

/** Objets standards toujours présents sur un portail HubSpot. */
const HUBSPOT_STANDARD_OBJECTS = [
  { name: 'companies', label: 'Companies', custom: false },
  { name: 'contacts', label: 'Contacts', custom: false },
  { name: 'deals', label: 'Deals', custom: false },
];

/**
 * Les objets du portail, standards et maison.
 *
 * `/crm/v3/schemas` ne renvoie QUE les objets personnalisés · les trois
 * standards n'y figurent pas et sont donc ajoutés ici. Le endpoint est refusé
 * sur les portails sans le scope `crm.schemas.custom.read` : on dégrade alors
 * sur les seuls standards plutôt que de faire échouer toute l'analyse, parce
 * qu'un portail sans objet maison est le cas courant.
 */
async function listObjectSchemas(accessToken) {
  const out = [...HUBSPOT_STANDARD_OBJECTS];
  try {
    const data = await hubspotFetch(accessToken, '/crm/v3/schemas');
    for (const s of data.results || []) {
      out.push({
        name: s.objectTypeId || s.fullyQualifiedName || s.name,
        label: s.labels?.plural || s.name,
        custom: true,
      });
    }
  } catch { /* scope absent : les objets maison resteront invisibles, dit tel quel */ }
  return out;
}

/** Les propriétés déclarées sur un objet. */
async function getObjectProperties(accessToken, objectType) {
  const data = await hubspotFetch(accessToken, `/crm/v3/properties/${objectType}`);
  return (data.results || [])
    // Les propriétés calculées par HubSpot lui-même décrivent son produit, pas
    // le métier du client : les profiler noierait le signal.
    .filter(p => !p.calculated && !/^hs_(all|object_id|created|lastmodified)/.test(p.name))
    .map(p => ({
      key: p.name,
      name: p.label,
      type: p.type,
      custom: p.hubspotDefined === false,
      referenceTo: null,
      options: (p.options || []).map(o => ({ id: o.value, label: o.label })),
    }));
}

/**
 * Un échantillon d'enregistrements, pour mesurer le remplissage réel · lu,
 * agrégé, puis jeté. Voir l'en-tête de lib/crm-architecture.js.
 */
async function sampleRecords(accessToken, objectType, properties, { limit = 100 } = {}) {
  if (!properties || properties.length === 0) return [];
  const params = new URLSearchParams({
    limit: String(Math.min(limit, 100)),
    // HubSpot plafonne l'URL : au delà d'une centaine de propriétés l'appel
    // est refusé, et profiler les cent premières suffit à distinguer le
    // structurant du décor.
    properties: properties.slice(0, 100).join(','),
  });
  const data = await hubspotFetch(accessToken, `/crm/v3/objects/${objectType}?${params.toString()}`);
  return (data.results || []).map(r => r.properties || {});
}

module.exports = {
  // Introspection
  listObjectSchemas,
  getObjectProperties,
  sampleRecords,
  // Contacts
  createContact,
  updateContact,
  getContact,
  searchContacts,
  listAllContacts,
  listAllCompanies,
  archiveContact,
  // Deals
  createDeal,
  updateDeal,
  getDeal,
  getDeals,
  getDealStageLabels,
  getDealPipelines,
  resolveDealStage,
  updateDealStage,
  listDealsForDiagnostic,
  // Associations
  associateContactToDeal,
  // Notes / engagements
  createNote,
  getActivities,
  // Helpers
  mapOpportunityToContact,
  mapOpportunityToDeal,
  mapStatusToDealStage,
  formatPatternsAsNote,
};
