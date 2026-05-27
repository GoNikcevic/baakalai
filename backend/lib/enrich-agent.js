/**
 * Enrich Agent — Find missing data for existing contacts
 *
 * Uses Brave Search + Claude Haiku to enrich contacts that have:
 * - Missing email: search "{name} {company} email" → extract from web
 * - Missing company: search "{name} {title}" → find company
 *
 * No external paid API required (Apollo, Clearbit, etc.)
 * Cost: ~$0.002/contact (1 Brave query + 1 Haiku call)
 */

const { webSearch } = require('../api/brave-search');
const { config } = require('../config');
const db = require('../db');
const logger = require('./logger');

const PARSE_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Enrich a batch of contacts with missing data.
 * @param {string} userId
 * @param {'missing_email'|'missing_company'|'all'} issueType
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max contacts to enrich per run
 * @param {string[]} [options.contactIds] - Specific contact IDs to enrich (optional)
 * @returns {{ enriched, notFound, errors, total }}
 */
async function enrichContacts(userId, issueType = 'all', options = {}) {
  const { limit = 20, contactIds } = options;
  const report = { enriched: 0, notFound: 0, errors: [], total: 0 };

  // Load contacts to enrich
  let contacts;
  if (contactIds?.length > 0) {
    const result = await db.query(
      'SELECT id, name, email, company, title FROM opportunities WHERE user_id = $1 AND id = ANY($2)',
      [userId, contactIds]
    );
    contacts = result.rows;
  } else {
    const result = await db.query(
      `SELECT id, name, email, company, title FROM opportunities WHERE user_id = $1
       AND (($2 = 'missing_email' AND (email IS NULL OR email = ''))
         OR ($2 = 'missing_company' AND (company IS NULL OR company = '') AND name != 'Unknown')
         OR ($2 = 'all' AND ((email IS NULL OR email = '') OR (company IS NULL OR company = ''))))
       LIMIT $3`,
      [userId, issueType, limit]
    );
    contacts = result.rows;
  }

  report.total = contacts.length;
  if (contacts.length === 0) return report;

  // Process in batches of 5 to respect Brave rate limits
  for (let i = 0; i < contacts.length; i += 5) {
    const batch = contacts.slice(i, i + 5);

    const results = await Promise.all(
      batch.map(contact => enrichOne(contact).catch(err => {
        report.errors.push(`${contact.name}: ${err.message}`);
        return null;
      }))
    );

    for (let j = 0; j < batch.length; j++) {
      const contact = batch[j];
      const enriched = results[j];

      if (!enriched) { report.notFound++; continue; }

      const updates = {};
      if (enriched.email && (!contact.email || contact.email === '')) updates.email = enriched.email;
      if (enriched.company && (!contact.company || contact.company === '')) updates.company = enriched.company;
      if (enriched.title && (!contact.title || contact.title === '')) updates.title = enriched.title;
      if (enriched.linkedinUrl) updates.linkedin_url = enriched.linkedinUrl;

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates).map((k, idx) => `${k} = $${idx + 2}`);
        const values = [contact.id, ...Object.values(updates)];
        await db.query(
          `UPDATE opportunities SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1`,
          values
        );
        report.enriched++;
        logger.info('enrich-agent', `Enriched ${contact.name}: ${Object.keys(updates).join(', ')}`);
      } else {
        report.notFound++;
      }
    }

    // Rate limit pause between batches
    if (i + 5 < contacts.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  return report;
}

/**
 * Enrich a single contact using web search + Claude Haiku.
 */
async function enrichOne(contact) {
  const needsEmail = !contact.email || contact.email === '';
  const needsCompany = !contact.company || contact.company === '';
  const name = (contact.name || '').trim();

  if (!name || name === 'Unknown') return null;

  // Build search queries based on what's missing
  const queries = [];
  if (needsEmail && contact.company) {
    queries.push(`"${name}" "${contact.company}" email`);
    queries.push(`"${name}" "${contact.company}" site:linkedin.com/in`);
  } else if (needsEmail) {
    queries.push(`"${name}" ${contact.title || ''} email`);
    queries.push(`"${name}" site:linkedin.com/in`);
  }
  if (needsCompany) {
    queries.push(`"${name}" ${contact.title || ''} company`);
    queries.push(`"${name}" site:linkedin.com/in`);
  }

  // Dedupe queries
  const uniqueQueries = [...new Set(queries)].slice(0, 3);

  // Run searches
  const allResults = [];
  const seenUrls = new Set();
  for (const q of uniqueQueries) {
    try {
      const results = await webSearch(q, 5);
      for (const r of results) {
        if (!seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          allResults.push(r);
        }
      }
    } catch { /* continue with other queries */ }
  }

  if (allResults.length === 0) return null;

  // Parse with Claude Haiku
  return parseEnrichResults(allResults, contact, { needsEmail, needsCompany });
}

/**
 * Use Claude Haiku to extract enrichment data from search snippets.
 */
async function parseEnrichResults(searchResults, contact, { needsEmail, needsCompany }) {
  const apiKey = config.claude.apiKey;
  if (!apiKey) return null;

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const snippets = searchResults
    .slice(0, 10)
    .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.description}`)
    .join('\n\n');

  const missing = [];
  if (needsEmail) missing.push('email');
  if (needsCompany) missing.push('company');

  try {
    const response = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: 500,
      system: [
        `Extract missing contact data from web search snippets.`,
        `Contact: "${contact.name}"${contact.company ? ` at "${contact.company}"` : ''}${contact.title ? `, ${contact.title}` : ''}.`,
        `Missing fields: ${missing.join(', ')}.`,
        '',
        'Rules:',
        '- Only return data that clearly matches this specific person (same name + context).',
        '- For email: look for explicit email addresses in snippets. Common patterns: name@company.com visible in text.',
        '- For company: look for employer name in LinkedIn snippets or bios.',
        '- For linkedinUrl: extract from URL field if it matches this person.',
        '- If you cannot find reliable data for a field, set it to null.',
        '',
        'Return ONLY valid JSON: {"email": "...|null", "company": "...|null", "title": "...|null", "linkedinUrl": "...|null"}',
      ].join('\n'),
      messages: [{ role: 'user', content: snippets }],
    });

    const text = response.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);

    // Validate email format
    if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) {
      parsed.email = null;
    }

    return {
      email: parsed.email || null,
      company: parsed.company || null,
      title: parsed.title || null,
      linkedinUrl: parsed.linkedinUrl || null,
    };
  } catch (err) {
    logger.warn('enrich-agent', `Haiku parse failed for ${contact.name}: ${err.message}`);
    return null;
  }
}

module.exports = { enrichContacts, enrichOne };
