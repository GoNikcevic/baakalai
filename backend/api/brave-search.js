/**
 * Brave Search API wrapper.
 * Docs: https://api.search.brave.com/app#/documentation/web-search
 */

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const BASE_URL = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Run a web search via Brave Search API.
 * @param {string} query — search query
 * @param {number} count — max results (default 5, max 20)
 * @returns {Array<{title, url, description, age}>}
 */
async function webSearch(query, count = 5) {
  if (!BRAVE_API_KEY) {
    throw Object.assign(
      new Error('BRAVE_SEARCH_API_KEY non configurée. Ajoutez-la dans les variables Railway.'),
      { code: 'BRAVE_KEY_MISSING', status: 503 }
    );
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    search_lang: 'fr',
    country: 'FR',
  });

  const res = await fetch(`${BASE_URL}?${params}`, {
    headers: {
      'X-Subscription-Token': BRAVE_API_KEY,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Brave Search ${res.status}: ${body.slice(0, 200) || '(empty)'}`),
      { status: res.status }
    );
  }

  const data = await res.json();
  const results = (data.web?.results || []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
    age: r.age || null,
  }));

  return results;
}

module.exports = { webSearch };
