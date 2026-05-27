/**
 * Enrich Agent v2 — Smart enrichment for existing contacts
 *
 * 5 strategies layered for maximum hit rate:
 *
 * 1. Email pattern guessing: name + company domain → generate candidates
 *    (prenom.nom@, pnom@, prenom@, etc.) then SMTP verify
 * 2. Pattern memory: if we found the pattern for a company before,
 *    apply it instantly (0 API calls)
 * 3. Cascade: missing company → find company first → then find email
 * 4. Web search + Haiku: Brave Search → Claude Haiku extraction (fallback)
 * 5. SMTP verification: validate guessed/found emails without sending
 *
 * No external paid API required (Apollo, Clearbit, etc.)
 * Cost: ~$0.001-0.003/contact
 */

const net = require('net');
const dns = require('dns').promises;
const { webSearch } = require('../api/brave-search');
const { config } = require('../config');
const db = require('../db');
const logger = require('./logger');

const PARSE_MODEL = 'claude-haiku-4-5-20251001';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In-memory pattern cache (persists across calls within same process)
const _domainPatternCache = new Map();

// ═══════════════════════════════════════════════════════════════
// STRATEGY 1: Email pattern guessing
// ═══════════════════════════════════════════════════════════════

function generateEmailCandidates(name, domain) {
  const parts = name.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2 || !domain) return [];

  const first = parts[0].normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove accents
  const last = parts[parts.length - 1].normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return [
    `${first}.${last}@${domain}`,      // prenom.nom@
    `${first[0]}${last}@${domain}`,     // pnom@
    `${first}@${domain}`,               // prenom@
    `${last}@${domain}`,                // nom@
    `${first}${last}@${domain}`,        // prenomnom@
    `${first[0]}.${last}@${domain}`,    // p.nom@
    `${first}-${last}@${domain}`,       // prenom-nom@
    `${first}_${last}@${domain}`,       // prenom_nom@
  ];
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 2: Pattern memory per company domain
// ═══════════════════════════════════════════════════════════════

async function getKnownPattern(domain) {
  // Check in-memory cache first
  if (_domainPatternCache.has(domain)) return _domainPatternCache.get(domain);

  // Check DB: find emails from same domain that we already have
  try {
    const result = await db.query(
      `SELECT email FROM opportunities WHERE email ILIKE $1 AND email IS NOT NULL LIMIT 10`,
      [`%@${domain}`]
    );
    if (result.rows.length === 0) return null;

    // Detect which pattern these emails follow
    const pattern = detectPattern(result.rows.map(r => r.email));
    if (pattern) {
      _domainPatternCache.set(domain, pattern);
      logger.info('enrich-agent', `Learned pattern for @${domain}: ${pattern}`);
    }
    return pattern;
  } catch { return null; }
}

function detectPattern(emails) {
  // Count which pattern type each email matches
  // We can't reverse-engineer without names, but we can detect common formats
  const patterns = {};
  for (const email of emails) {
    const local = email.split('@')[0].toLowerCase();
    if (/^[a-z]+\.[a-z]+$/.test(local)) patterns['first.last'] = (patterns['first.last'] || 0) + 1;
    else if (/^[a-z][a-z]+$/.test(local) && local.length <= 6) patterns['first'] = (patterns['first'] || 0) + 1;
    else if (/^[a-z]\.[a-z]+$/.test(local)) patterns['f.last'] = (patterns['f.last'] || 0) + 1;
    else if (/^[a-z][a-z]+$/.test(local) && local.length > 6) patterns['firstlast'] = (patterns['firstlast'] || 0) + 1;
    else if (/^[a-z]-[a-z]+$/.test(local)) patterns['first-last'] = (patterns['first-last'] || 0) + 1;
  }
  // Return most common pattern (need at least 2 matches)
  const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  return sorted[0] && sorted[0][1] >= 2 ? sorted[0][0] : null;
}

function applyPattern(name, domain, pattern) {
  const parts = name.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const last = parts[parts.length - 1].normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  switch (pattern) {
    case 'first.last': return `${first}.${last}@${domain}`;
    case 'f.last': return `${first[0]}.${last}@${domain}`;
    case 'first': return `${first}@${domain}`;
    case 'firstlast': return `${first}${last}@${domain}`;
    case 'first-last': return `${first}-${last}@${domain}`;
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 5: SMTP verification
// ═══════════════════════════════════════════════════════════════

async function getMxHost(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return null;
    records.sort((a, b) => a.priority - b.priority);
    return records[0].exchange;
  } catch { return null; }
}

/**
 * Verify an email exists via SMTP RCPT TO (without sending).
 * Returns: 'valid' | 'invalid' | 'unknown' (server doesn't tell us)
 */
async function smtpVerify(email, mxHost) {
  if (!mxHost) return 'unknown';

  return new Promise((resolve) => {
    const timeout = setTimeout(() => { socket.destroy(); resolve('unknown'); }, 5000);
    const socket = net.createConnection(25, mxHost);
    let step = 0;
    let response = '';

    socket.setEncoding('utf8');
    socket.on('error', () => { clearTimeout(timeout); resolve('unknown'); });
    socket.on('timeout', () => { socket.destroy(); clearTimeout(timeout); resolve('unknown'); });
    socket.setTimeout(5000);

    socket.on('data', (data) => {
      response += data;
      if (step === 0 && response.includes('220')) {
        step = 1;
        socket.write(`EHLO baakal.ai\r\n`);
        response = '';
      } else if (step === 1 && response.includes('250')) {
        step = 2;
        socket.write(`MAIL FROM:<verify@baakal.ai>\r\n`);
        response = '';
      } else if (step === 2 && response.includes('250')) {
        step = 3;
        socket.write(`RCPT TO:<${email}>\r\n`);
        response = '';
      } else if (step === 3) {
        clearTimeout(timeout);
        socket.write('QUIT\r\n');
        socket.destroy();
        if (response.includes('250')) resolve('valid');
        else if (response.includes('550') || response.includes('553') || response.includes('511')) resolve('invalid');
        else resolve('unknown'); // 450, 451, greylisting, catch-all
      }
    });
  });
}

/**
 * Try to verify a list of email candidates against SMTP.
 * Returns the first valid email, or null.
 */
async function findValidEmail(candidates, domain) {
  const mxHost = await getMxHost(domain);
  if (!mxHost) return null;

  // Test candidates sequentially (max 4 to avoid being flagged)
  for (const email of candidates.slice(0, 4)) {
    try {
      const result = await smtpVerify(email, mxHost);
      if (result === 'valid') return email;
      if (result === 'invalid') continue;
      // 'unknown' — server doesn't tell us, stop trying (catch-all or greylisting)
      return null;
    } catch { continue; }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 3 & 4: Web search + company domain discovery
// ═══════════════════════════════════════════════════════════════

async function findCompanyDomain(company) {
  if (!company) return null;
  try {
    const results = await webSearch(`"${company}" site officiel`, 3);
    // Look for company domain in results
    for (const r of results) {
      try {
        const url = new URL(r.url);
        const host = url.hostname.replace(/^www\./, '');
        // Skip common non-company domains
        if (['linkedin.com', 'facebook.com', 'twitter.com', 'wikipedia.org', 'youtube.com',
             'instagram.com', 'github.com', 'crunchbase.com'].includes(host)) continue;
        return host;
      } catch { continue; }
    }
  } catch { /* Brave search failed */ }
  return null;
}

async function findCompanyFromWeb(name, title) {
  if (!name || name === 'Unknown') return null;
  try {
    const query = title ? `"${name}" "${title}" entreprise OR company` : `"${name}" site:linkedin.com/in`;
    const results = await webSearch(query, 5);
    if (results.length === 0) return null;

    // Use Haiku to extract company from snippets
    const apiKey = config.claude.apiKey;
    if (!apiKey) return null;

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const snippets = results.slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.description}`)
      .join('\n\n');

    const response = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: 200,
      system: `Extract the company/employer of "${name}" from these search snippets. Return ONLY JSON: {"company": "..." or null, "title": "..." or null, "domain": "..." or null}. domain = company website domain if visible.`,
      messages: [{ role: 'user', content: snippets }],
    });

    const text = response.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// Main enrichment logic — orchestrates all 5 strategies
// ═══════════════════════════════════════════════════════════════

async function enrichOne(contact) {
  const needsEmail = !contact.email || contact.email === '';
  const needsCompany = !contact.company || contact.company === '';
  const name = (contact.name || '').trim();

  if (!name || name === 'Unknown') return null;

  let foundEmail = null;
  let foundCompany = contact.company || null;
  let foundTitle = contact.title || null;
  let foundLinkedin = null;
  let foundDomain = null;

  // ── STRATEGY 3: Cascade — find company first if missing ──
  if (needsCompany) {
    const companyInfo = await findCompanyFromWeb(name, contact.title);
    if (companyInfo) {
      if (companyInfo.company) foundCompany = companyInfo.company;
      if (companyInfo.title && !foundTitle) foundTitle = companyInfo.title;
      if (companyInfo.domain) foundDomain = companyInfo.domain;
    }
  }

  // ── Find company domain ──
  if (needsEmail && foundCompany && !foundDomain) {
    foundDomain = await findCompanyDomain(foundCompany);
  }

  // ── STRATEGY 2: Pattern memory — instant if known ──
  if (needsEmail && foundDomain) {
    const knownPattern = await getKnownPattern(foundDomain);
    if (knownPattern) {
      const guessed = applyPattern(name, foundDomain, knownPattern);
      if (guessed) {
        // Verify via SMTP
        const verified = await findValidEmail([guessed], foundDomain);
        if (verified) {
          foundEmail = verified;
          logger.info('enrich-agent', `${name}: email from pattern memory (${knownPattern}@${foundDomain})`);
        }
      }
    }
  }

  // ── STRATEGY 1: Email pattern guessing + SMTP ──
  if (needsEmail && !foundEmail && foundDomain) {
    const candidates = generateEmailCandidates(name, foundDomain);
    if (candidates.length > 0) {
      const verified = await findValidEmail(candidates, foundDomain);
      if (verified) {
        foundEmail = verified;
        // Learn this pattern for future contacts at same domain
        const local = verified.split('@')[0];
        const parts = name.trim().toLowerCase().split(/\s+/);
        const first = parts[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const last = parts[parts.length - 1].normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (local === `${first}.${last}`) _domainPatternCache.set(foundDomain, 'first.last');
        else if (local === `${first[0]}.${last}`) _domainPatternCache.set(foundDomain, 'f.last');
        else if (local === first) _domainPatternCache.set(foundDomain, 'first');
        else if (local === `${first}${last}`) _domainPatternCache.set(foundDomain, 'firstlast');
        logger.info('enrich-agent', `${name}: email from SMTP guess (${foundDomain})`);
      }
    }
  }

  // ── STRATEGY 4: Web search + Haiku fallback ──
  if (needsEmail && !foundEmail) {
    const webResult = await enrichViaWebSearch(contact, foundCompany);
    if (webResult) {
      if (webResult.email) foundEmail = webResult.email;
      if (webResult.company && !foundCompany) foundCompany = webResult.company;
      if (webResult.title && !foundTitle) foundTitle = webResult.title;
      if (webResult.linkedinUrl) foundLinkedin = webResult.linkedinUrl;
    }
  }

  // ── STRATEGY 5: Verify web-found email via SMTP ──
  if (foundEmail && foundDomain) {
    try {
      const mxHost = await getMxHost(foundDomain);
      if (mxHost) {
        const status = await smtpVerify(foundEmail, mxHost);
        if (status === 'invalid') {
          logger.info('enrich-agent', `${name}: SMTP rejected ${foundEmail}, discarding`);
          foundEmail = null;
        }
      }
    } catch { /* verification failed, keep the email */ }
  }

  // Return enriched data
  const hasData = foundEmail || (needsCompany && foundCompany) || (!contact.title && foundTitle) || foundLinkedin;
  if (!hasData) return null;

  return {
    email: foundEmail,
    company: needsCompany ? foundCompany : null,
    title: !contact.title ? foundTitle : null,
    linkedinUrl: foundLinkedin,
  };
}

/**
 * Web search + Haiku extraction (original strategy, now used as fallback).
 */
async function enrichViaWebSearch(contact, company) {
  const name = (contact.name || '').trim();
  const searchCompany = company || contact.company;

  const queries = [];
  if (searchCompany) {
    queries.push(`"${name}" "${searchCompany}" email`);
    queries.push(`"${name}" "${searchCompany}" site:linkedin.com/in`);
  } else {
    queries.push(`"${name}" ${contact.title || ''} email`);
    queries.push(`"${name}" site:linkedin.com/in`);
  }

  const allResults = [];
  const seenUrls = new Set();
  for (const q of [...new Set(queries)].slice(0, 3)) {
    try {
      const results = await webSearch(q, 5);
      for (const r of results) {
        if (!seenUrls.has(r.url)) { seenUrls.add(r.url); allResults.push(r); }
      }
    } catch { /* continue */ }
  }
  if (allResults.length === 0) return null;

  // Parse with Haiku
  const apiKey = config.claude.apiKey;
  if (!apiKey) return null;

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const snippets = allResults.slice(0, 10)
    .map((r, i) => `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.description}`)
    .join('\n\n');

  const missing = [];
  if (!contact.email) missing.push('email');
  if (!company && !contact.company) missing.push('company');

  try {
    const response = await client.messages.create({
      model: PARSE_MODEL,
      max_tokens: 500,
      system: [
        `Extract missing contact data from web search snippets.`,
        `Contact: "${name}"${searchCompany ? ` at "${searchCompany}"` : ''}${contact.title ? `, ${contact.title}` : ''}.`,
        `Missing: ${missing.join(', ')}.`,
        'Only return data clearly matching this person. Return ONLY JSON:',
        '{"email": "...|null", "company": "...|null", "title": "...|null", "linkedinUrl": "...|null"}',
      ].join('\n'),
      messages: [{ role: 'user', content: snippets }],
    });

    const text = response.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]);
    if (parsed.email && !EMAIL_RE.test(parsed.email)) parsed.email = null;

    return {
      email: parsed.email || null,
      company: parsed.company || null,
      title: parsed.title || null,
      linkedinUrl: parsed.linkedinUrl || null,
    };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Enrich a batch of contacts with missing data.
 * @param {string} userId
 * @param {'missing_email'|'missing_company'|'all'} issueType
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max contacts to enrich per run
 * @param {string[]} [options.contactIds] - Specific contact IDs to enrich
 * @returns {{ enriched, notFound, errors, total, details }}
 */
async function enrichContacts(userId, issueType = 'all', options = {}) {
  const { limit = 20, contactIds } = options;
  const report = { enriched: 0, notFound: 0, errors: [], total: 0, details: [] };

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

  // Group contacts by company for pattern efficiency
  const byCompany = new Map();
  for (const c of contacts) {
    const key = (c.company || '').toLowerCase().trim() || '__no_company__';
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(c);
  }

  // Process company by company (pattern learning benefits subsequent contacts)
  for (const [, group] of byCompany) {
    // Process in sub-batches of 3 within each company
    for (let i = 0; i < group.length; i += 3) {
      const batch = group.slice(i, i + 3);

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
          report.details.push({ name: contact.name, fields: Object.keys(updates) });
          logger.info('enrich-agent', `Enriched ${contact.name}: ${Object.keys(updates).join(', ')}`);
        } else {
          report.notFound++;
        }
      }

      // Rate limit between sub-batches
      if (i + 3 < group.length) await new Promise(r => setTimeout(r, 400));
    }
  }

  return report;
}

module.exports = { enrichContacts, enrichOne };
