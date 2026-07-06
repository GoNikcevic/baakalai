/**
 * Hunter.io Email Verification API Client
 *
 * Verifies email addresses using Hunter.io's email-verifier endpoint.
 * Docs: https://hunter.io/api-documentation/v2#email-verifier
 */

const HUNTER_BASE = 'https://api.hunter.io/v2';

/**
 * Verify a single email via Hunter.io.
 * @param {string} apiKey - Hunter.io API key
 * @param {string} email - Email address to verify
 * @returns {{ status: string, score: number, result: string }}
 */
async function verifyEmail(apiKey, email) {
  const url = `${HUNTER_BASE}/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hunter API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const data = json.data || {};

  return {
    status: data.status || 'unknown',   // valid, invalid, accept_all, webmail, disposable, unknown
    score: data.score || 0,
    result: data.result || 'unknown',   // deliverable, undeliverable, risky, unknown
  };
}

/**
 * Verify a batch of emails sequentially via Hunter.io.
 * Hunter.io does not have a native batch endpoint, so we call one by one
 * with a 200ms delay to respect rate limits.
 * @param {string} apiKey - Hunter.io API key
 * @param {string[]} emails - Array of email addresses
 * @returns {Array<{ email: string, status: string, score: number }>}
 */
async function verifyBatch(apiKey, emails) {
  const results = [];

  for (let i = 0; i < emails.length; i++) {
    try {
      const result = await verifyEmail(apiKey, emails[i]);
      results.push({ email: emails[i], status: result.status, score: result.score });
    } catch (err) {
      results.push({ email: emails[i], status: 'error', score: 0, error: err.message });
    }

    // 200ms delay between calls to respect rate limits
    if (i < emails.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

module.exports = { verifyEmail, verifyBatch };
