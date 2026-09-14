/**
 * DropContact API Client — vérification ET recherche d'emails.
 *
 * Deux usages sur le même endpoint /batch :
 * - vérification : on soumet des contacts AVEC email (crm-cleaning-agent) ;
 * - enrichissement : on soumet prénom + nom + entreprise SANS email,
 *   DropContact calcule l'email (reveal via la clé centrale baakalai).
 *
 * submitBatch/fetchBatch sont exposés séparément pour les flux asynchrones
 * (la route reveal-emails soumet dans le POST et sonde dans le GET) ;
 * verifyEmails reste le chemin synchrone historique.
 * Docs: https://developer.dropcontact.io/
 */

const DROPCONTACT_BASE = 'https://api.dropcontact.io';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

/**
 * Submit a batch of contacts. Returns the request_id to poll with fetchBatch.
 * @param {string} apiKey - DropContact API key (X-Access-Token)
 * @param {Array<object>} data - Raw DropContact contact payloads
 * @returns {string} requestId
 */
async function submitBatch(apiKey, data) {
  const res = await fetch(`${DROPCONTACT_BASE}/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': apiKey,
    },
    body: JSON.stringify({ data }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DropContact submit error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (!json.request_id) {
    throw new Error('DropContact did not return a request_id');
  }
  return json.request_id;
}

/**
 * Poll a batch once. Returns { pending: true } while processing,
 * or { pending: false, entries } when done. Throws on processing failure.
 * @param {string} apiKey
 * @param {string} requestId
 */
async function fetchBatch(apiKey, requestId) {
  const res = await fetch(`${DROPCONTACT_BASE}/batch/${requestId}`, {
    method: 'GET',
    headers: {
      'X-Access-Token': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DropContact poll error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.error || json.success === false) {
    throw new Error(`DropContact processing failed: ${json.reason || 'unknown error'}`);
  }
  if (json.data && Array.isArray(json.data)) {
    return { pending: false, entries: json.data };
  }
  return { pending: true };
}

/**
 * Extract the best email from a DropContact result entry.
 * DropContact returns email as an array of { email, qualification } —
 * is_verified n'existe que sur certaines réponses, la qualification
 * "nominative@pro" est le signal fiable de délivrabilité.
 * @returns {{ email: string, verified: boolean }}
 */
function parseBatchEntry(entry) {
  const emailArr = entry.email || [];
  const emailObj = Array.isArray(emailArr) ? emailArr[0] : emailArr;
  const emailAddr = typeof emailObj === 'object' && emailObj !== null
    ? (emailObj.email || '')
    : (typeof emailObj === 'string' ? emailObj : '');
  const qualification = typeof emailObj === 'object' && emailObj !== null
    ? (emailObj.qualification || '')
    : '';
  const isVerified = (typeof emailObj === 'object' && emailObj !== null && !!emailObj.is_verified)
    || qualification === 'nominative@pro';

  return { email: emailAddr, verified: !!emailAddr && isVerified };
}

/**
 * Map one of our leads (search result / CSV row shape) to a DropContact
 * enrichment payload — WITHOUT email, so DropContact computes it.
 * Returns null if the lead lacks the minimum inputs (first+last+company).
 */
function buildEnrichInput(lead) {
  let firstName = lead.firstName || lead.first_name || '';
  let lastName = lead.lastName || lead.last_name || '';
  if ((!firstName || !lastName) && lead.name) {
    const parts = String(lead.name).trim().split(/\s+/);
    if (parts.length >= 2) {
      firstName = firstName || parts[0];
      lastName = lastName || parts.slice(1).join(' ');
    }
  }
  const company = lead.company || lead.companyName || '';
  if (!firstName || !lastName || !company) return null;

  const input = { first_name: firstName, last_name: lastName, company };
  const domain = lead.companyDomain || lead.website || '';
  if (domain) input.website = String(domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return input;
}

/**
 * Verify a batch of contacts via DropContact (chemin synchrone historique).
 * Submits the batch, then polls for results up to 30s.
 *
 * @param {string} apiKey - DropContact API key (X-Access-Token)
 * @param {Array<{ email: string, first_name?: string, last_name?: string, company?: string }>} contacts
 * @returns {Array<{ email: string, verified: boolean }>}
 */
async function verifyEmails(apiKey, contacts) {
  const requestId = await submitBatch(apiKey, contacts.map(c => ({
    email: c.email,
    first_name: c.first_name || '',
    last_name: c.last_name || '',
    company: c.company || '',
  })));

  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const result = await fetchBatch(apiKey, requestId);
    if (!result.pending) {
      return result.entries.map(parseBatchEntry);
    }
  }

  throw new Error('DropContact verification timed out after 30s');
}

module.exports = { verifyEmails, submitBatch, fetchBatch, parseBatchEntry, buildEnrichInput };
