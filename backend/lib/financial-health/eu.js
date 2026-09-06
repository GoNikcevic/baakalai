/**
 * Santé financière — reste de l'Europe. Clé requise (OPENCORPORATES_API_KEY).
 *
 * OpenCorporates API v0.4 :
 * https://api.opencorporates.com/documentation/API-Reference
 * GET /v0.4/companies/search?q=&jurisdiction_code=&api_token=
 * → results.companies[].company { name, company_number, jurisdiction_code,
 *   current_status, inactive, dissolution_date, ... }
 *
 * Sans clé le quota anonyme est trop fragile pour un cron : available() = false.
 * Clé gratuite : 50 req/jour, 200/mois — c'est l'orchestrateur qui limite le
 * volume, mais on throw QUOTA_EXCEEDED sur 403/429 en garde-fou.
 *
 * Les statuts sont libres et localisés selon le registre (« In liquidation »,
 * « Insolvenzverfahren », « Konkurs »…) — on classe par mots-clés.
 */

const { nameMatches } = require('./name-match');

const SEARCH_URL = 'https://api.opencorporates.com/v0.4/companies/search';

const COUNTRY = 'EU';
const TIMEOUT_MS = 10000;

// Mots-clés d'insolvabilité dans les statuts des registres européens.
const INSOLVENCY_RE = /liquidat|insolven|bankrupt|konkurs|faillite|faillissement|quiebra|concurso|fallimento/i;
const DISSOLVED_RE = /dissolved|dissolution|removed|struck off|radi[ée]e?|gel[öo]scht|cerrada|cessata/i;
const ACTIVE_RE = /active|normal|registered|in bedrijf|actif|aktiv/i;

function available() {
  return !!process.env.OPENCORPORATES_API_KEY;
}

/** dd/mm/yyyy pour les details en français. */
function frDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

/**
 * Recherche une société européenne dans le registre de sa juridiction.
 * @param {string} companyName
 * @param {{ jurisdiction?: string }} opts — code juridiction minuscule
 *   ('be', 'de', 'nl', …) fourni par l'orchestrateur.
 * @returns {Promise<{matched, registryId, status, signals, raw}>}
 */
async function lookup(companyName, opts = {}) {
  const apiToken = process.env.OPENCORPORATES_API_KEY;
  if (!apiToken) {
    throw Object.assign(
      new Error('OPENCORPORATES_API_KEY non configurée. Ajoutez-la dans les variables Railway.'),
      { code: 'KEY_MISSING', status: 503 }
    );
  }

  const params = new URLSearchParams({
    q: companyName,
    order: 'score',
    per_page: '5',
    api_token: apiToken,
  });
  if (opts.jurisdiction) params.set('jurisdiction_code', String(opts.jurisdiction).toLowerCase());

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 403 = « rate limiting » chez OpenCorporates (50/jour en clé gratuite).
  if (res.status === 403 || res.status === 429) {
    throw Object.assign(
      new Error(`OpenCorporates ${res.status}: quota dépassé (50 req/jour en clé gratuite).`),
      { code: 'QUOTA_EXCEEDED', status: res.status }
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`OpenCorporates ${res.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: res.status }
    );
  }

  const data = await res.json();
  const companies = ((data.results && data.results.companies) || []).map(c => c.company).filter(Boolean);
  // Matching défensif : premier résultat dont le nom correspond vraiment.
  const company = companies.find(c => nameMatches(companyName, c.name));
  if (!company) {
    return { matched: false, registryId: null, status: 'not_found', signals: [], raw: {} };
  }

  const currentStatus = company.current_status || '';
  const signals = [];
  let status = 'unknown';

  if (INSOLVENCY_RE.test(currentStatus)) {
    status = 'insolvency';
    signals.push({
      signal_type: 'insolvency_proceeding',
      detail: `Statut registre ${(company.jurisdiction_code || '').toUpperCase()} : « ${currentStatus} » (OpenCorporates)`,
    });
  } else if (DISSOLVED_RE.test(currentStatus) || (company.inactive === true && company.dissolution_date)) {
    status = 'dissolved';
    const quand = frDate(company.dissolution_date);
    signals.push({
      signal_type: 'company_dissolved',
      detail: `Société radiée du registre${quand ? ` — ${quand}` : ''} (OpenCorporates)`,
    });
  } else if (company.inactive === false || ACTIVE_RE.test(currentStatus)) {
    status = 'active';
  }
  // Statut exotique non classé : 'unknown', pas de fausse alerte.

  return {
    matched: true,
    registryId: company.company_number || null,
    status,
    signals,
    raw: {
      name: company.name,
      company_number: company.company_number || null,
      jurisdiction_code: company.jurisdiction_code || null,
      current_status: currentStatus || null,
      inactive: company.inactive ?? null,
      dissolution_date: company.dissolution_date || null,
    },
  };
}

module.exports = { COUNTRY, available, lookup };
