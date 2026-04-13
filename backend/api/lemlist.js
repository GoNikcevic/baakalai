const { config } = require('../config');
const { withRetry } = require('../lib/retry');

const BASE_URL = config.lemlist.baseUrl;

async function lemlistFetch(endpoint, options = {}, apiKey = null) {
  // Endpoints starting with "/v2/" hit the v2 API (e.g. /api/v2/...)
  // All other endpoints keep the legacy /api/... prefix.
  const rootUrl = BASE_URL.replace(/\/api$/, '');
  const url = endpoint.startsWith('/v2/')
    ? `${rootUrl}/api${endpoint}`
    : `${BASE_URL}${endpoint}`;
  const key = apiKey || config.lemlist.apiKey;
  return withRetry(async () => {
    const res = await fetch(url, {
      ...options,
      // Lemlist uses API key as basic auth password
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${key}`).toString('base64')}`,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      // 503 with empty body on database endpoints = plan doesn't include Leads add-on
      if (res.status === 503 && endpoint.startsWith('/database/')) {
        throw Object.assign(
          new Error(
            "Lemlist Leads Database non accessible avec ce plan. " +
            "L'accès à la base de 600M contacts nécessite l'add-on \"Find leads\" / \"Reveal\" sur Lemlist. " +
            "Vérifie ton plan sur app.lemlist.com → Settings → Billing, ou utilise Apollo comme source de prospects."
          ),
          { status: 503, endpoint, code: 'LEMLIST_LEADS_UNAVAILABLE' }
        );
      }
      throw Object.assign(
        new Error(`Lemlist API ${res.status} on ${endpoint}: ${body || '(empty body)'}`),
        { status: res.status, endpoint }
      );
    }
    // Handle empty 2xx responses (e.g. 204 No Content) gracefully —
    // some endpoints return an empty body on success.
    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      // Body is non-empty but not JSON (rare) — return raw text under `_raw`
      return { _raw: text };
    }
  }, { maxRetries: 2, baseDelay: 1000 });
}

// --- Create / deploy ---

async function createCampaign(name, apiKey) {
  return lemlistFetch('/campaigns', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }, apiKey);
}

/**
 * Start (or resume) a Lemlist campaign. Idempotent — if the campaign is
 * already running, Lemlist's API simply does nothing.
 * POST /api/campaigns/:id/start
 *
 * We send an empty JSON body to be compatible with parsers that reject
 * POST requests with Content-Type: application/json and no body.
 */
async function startCampaign(campaignId, apiKey) {
  return lemlistFetch(`/campaigns/${campaignId}/start`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, apiKey);
}

// Map Baakal touchpoint types → Lemlist API step types
// Per official Lemlist docs (developer.lemlist.com), valid enum values:
// email, manual, phone, api, linkedinVisit, linkedinInvite, linkedinSend,
// sendToAnotherCampaign, conditional, whatsappMessage
const LEMLIST_STEP_TYPE_MAP = {
  email: 'email',
  linkedin_visit: 'linkedinVisit',
  linkedin_invite: 'linkedinInvite',
  linkedin_message: 'linkedinSend',
  // Legacy fallback
  linkedin: 'linkedinInvite',
};

/**
 * Resolve the sequenceId attached to a campaign. Lemlist auto-creates
 * one sequence per campaign, so we fetch it and return the first one.
 * Cached for the duration of a launch to avoid N+1 calls when pushing
 * multiple steps.
 */
async function resolveSequenceId(campaignId, apiKey) {
  const res = await lemlistFetch(`/campaigns/${campaignId}/sequences`, {}, apiKey);
  // Lemlist returns either a single sequence object or an array of sequences
  // depending on the endpoint version. Handle both.
  const seq = Array.isArray(res) ? res[0] : res;
  const sequenceId = seq?._id || seq?.id || seq?.sequenceId;
  if (!sequenceId) {
    throw new Error(
      `Lemlist n'a pas retourné de sequenceId pour la campagne ${campaignId}. ` +
      `Réponse brute: ${JSON.stringify(res).substring(0, 200)}`
    );
  }
  return sequenceId;
}

/**
 * Add a step to a campaign's sequence.
 *
 * Per Lemlist's current API (2026), the endpoint is:
 *   POST /api/sequences/{sequenceId}/steps
 * NOT the legacy /campaigns/{id}/sequences we used before (which silently
 * returned 404 and made launch flows create empty campaigns).
 *
 * Caller can pass a pre-resolved sequenceId as step.sequenceId to avoid
 * the extra lookup round-trip when pushing multiple steps in a loop.
 */
async function addSequenceStep(campaignId, step, apiKey) {
  const lemlistType = LEMLIST_STEP_TYPE_MAP[step.type] || 'email';

  // Truncate connection invites to 300 chars as a safety net
  let messageText = step.body || '';
  if (lemlistType === 'linkedinInvite' && messageText.length > 300) {
    messageText = messageText.slice(0, 300);
  }

  // Build payload per Lemlist's current schema:
  // required: type; optional: delay, index, subject (email), message (email/linkedinInvite/linkedinSend)
  const body = {
    type: lemlistType,
    delay: typeof step.delay === 'number' ? step.delay : parseDelayFromTiming(step.timing),
  };

  if (lemlistType === 'email') {
    if (step.subject) body.subject = step.subject;
    body.message = messageText;
  } else if (lemlistType === 'linkedinInvite' || lemlistType === 'linkedinSend') {
    body.message = messageText;
  }
  // linkedinVisit: no message/subject, just type + delay

  // Resolve sequenceId if caller didn't pass one
  const sequenceId = step.sequenceId || await resolveSequenceId(campaignId, apiKey);

  return lemlistFetch(`/sequences/${sequenceId}/steps`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, apiKey);
}

function parseDelayFromTiming(timing) {
  if (!timing) return 0;
  const match = String(timing).match(/J\+?(\d+)/i);
  return match ? parseInt(match[1], 10) : 0;
}

// --- Lemlist Leads Database (600M contacts) ---

/**
 * Fetch the list of available filter IDs from Lemlist's people database.
 * Cached for 1h to avoid repeated calls.
 */
let _filtersCache = { data: null, expiresAt: 0 };
async function getDatabaseFilters(apiKey) {
  if (_filtersCache.data && Date.now() < _filtersCache.expiresAt) {
    return _filtersCache.data;
  }
  const filters = await lemlistFetch('/database/filters', {}, apiKey);
  _filtersCache = { data: filters, expiresAt: Date.now() + 3600 * 1000 };
  return filters;
}

/**
 * Normalize company-size buckets to the exact values Lemlist's
 * currentCompanyHeadcount `select` filter accepts.
 *
 * Confirmed via the runtime Filter diagnostics log (Railway, 2026-04-09):
 *   ["1-10", "11-50", "51-200", "201-500", "501-1000",
 *    "1001-5000", "5001-10000", "10001+"]
 *
 * Our internal format already matches these strings for every bounded
 * range, so the mapping is mostly a pass-through. The one special case
 * is our legacy "1001+" bucket, which we expand into the 3 large Lemlist
 * buckets so a user targeting "1000+ employees" actually matches every
 * company above that threshold.
 *
 * An EARLIER VERSION of this function wrongly converted "201-500" → "201"
 * assuming Lemlist used LinkedIn-style numeric IDs. That assumption was
 * wrong and killed every chat/standalone search (the filter was accepted
 * but returned 0 hits because "201" isn't a valid enum value). The new
 * diagnostics log (usedSchema[].values) made the real format obvious.
 */
const LEMLIST_COMPANY_SIZES = [
  '1-10', '11-50', '51-200', '201-500', '501-1000',
  '1001-5000', '5001-10000', '10001+',
];

function mapCompanySizes(values) {
  const out = [];
  const add = (v) => { if (!out.includes(v)) out.push(v); };
  for (const raw of values || []) {
    const key = String(raw).trim();
    if (LEMLIST_COMPANY_SIZES.includes(key)) {
      add(key);
      continue;
    }
    // Legacy aliases we might still receive from Claude or old frontend code
    if (key === '1001+' || key === '1000+' || key === '1001') {
      add('1001-5000');
      add('5001-10000');
      add('10001+');
      continue;
    }
    if (key === '1-10 employees' || key === '1-10 salariés') { add('1-10'); continue; }
    // Unknown format — pass through so Lemlist can error (or match if the
    // string happens to be valid). Better than silently dropping.
    add(key);
  }
  return out;
}

/**
 * Map our generic criteria to Lemlist filter objects.
 *
 * Filter IDs here come from the real Lemlist people-database schema
 * (observed via GET /database/filters on 2026-04-09, see Railway logs).
 * We previously guessed names like "industry" / "job_title" that don't
 * exist, silently dropping most criteria and returning grab-bag results.
 *
 * Returns { filters, diagnostics } so callers can surface which criteria
 * were actually applied vs dropped.
 */
/**
 * Normalize a list of text criterion values:
 *   - Split any value that contains " / " or " | " into multiple values
 *     (Claude sometimes concatenates sectors or titles like
 *     "Biocarburants / Énergies renouvelables" into a single string,
 *     which makes keyword matching too narrow)
 *   - Trim whitespace
 *   - Drop empty values and duplicates (case-insensitive)
 */
function normalizeTextValues(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    if (!raw) continue;
    const parts = String(raw)
      .split(/\s*[/|]\s*/) // split on slash or pipe surrounded by optional spaces
      .map(s => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

function buildLemlistFilters(criteria, availableFilters) {
  const filters = [];
  const diagnostics = {
    applied: [],          // [{ criterion, filterId, values }]
    dropped: [],          // [{ criterion, values, reason }]
    availableFilterIds: [],
  };
  const available = new Set(
    (availableFilters || [])
      .filter(f => !f.mode || f.mode.includes('leads'))
      .map(f => f.filterId)
  );
  diagnostics.availableFilterIds = Array.from(available);

  // Pick the first matching filterId from candidates
  const pick = (candidates) => candidates.find(c => available.has(c));

  const tryAdd = (criterion, values, candidates, { skipNormalize = false } = {}) => {
    // Normalize (split concatenated values on "/" or "|", dedupe) before
    // looking up the filter. This fixes cases where Claude or the user
    // joined multiple values with a slash into a single string.
    // skipNormalize=true for company names where "/" is part of the name
    // (e.g. "TAO / FULL GRIP / CMB" is one company, not three).
    const normalized = skipNormalize
      ? (values || []).map(v => String(v || '').trim()).filter(Boolean)
      : normalizeTextValues(values);
    if (normalized.length === 0) return;
    const fid = pick(candidates);
    if (fid) {
      filters.push({ filterId: fid, in: normalized, out: [] });
      diagnostics.applied.push({
        criterion,
        filterId: fid,
        values: normalized,
        ...(JSON.stringify(normalized) !== JSON.stringify(values || []) ? { rawValues: values } : {}),
      });
    } else {
      diagnostics.dropped.push({
        criterion,
        values,
        reason: `aucun filterId Lemlist parmi [${candidates.join(', ')}] n'existe dans le schéma`,
      });
    }
  };

  // Titles → currentTitle (primary). Fallbacks kept in case of future renames.
  tryAdd('titles', criteria.titles,
    ['currentTitle', 'currentTitleWithExactMatch', 'pastTitle']);

  // Companies → currentCompany (exact or partial match on company name).
  // Used when the user provides a specific list of target companies
  // (e.g. from an Excel file) rather than a sector-wide search.
  // skipNormalize: company names can contain "/" as part of the name
  // (e.g. "TAO / FULL GRIP / CMB") — we must NOT split on slash.
  tryAdd('companies', criteria.companies,
    ['currentCompany', 'currentCompanyByIds'], { skipNormalize: true });

  // Sectors → keywordInCompany first, because currentCompanySubIndustry
  // expects LinkedIn's English taxonomy ("Hospital & Health Care",
  // "Medical Devices", etc.) and silently returns 0 results when given
  // French values like "Hôpitaux" / "Santé". keywordInCompany is a
  // free-text match on company name + description and works in any
  // language — much more forgiving for our use case where Claude
  // generates sector criteria from French campaign context.
  tryAdd('sectors', criteria.sectors,
    ['keywordInCompany', 'currentCompanySubIndustry', 'currentCompanyMarket', 'department']);

  // Locations → `location` first because it's a free-text filter that
  // accepts cities, regions AND countries ("Paris", "Île-de-France",
  // "France" all work). `country` is strict (country names only) and
  // returns 0 if given a city, so putting it first silently broke
  // city-level searches. `region` is a last-resort fallback.
  tryAdd('locations', criteria.locations,
    ['location', 'country', 'region']);

  // Min LinkedIn connections — numberOfConnections filter.
  // Instead of guessing the format (lesson from companySizes!), we read
  // the filter's accepted values from the schema and pick dynamically.
  if (criteria.minConnections) {
    const fid = pick(['numberOfConnections']);
    if (fid) {
      const schemaEntry = (availableFilters || []).find(f => f.filterId === 'numberOfConnections');
      const acceptedValues = schemaEntry?.values || schemaEntry?.options || [];
      const threshold = parseInt(criteria.minConnections, 10) || 300;

      let connectionRanges;
      if (acceptedValues.length > 0) {
        // Use REAL schema values — pick all ranges whose lower bound >= threshold
        connectionRanges = acceptedValues.filter(v => {
          const match = String(v).match(/^(\d+)/);
          return match && parseInt(match[1], 10) >= threshold;
        });
        if (connectionRanges.length === 0) {
          // All values are below threshold — take the top half as best effort
          connectionRanges = acceptedValues.slice(Math.floor(acceptedValues.length / 2));
        }
      } else {
        // No schema values available — blind fallback (will be visible in logs)
        connectionRanges = ['501+'];
      }

      filters.push({ filterId: fid, in: connectionRanges, out: [] });
      diagnostics.applied.push({
        criterion: 'minConnections',
        filterId: fid,
        values: connectionRanges,
        rawValues: [criteria.minConnections],
        schemaValues: acceptedValues.length > 0 ? acceptedValues : 'NOT_AVAILABLE',
      });
    }
  }

  // Company size → currentCompanyHeadcount, but Lemlist expects LinkedIn's
  // numeric ID format ("1", "11", "51", "201", "501", "1001", ...) not our
  // "X-Y" bucket strings. Transform before passing.
  if (criteria.companySizes && criteria.companySizes.length > 0) {
    const fid = pick(['currentCompanyHeadcount']);
    if (fid) {
      const mapped = mapCompanySizes(criteria.companySizes);
      filters.push({ filterId: fid, in: mapped, out: [] });
      diagnostics.applied.push({
        criterion: 'companySizes',
        filterId: fid,
        values: mapped,
        rawValues: criteria.companySizes,
      });
    } else {
      diagnostics.dropped.push({
        criterion: 'companySizes',
        values: criteria.companySizes,
        reason: 'filterId currentCompanyHeadcount absent du schéma',
      });
    }
  }

  return { filters, diagnostics };
}

/**
 * Search Lemlist's 600M contacts database.
 * Uses POST /database/people with dynamic filter discovery.
 */
async function searchPeopleDatabase(apiKey, criteria) {
  const availableFilters = await getDatabaseFilters(apiKey);
  const { filters, diagnostics } = buildLemlistFilters(criteria, availableFilters);

  // Attach the raw schema entry for each filter we actually use, so we can
  // see whether currentCompanyHeadcount et al. have accepted-value hints
  // we're missing. Schema comes from GET /database/filters.
  const usedFilterIds = new Set(filters.map(f => f.filterId));
  const usedSchema = (availableFilters || [])
    .filter(f => usedFilterIds.has(f.filterId))
    .map(f => ({ filterId: f.filterId, type: f.type, values: f.values, valuesRef: f.valuesRef, mode: f.mode }));

  // Log what we're sending so Railway logs show exactly which filters were
  // accepted / dropped AND the actual values we serialized to Lemlist.
  try {
    const logger = require('../lib/logger');
    logger.info('lemlist-search', 'Filter diagnostics', {
      applied: diagnostics.applied.map(a => ({
        criterion: a.criterion,
        filterId: a.filterId,
        values: a.values,
        rawValues: a.rawValues,
      })),
      dropped: diagnostics.dropped.map(d => d.criterion),
      usedSchema,
      bodySent: { filters, page: 1, size: Math.min(criteria.limit || 25, 100) },
    });
  } catch { /* logger optional */ }

  if (filters.length === 0) {
    const err = new Error(
      'Aucun critère reconnu pour la recherche Lemlist. ' +
      'Précise au moins un titre, secteur ou localisation. ' +
      `Filtres Lemlist disponibles: ${diagnostics.availableFilterIds.slice(0, 20).join(', ')}...`
    );
    err.diagnostics = diagnostics;
    throw err;
  }

  const body = {
    filters,
    page: 1,
    size: Math.min(criteria.limit || 25, 100),
  };

  const result = await lemlistFetch('/database/people', {
    method: 'POST',
    body: JSON.stringify(body),
  }, apiKey);

  // Log the raw response meta (total hits, remaining quota, pagination, etc.)
  // so we can distinguish "Lemlist says 0 matches" from "filter rejected"
  // from "quota exhausted".
  try {
    const logger = require('../lib/logger');
    logger.info('lemlist-search', 'Response meta', {
      resultsCount: Array.isArray(result.results) ? result.results.length : null,
      total: result.total,
      totalHits: result.totalHits,
      remainingDailySearchQuota: result.remainingDailySearchQuota,
      page: result.page,
      // Keep a tiny sample of the first result's keys so we can see the schema
      // without logging PII. Helps detect when Lemlist changes its response shape.
      firstResultKeys: Array.isArray(result.results) && result.results[0]
        ? Object.keys(result.results[0]).slice(0, 20)
        : null,
    });
  } catch { /* logger optional */ }

  // Transform Lemlist results into Baakal's contact format
  // Schema: p.lead_linkedin_url (root), p.current_exp_company_name (root),
  // p.experiences[0].company_domain / company_website_url (nested)
  const contacts = (result.results || []).map(p => {
    const exp0 = Array.isArray(p.experiences) && p.experiences[0] ? p.experiences[0] : {};
    const companyDomain = exp0.company_domain || exp0.company_website_url || null;
    // Clean domain: strip protocol + trailing slash
    const cleanDomain = companyDomain
      ? String(companyDomain).replace(/^https?:\/\//, '').replace(/\/$/, '')
      : null;
    return {
      id: String(p.lead_id || p._id || Math.random()),
      firstName: (p.full_name || '').split(' ')[0] || '',
      lastName: (p.full_name || '').split(' ').slice(1).join(' ') || '',
      name: p.full_name || '',
      email: p.email || null,
      phone: p.phone || null,
      title: p.title || '',
      company: p.current_exp_company_name || exp0.company_name || '',
      companyDomain: cleanDomain,
      companySize: p.company_size || p.connections_count_bucket || null,
      sector: p.lead_industry || p.department || '',
      location: p.location || p.country || '',
      linkedinUrl: p.lead_linkedin_url || null,
      qualityScore: p.lead_quality_score || null,
      source: 'lemlist',
    };
  });

  return { contacts, diagnostics };
}

// --- Credits & Enrichment ---

async function getTeamCredits(apiKey) {
  return lemlistFetch('/team/credits', {}, apiKey);
}

/**
 * Fetch the list of senders (team members with their email/LinkedIn accounts).
 * GET /team/senders
 */
async function getTeamSenders(apiKey) {
  return lemlistFetch('/team/senders', {}, apiKey);
}

/**
 * Bulk enrichment — POST /api/v2/enrichments/bulk
 * items: array of { input: {firstName, lastName, companyName, linkedinUrl, ...}, metadata: anything }
 * Returns: array of { id, metadata } (success) or { error, metadata } (failure)
 */
async function bulkEnrichLeads(apiKey, items) {
  const body = items.map(item => ({
    input: item.input,
    enrichmentRequests: ['find_email'],
    metadata: item.metadata,
  }));
  // Uses /v2 prefix
  const url = `${BASE_URL.replace(/\/api$/, '')}/api/v2/enrichments/bulk`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`Lemlist bulk enrich ${res.status}: ${text}`), { status: res.status });
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });
}

/**
 * Get enrichment result — GET /api/enrich/{id}
 * Returns: 202 if still pending, 200 with data.email.email if done
 */
async function getEnrichmentResult(apiKey, enrichId) {
  const url = `${BASE_URL}/enrich/${enrichId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`,
    },
  });
  if (res.status === 202) {
    return { status: 'pending', enrichId };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Lemlist enrich result ${res.status}: ${text}`);
  }
  const data = await res.json();
  const emailObj = data?.data?.email || null;
  return {
    status: 'done',
    enrichId,
    email: emailObj && !emailObj.notFound ? emailObj.email : null,
    notFound: !!(emailObj && emailObj.notFound),
    raw: data,
  };
}

/**
 * Add a lead to a Lemlist campaign.
 *
 * Per Lemlist's current API (2026), the endpoint is:
 *   POST /api/campaigns/{campaignId}/leads
 * with the email IN THE REQUEST BODY (not the URL path, as in the old v1
 * form we were using, which silently 404'd and dropped every lead).
 *
 * `deduplicate=true` tells Lemlist to skip the lead cleanly if the email
 * already exists in the campaign instead of returning an error.
 */
async function addLead(campaignId, lead, apiKey) {
  const email = lead.email;
  if (!email) throw new Error('Lead must have an email');
  const body = {
    email,
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    companyName: lead.company || lead.companyName || '',
    jobTitle: lead.title || lead.jobTitle || '',
  };
  if (lead.linkedinUrl) body.linkedinUrl = lead.linkedinUrl;
  if (lead.phone) body.phone = lead.phone;
  if (lead.companyDomain) body.companyDomain = lead.companyDomain;

  return lemlistFetch(`/campaigns/${campaignId}/leads?deduplicate=true`, {
    method: 'POST',
    body: JSON.stringify(body),
  }, apiKey);
}

// --- Campaign endpoints ---

async function listCampaigns() {
  return lemlistFetch('/campaigns');
}

async function getCampaign(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}`);
}

async function getCampaignStats(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}/export`);
}

async function getSequences(campaignId, apiKey) {
  return lemlistFetch(`/campaigns/${campaignId}/sequences`, {}, apiKey);
}

async function updateSequenceStep(campaignId, stepId, data, apiKey) {
  return lemlistFetch(`/campaigns/${campaignId}/sequences/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, apiKey);
}

async function getWorkflow(campaignId) {
  return lemlistFetch(`/campaigns/${campaignId}/workflow`);
}

// --- Data transformation ---

function transformCampaignStats(raw) {
  // Transform raw Lemlist export into our internal format
  const stats = {
    contacts: 0,
    openRate: null,
    replyRate: null,
    acceptRate: null,
    interested: 0,
    meetings: 0,
    stops: null,
  };

  if (!raw || !Array.isArray(raw)) return stats;

  stats.contacts = raw.length;

  const withEmail = raw.filter((r) => r.emailsSent > 0);
  if (withEmail.length > 0) {
    const opened = raw.filter((r) => r.emailsOpened > 0).length;
    const replied = raw.filter((r) => r.emailsReplied > 0).length;
    const unsubscribed = raw.filter((r) => r.unsubscribeStatus === 'unsubscribed').length;
    stats.openRate = Math.round((opened / withEmail.length) * 100);
    stats.replyRate = Math.round((replied / withEmail.length) * 100);
    stats.stops = Math.round((unsubscribed / withEmail.length) * 100);
  }

  const withLinkedIn = raw.filter((r) => r.linkedinConnectionSent);
  if (withLinkedIn.length > 0) {
    const accepted = raw.filter((r) => r.linkedinConnectionAccepted).length;
    stats.acceptRate = Math.round((accepted / withLinkedIn.length) * 100);
  }

  const interested = raw.filter((r) => r.leadStatus === 'interested');
  stats.interested = interested.length;

  return stats;
}

function transformStepStats(raw, stepIndex) {
  if (!raw || !Array.isArray(raw)) return null;

  const step = {};
  const relevant = raw.filter((r) => (r.emailsSent || 0) > stepIndex || r.sequenceStep > stepIndex);

  if (relevant.length === 0) return null;

  const opened = relevant.filter((r) => r[`emailOpened_${stepIndex}`]).length;
  const replied = relevant.filter((r) => r[`emailReplied_${stepIndex}`]).length;

  step.open = relevant.length > 0 ? Math.round((opened / relevant.length) * 100) : 0;
  step.reply = relevant.length > 0 ? Math.round((replied / relevant.length) * 100) : 0;

  return step;
}

// --- Workflow / branching tree transformation ---

function transformWorkflowToTree(workflow) {
  if (!workflow || !workflow.steps) return [];

  const CONDITION_LABELS = {
    opened: 'Si ouvert',
    not_opened: 'Si pas ouvert',
    replied: 'Si répondu',
    not_replied: 'Si pas répondu',
    clicked: 'Si cliqué',
    not_clicked: 'Si pas cliqué',
    accepted: 'Si accepté',
    not_accepted: 'Si pas accepté',
    default: 'Par défaut',
  };

  function mapNode(node, parentId = null, condition = null, sortOrder = 0) {
    const step = {
      step: node.step || node.name || `S${sortOrder + 1}`,
      type: node.type === 'linkedin_connection' ? 'linkedin' : 'email',
      label: node.label || node.name || '',
      subType: node.subType || '',
      timing: node.delay ? `J+${node.delay}` : 'J+0',
      subject: node.subject || null,
      body: node.body || node.text || '',
      maxChars: node.type === 'linkedin_connection' ? 300 : null,
      parentStepId: parentId,
      conditionType: condition,
      conditionValue: null,
      branchLabel: condition ? (CONDITION_LABELS[condition] || condition) : null,
      isRoot: !parentId,
      sortOrder,
      children: [],
    };

    let nextSort = sortOrder + 1;

    if (node.conditions && Array.isArray(node.conditions)) {
      for (const cond of node.conditions) {
        if (cond.steps && Array.isArray(cond.steps)) {
          for (const child of cond.steps) {
            const childNode = mapNode(child, node.id, cond.type || cond.condition, nextSort);
            step.children.push(childNode);
            nextSort = childNode._nextSort || nextSort + 1;
          }
        }
      }
    }

    if (node.next && Array.isArray(node.next)) {
      for (const next of node.next) {
        const childNode = mapNode(next, node.id, 'default', nextSort);
        step.children.push(childNode);
        nextSort = childNode._nextSort || nextSort + 1;
      }
    }

    step._nextSort = nextSort;
    return step;
  }

  const roots = (workflow.steps || []).filter(s => !s.parentId);
  return roots.map((r, i) => mapNode(r, null, null, i));
}

function flattenTree(tree) {
  const result = [];
  function walk(nodes) {
    for (const node of nodes) {
      const { children, _nextSort, ...rest } = node;
      result.push(rest);
      if (children && children.length > 0) walk(children);
    }
  }
  walk(Array.isArray(tree) ? tree : [tree]);
  return result;
}

module.exports = {
  listCampaigns,
  getCampaign,
  getCampaignStats,
  getSequences,
  updateSequenceStep,
  getWorkflow,
  createCampaign,
  startCampaign,
  resolveSequenceId,
  addSequenceStep,
  addLead,
  searchPeopleDatabase,
  getDatabaseFilters,
  getTeamCredits,
  getTeamSenders,
  bulkEnrichLeads,
  getEnrichmentResult,
  transformCampaignStats,
  transformStepStats,
  transformWorkflowToTree,
  flattenTree,
};
