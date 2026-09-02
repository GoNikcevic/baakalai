/**
 * Santé financière — Royaume-Uni. Gratuit, clé requise (COMPANIES_HOUSE_API_KEY).
 *
 * Companies House Public Data API :
 * https://developer-specs.company-information.service.gov.uk/
 * Auth HTTP Basic, la clé en username, mot de passe vide.
 *
 * company_status possibles (doc CompanyProfile) : active, dissolved, liquidation,
 * receivership, administration, voluntary-arrangement, converted-closed,
 * insolvency-proceedings, registered, removed, closed, open.
 * has_been_liquidated / has_insolvency_history sont dépréciés et purement
 * historiques : jamais de signal dessus, on les garde juste dans raw.
 */

const { nameMatches } = require('./name-match');

const BASE_URL = 'https://api.company-information.service.gov.uk';

const COUNTRY = 'GB';
const TIMEOUT_MS = 10000;

// Statuts traduisant une procédure d'insolvabilité en cours.
const INSOLVENCY_STATUSES = new Set([
  'liquidation',
  'administration',
  'receivership',
  'insolvency-proceedings',
  'voluntary-arrangement',
]);
const ACTIVE_STATUSES = new Set(['active', 'registered', 'open']);
const INSOLVENCY_LABELS = {
  liquidation: 'liquidation',
  administration: 'administration',
  receivership: 'mise sous séquestre (receivership)',
  'insolvency-proceedings': "procédure d'insolvabilité",
  'voluntary-arrangement': 'arrangement volontaire (CVA)',
};

function available() {
  return !!process.env.COMPANIES_HOUSE_API_KEY;
}

/** dd/mm/yyyy pour les details en français. */
function frDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

async function chFetch(path) {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) {
    throw Object.assign(
      new Error('COMPANIES_HOUSE_API_KEY non configurée. Ajoutez-la dans les variables Railway.'),
      { code: 'KEY_MISSING', status: 503 }
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      // Basic auth : clé en username, mot de passe vide.
      Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) {
    throw Object.assign(
      new Error('Companies House 429: quota dépassé (600 req/5 min).'),
      { code: 'QUOTA_EXCEEDED', status: 429 }
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Companies House ${res.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: res.status }
    );
  }
  return res.json();
}

/**
 * Recherche une société britannique et son statut au registre.
 * @param {string} companyName
 * @returns {Promise<{matched, registryId, status, signals, raw}>}
 */
async function lookup(companyName, opts = {}) {
  const params = new URLSearchParams({ q: companyName, items_per_page: '3' });
  const search = await chFetch(`/search/companies?${params}`);

  // Matching défensif : premier résultat dont le nom correspond vraiment.
  const item = ((search && search.items) || []).find(i => nameMatches(companyName, i.title));
  if (!item || !item.company_number) {
    return { matched: false, registryId: null, status: 'not_found', signals: [], raw: {} };
  }

  // Le profil est la source de vérité (la search peut être en retard).
  const profile = await chFetch(`/company/${item.company_number}`);
  if (!profile) {
    return { matched: false, registryId: null, status: 'not_found', signals: [], raw: {} };
  }

  const companyStatus = profile.company_status || '';
  const signals = [];
  let status = 'unknown';

  if (INSOLVENCY_STATUSES.has(companyStatus)) {
    status = 'insolvency';
    signals.push({
      signal_type: 'insolvency_proceeding',
      detail: `Société en ${INSOLVENCY_LABELS[companyStatus]} (Companies House)`,
    });
  } else if (companyStatus === 'dissolved') {
    status = 'dissolved';
    const quand = frDate(profile.date_of_cessation);
    signals.push({
      signal_type: 'company_dissolved',
      detail: `Société dissoute (Companies House)${quand ? ` — ${quand}` : ''}`,
    });
  } else if (ACTIVE_STATUSES.has(companyStatus)) {
    status = 'active';
  }
  // converted-closed / removed / closed : radiations administratives ambiguës
  // (fusion, conversion…) — on reste sur 'unknown' plutôt qu'une fausse alerte.

  return {
    matched: true,
    registryId: profile.company_number || item.company_number,
    status,
    signals,
    raw: {
      company_number: profile.company_number || item.company_number,
      company_name: profile.company_name || item.title,
      company_status: companyStatus || null,
      company_status_detail: profile.company_status_detail || null,
      date_of_cessation: profile.date_of_cessation || null,
      // Historiques (dépréciés côté API) : jamais de signal, info seulement.
      has_been_liquidated: profile.has_been_liquidated || false,
      has_insolvency_history: profile.has_insolvency_history || false,
    },
  };
}

module.exports = { COUNTRY, available, lookup };
