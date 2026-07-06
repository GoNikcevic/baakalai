/**
 * DropContact Email Verification API Client
 *
 * Submits a batch of contacts for verification, polls for results.
 * Docs: https://developer.dropcontact.io/
 */

const DROPCONTACT_BASE = 'https://api.dropcontact.io';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

/**
 * Verify a batch of contacts via DropContact.
 * Submits the batch, then polls for results up to 30s.
 *
 * @param {string} apiKey - DropContact API key (X-Access-Token)
 * @param {Array<{ email: string, first_name?: string, last_name?: string, company?: string }>} contacts
 * @returns {Array<{ email: string, verified: boolean }>}
 */
async function verifyEmails(apiKey, contacts) {
  // Submit batch
  const submitRes = await fetch(`${DROPCONTACT_BASE}/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': apiKey,
    },
    body: JSON.stringify({
      data: contacts.map(c => ({
        email: c.email,
        first_name: c.first_name || '',
        last_name: c.last_name || '',
        company: c.company || '',
      })),
    }),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`DropContact submit error ${submitRes.status}: ${text}`);
  }

  const submitJson = await submitRes.json();
  const requestId = submitJson.request_id;

  if (!requestId) {
    throw new Error('DropContact did not return a request_id');
  }

  // Poll for results
  const deadline = Date.now() + POLL_MAX_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${DROPCONTACT_BASE}/batch/${requestId}`, {
      method: 'GET',
      headers: {
        'X-Access-Token': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!pollRes.ok) {
      const text = await pollRes.text();
      throw new Error(`DropContact poll error ${pollRes.status}: ${text}`);
    }

    const pollJson = await pollRes.json();

    // Check if processing is complete
    if (pollJson.error || pollJson.success === false) {
      throw new Error(`DropContact processing failed: ${pollJson.reason || 'unknown error'}`);
    }

    // Results ready when data array is present and not pending
    if (pollJson.data && Array.isArray(pollJson.data)) {
      return pollJson.data.map(entry => {
        // DropContact returns email as array of objects
        const emailArr = entry.email || [];
        const emailObj = Array.isArray(emailArr) ? emailArr[0] : emailArr;
        const emailAddr = typeof emailObj === 'object' ? emailObj.email : (entry.email || '');
        const isVerified = typeof emailObj === 'object' ? !!emailObj.is_verified : false;

        return {
          email: emailAddr || '',
          verified: isVerified,
        };
      });
    }

    // Still processing — continue polling
  }

  throw new Error('DropContact verification timed out after 30s');
}

module.exports = { verifyEmails };
