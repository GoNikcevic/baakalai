/**
 * Web-based prospect search agent.
 *
 * When Lemlist returns few/no results for specific companies, this agent
 * uses Brave Search to find contacts via public web data (LinkedIn
 * snippets, company "team" pages, press releases, etc.) and Claude
 * Haiku to parse the results into structured contacts.
 */

const { webSearch } = require('../api/brave-search');
const { config } = require('../config');
const logger = require('./logger');

// Use Haiku for snippet parsing — cheap and fast.
const PARSE_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Search for prospect contacts at specific companies using web search.
 *
 * @param {string[]} companies - Target company names
 * @param {string[]} titles - Target job titles
 * @param {object} [options]
 * @param {number} [options.batchSize=3] - Companies to search in parallel
 * @param {string} [options.location] - Optional location filter (e.g. "France")
 * @returns {{ contacts, companiesSearched, companiesWithResults, companiesWithoutResults }}
 */
async function searchProspectsWeb(companies, titles, options = {}) {
  const { batchSize = 3, location } = options;
  const allContacts = [];
  const companiesWithResults = [];
  const companiesWithoutResults = [];
  const errors = [];

  // Build title query part: "Directeur R&D" OR "Directeur Innovation"
  const titleQuery = titles.slice(0, 3).map(t => `"${t}"`).join(' OR ');
  const locationSuffix = location ? ` ${location}` : '';

  // Process in batches to respect rate limits
  for (let i = 0; i < companies.length; i += batchSize) {
    const batch = companies.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (company) => {
        try {
          // Multiple search angles to maximize coverage:
          const queries = [
            // 1. LinkedIn profiles with exact title match
            { q: `${titleQuery} "${company}" site:linkedin.com/in`, n: 10 },
            // 2. LinkedIn profiles with broader company match
            { q: `"${company}" director R&D innovation site:linkedin.com/in`, n: 5 },
            // 3. Company team/management page (FR)
            { q: `"${company}" equipe direction R&D`, n: 5 },
            // 4. Company team page (EN)
            { q: `"${company}" team management R&D leadership`, n: 5 },
            // 5. Press releases / announcements mentioning key people
            { q: `"${company}" nomme directeur R&D OR innovation OR operations`, n: 5 },
          ];

          const allResults = [];
          const seenUrls = new Set();

          for (const { q, n } of queries) {
            try {
              const results = await webSearch(q + locationSuffix, n);
              // Dedupe by URL across queries
              for (const r of results) {
                if (!seenUrls.has(r.url)) {
                  seenUrls.add(r.url);
                  allResults.push(r);
                }
              }
            } catch (err) {
              // Individual query failure is non-fatal — continue with others
              logger.warn('web-prospect-agent', `Query failed for "${company}": ${err.message}`);
            }
          }

          logger.info('web-prospect-agent', `"${company}": ${allResults.length} unique results from ${queries.length} queries`, {
            sample: allResults.slice(0, 3).map(r => r.title).join(' | '),
          });

          if (allResults.length === 0) {
            return { company, contacts: [] };
          }

          // Parse snippets with Claude Haiku
          const contacts = await parseSearchResults(allResults, company, titles);
          logger.info('web-prospect-agent', `"${company}": Haiku extracted ${contacts.length} contacts`);
          return { company, contacts };
        } catch (err) {
          logger.warn('web-prospect-agent', `Search failed for "${company}": ${err.message}`);
          return { company, contacts: [], error: err.message };
        }
      })
    );

    for (const { company, contacts, error } of batchResults) {
      if (contacts.length > 0) {
        companiesWithResults.push(company);
        allContacts.push(...contacts.map(c => ({ ...c, company, source: 'web_search' })));
      } else {
        companiesWithoutResults.push(company);
        if (error) errors.push({ company, error });
      }
    }

    // Small delay between batches to be polite to Brave API
    if (i + batchSize < companies.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Dedupe by linkedinUrl or name+company
  const seen = new Set();
  const deduped = allContacts.filter(c => {
    const key = c.linkedinUrl || `${c.name}@${c.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    contacts: deduped,
    companiesSearched: companies.length,
    companiesWithResults: companiesWithResults.length,
    companiesWithoutResults,
    errors,
  };
}

/**
 * Use Claude Haiku to parse web search snippets into structured contacts.
 */
async function parseSearchResults(searchResults, company, titles) {
  const Anthropic = require('@anthropic-ai/sdk');
  const apiKey = config.claude.apiKey;
  if (!apiKey) return [];

  const client = new Anthropic({ apiKey });

  const snippetsText = searchResults
    .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.description}`)
    .join('\n\n');

  const titlesText = titles.join(', ');

  try {
    const response = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: 2000,
      system: [
        'Tu es un extracteur de contacts professionnels expert.',
        'A partir de snippets de recherche web, extrais TOUTES les personnes identifiables qui travaillent chez "' + company + '" ou une filiale/division de "' + company + '".',
        'Titres recherches : ' + titlesText + '. Mais inclus aussi les profils proches (VP R&D, Head of Innovation, Chief Scientific Officer, Responsable R&D, etc.).',
        'Sois EXHAUSTIF : si un snippet mentionne un nom + un poste + cette entreprise, inclus-le meme si le titre ne matche pas exactement.',
        '',
        'Pour chaque contact, retourne : {"name": "Prenom Nom", "firstName": "Prenom", "lastName": "Nom", "title": "Titre exact trouve", "linkedinUrl": "https://linkedin.com/in/xxx"}',
        'Si le linkedinUrl n\'est pas disponible, mets null.',
        'Retourne UNIQUEMENT un tableau JSON []. Pas de texte autour. Si aucun contact, retourne [].',
      ].join('\n'),
      messages: [{ role: 'user', content: snippetsText }],
    });

    const text = response.content[0].text.trim();
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate and clean
    return parsed
      .filter(c => c.name && typeof c.name === 'string')
      .map(c => ({
        id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: c.name,
        firstName: c.firstName || c.name.split(' ')[0] || '',
        lastName: c.lastName || c.name.split(' ').slice(1).join(' ') || '',
        title: c.title || '',
        linkedinUrl: c.linkedinUrl || null,
      }));
  } catch (err) {
    logger.warn('web-prospect-agent', `Claude parse failed for "${company}": ${err.message}`);
    return [];
  }
}

module.exports = { searchProspectsWeb };
