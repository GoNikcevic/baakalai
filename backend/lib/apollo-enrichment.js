const { getUserKey } = require('../config');
const logger = require('./logger');
const { withRetry } = require('./retry');

/**
 * Search contacts on Apollo by criteria
 * @param {string} userId
 * @param {object} criteria — { titles, sectors, companySizes, locations, limit }
 * @returns {array} enriched contacts
 */
async function searchContacts(userId, criteria) {
  const apiKey = await getUserKey(userId, 'apollo');
  if (!apiKey) throw new Error('Apollo API key not configured');

  const { titles, sectors, locations, companySizes, limit = 100 } = criteria;

  // Build Apollo search payload
  const payload = {
    per_page: Math.min(limit, 100),
    person_titles: titles || [],
    q_organization_keyword_tags: sectors || [],
    person_locations: locations || [],
  };

  // Map company size to Apollo ranges
  if (companySizes && companySizes.length > 0) {
    const sizeMap = {
      '1-10': '1,10',
      '11-50': '11,50',
      '51-200': '51,200',
      '201-500': '201,500',
      '501-1000': '501,1000',
      '1001+': '1001,10000',
    };
    payload.organization_num_employees_ranges = companySizes.map(s => sizeMap[s] || s).filter(Boolean);
  }

  const result = await withRetry(async () => {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`Apollo API ${res.status}: ${body || '(empty)'}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, { maxRetries: 2, baseDelay: 1000 });

  // Transform Apollo results to Baakal format
  const contacts = (result.people || []).map(p => ({
    id: p.id,
    firstName: p.first_name || '',
    lastName: p.last_name || '',
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    email: p.email || null,
    phone: p.phone_numbers?.[0]?.sanitized_number || null,
    title: p.title || '',
    company: p.organization?.name || '',
    companySize: p.organization?.estimated_num_employees || null,
    sector: p.organization?.industry || '',
    location: p.city || p.country || '',
    linkedinUrl: p.linkedin_url || null,
    source: 'apollo',
  }));

  logger.info('apollo', `Found ${contacts.length} contacts for search`, { criteria: { titles, sectors, locations } });

  return contacts;
}

/**
 * Enrich a single contact by email
 */
async function enrichContact(userId, email) {
  const apiKey = await getUserKey(userId, 'apollo');
  if (!apiKey) throw new Error('Apollo API key not configured');

  const result = await withRetry(async () => {
    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`Apollo ${res.status}: ${body || '(empty)'}`), { status: res.status });
    }
    return res.json();
  });

  const p = result.person || {};
  return {
    firstName: p.first_name || '',
    lastName: p.last_name || '',
    name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    email: p.email || email,
    phone: p.phone_numbers?.[0]?.sanitized_number || null,
    title: p.title || '',
    company: p.organization?.name || '',
    companySize: p.organization?.estimated_num_employees || null,
    sector: p.organization?.industry || '',
    location: p.city || '',
    linkedinUrl: p.linkedin_url || null,
  };
}

module.exports = { searchContacts, enrichContact };
