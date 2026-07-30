/* ===============================================================================
   BAKAL — CRM Token Resolver (shared utility)
   Returns a valid CRM token for any provider.
   For Salesforce OAuth: auto-refreshes if token expires within 5 minutes.
   For other providers: delegates to getUserKey from config.
   =============================================================================== */

const { decrypt, encrypt } = require('../config/crypto');
const db = require('../db');

/**
 * Get CRM token for any provider, with auto-refresh for Salesforce OAuth.
 * @param {string} userId
 * @param {string} provider
 * @returns {Promise<string|null>}
 */
async function getUserCrmToken(userId, provider) {
  if (provider === 'salesforce') {
    const integration = await db.userIntegrations.get(userId, 'salesforce');
    if (!integration) return null;
    try {
      // Auto-refresh if token expires within 5 minutes and we have a refresh_token
      if (integration.refresh_token && process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET) {
        const shouldRefresh = integration.expires_at
          ? new Date(integration.expires_at).getTime() < Date.now() + 5 * 60 * 1000
          : false; // manual tokens without expires_at: don't auto-refresh
        if (shouldRefresh) {
          const refreshToken = decrypt(integration.refresh_token);
          const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
          const refreshHost = metadata.loginHost || 'login.salesforce.com';
          const tokenRes = await fetch(`https://${refreshHost}/services/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: process.env.SALESFORCE_CLIENT_ID,
              client_secret: process.env.SALESFORCE_CLIENT_SECRET,
            }),
          });
          if (tokenRes.ok) {
            const tokens = await tokenRes.json();
            const encryptedAccess = encrypt(tokens.access_token);
            const expiresAtNew = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
            await db.userIntegrations.upsert(userId, 'salesforce', { accessToken: encryptedAccess, expiresAt: expiresAtNew });
            return tokens.access_token;
          }
        }
      }
      return decrypt(integration.access_token);
    } catch { return null; }
  }
  const { getUserKey } = require('../config');
  return getUserKey(userId, provider);
}

/**
 * Resolve the CRM provider + credentials to use for a user: their explicit
 * active_crm_provider preference, falling back to the first connected provider.
 * Salesforce credentials are shaped as {accessToken, instanceUrl}; every other
 * provider's credentials are the raw token/key as stored.
 * @returns {Promise<{provider: string|null, creds: any}>}
 */
async function resolveCrmForUser(userId) {
  let provider = null;
  let token = null;

  try {
    const userRow = await db.query(`SELECT active_crm_provider FROM users WHERE id = $1`, [userId]);
    const activeCrm = userRow.rows[0]?.active_crm_provider;
    if (activeCrm) {
      token = await getUserCrmToken(userId, activeCrm);
      if (token) provider = activeCrm;
    }
  } catch { /* fallback below */ }

  if (!token) {
    for (const p of ['pipedrive', 'hubspot', 'salesforce', 'odoo']) {
      token = await getUserCrmToken(userId, p);
      if (token) { provider = p; break; }
    }
  }
  if (!token) return { provider: null, creds: null };

  let creds = token;
  if (provider === 'salesforce') {
    const integration = await db.query(
      `SELECT access_token, instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`,
      [userId]
    );
    if (!integration.rows[0]?.instance_url) return { provider: null, creds: null };
    creds = {
      accessToken: typeof token === 'string' ? token : decrypt(integration.rows[0].access_token),
      instanceUrl: integration.rows[0].instance_url,
    };
  }

  return { provider, creds };
}

module.exports = { getUserCrmToken, resolveCrmForUser };
