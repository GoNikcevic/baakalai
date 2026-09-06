/**
 * Santé financière — USA. Gratuit, token optionnel (COURTLISTENER_API_TOKEN).
 *
 * CourtListener Search API v4 (dockets RECAP, type=r) :
 * https://www.courtlistener.com/help/api/rest/search/
 * Requête fielded vérifiée en réel : caseName:"..." AND chapter:(7 OR 11)
 * AND dateFiled:[YYYY-MM-DD TO *] — le paramètre `court` n'accepte pas de
 * wildcard, on filtre donc côté client sur les cours de faillite (id en *b).
 *
 * Sans token le rate limit est plus bas — acceptable pour un cron hebdo.
 * Pas de notion de « dissolved » ici : on ne détecte que les faillites
 * Chapter 7/11 des 12 derniers mois.
 */

const { significantTokens } = require('./name-match');

const SEARCH_URL = 'https://www.courtlistener.com/api/rest/v4/search/';

const COUNTRY = 'US';
const TIMEOUT_MS = 10000;
const LOOKBACK_MONTHS = 12;

/** Token optionnel : disponible même sans (rate limit anonyme plus bas). */
function available() {
  return true;
}

/** dd/mm/yyyy pour les details en français. */
function frDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : null;
}

/**
 * Homonymie US ++ : on exige que TOUS les tokens significatifs du nom demandé
 * apparaissent dans le caseName (« In re Rite Aid Corporation », filiales…).
 */
function caseNameMatches(companyName, caseName) {
  const queryTokens = significantTokens(companyName);
  if (!queryTokens.length) return false;
  const caseTokens = new Set(significantTokens(caseName));
  return queryTokens.every(t => caseTokens.has(t));
}

/**
 * Recherche une faillite Chapter 7/11 récente pour une société US.
 * @param {string} companyName
 * @returns {Promise<{matched, registryId, status, signals, raw}>}
 */
async function lookup(companyName, opts = {}) {
  const since = new Date();
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);

  // Les guillemets casseraient la requête fielded — on les retire du nom.
  const safeName = String(companyName || '').replace(/"/g, ' ').trim();
  const q = `caseName:"${safeName}" AND chapter:(7 OR 11) AND dateFiled:[${since.toISOString().slice(0, 10)} TO *]`;
  const params = new URLSearchParams({ type: 'r', q, order_by: 'dateFiled desc' });

  const headers = { Accept: 'application/json' };
  if (process.env.COURTLISTENER_API_TOKEN) {
    headers.Authorization = `Token ${process.env.COURTLISTENER_API_TOKEN}`;
  }

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) {
    throw Object.assign(
      new Error('CourtListener 429: rate limit atteint (ajoutez COURTLISTENER_API_TOKEN pour le relever).'),
      { code: 'QUOTA_EXCEEDED', status: 429 }
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`CourtListener ${res.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: res.status }
    );
  }

  const data = await res.json();
  // Cours de faillite uniquement (court_id en *b : njb, nysb, deb…) + chapitre
  // 7/11 + matching strict du nom. Le tri dateFiled desc met le plus récent devant.
  const docket = (data.results || []).find(r =>
    /b$/.test(r.court_id || '') &&
    ['7', '11'].includes(String(r.chapter)) &&
    caseNameMatches(companyName, r.caseName)
  );

  if (!docket) {
    return { matched: false, registryId: null, status: 'not_found', signals: [], raw: {} };
  }

  const quand = frDate(docket.dateFiled);
  return {
    matched: true,
    registryId: docket.docketNumber || null,
    status: 'insolvency',
    signals: [{
      signal_type: 'insolvency_proceeding',
      detail: `Faillite Chapter ${docket.chapter}${quand ? ` — déposée le ${quand}` : ''} (${docket.court_citation_string || docket.court})`,
    }],
    raw: {
      caseName: docket.caseName,
      docketNumber: docket.docketNumber,
      chapter: docket.chapter,
      court_id: docket.court_id,
      court: docket.court,
      dateFiled: docket.dateFiled,
      dateTerminated: docket.dateTerminated || null,
    },
  };
}

module.exports = { COUNTRY, available, lookup };
