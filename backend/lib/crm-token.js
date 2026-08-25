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
      // Auto-refresh if token expires within 5 minutes and we have a refresh_token.
      // Credentials : Connected App du client, sinon app centrale (env vars).
      const metadata = typeof integration.metadata === 'string' ? JSON.parse(integration.metadata) : (integration.metadata || {});
      const { salesforceCredentials } = require('./crm-oauth');
      const creds = salesforceCredentials(metadata);
      const clientId = creds?.clientId;
      const clientSecret = creds?.clientSecret;
      if (integration.refresh_token && clientId && clientSecret) {
        const shouldRefresh = integration.expires_at
          ? new Date(integration.expires_at).getTime() < Date.now() + 5 * 60 * 1000
          : false; // manual tokens without expires_at: don't auto-refresh
        if (shouldRefresh) {
          const refreshToken = decrypt(integration.refresh_token);
          const refreshHost = metadata.loginHost || 'login.salesforce.com';
          const tokenBody = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
          const tokenRes = await fetch(`https://${refreshHost}/services/oauth2/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody,
          });
          if (tokenRes.ok) {
            const tokens = await tokenRes.json();
            const encryptedAccess = encrypt(tokens.access_token);
            const expiresAtNew = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
            // Rotation éventuelle du refresh token : persister le nouveau
            await db.userIntegrations.upsert(userId, 'salesforce', {
              accessToken: encryptedAccess,
              ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
              expiresAt: expiresAtNew,
            });
            return tokens.access_token;
          }
        }
      }
      return decrypt(integration.access_token);
    } catch { return null; }
  }
  // HubSpot / Pipedrive : soit clé API (legacy), soit OAuth produit
  // (metadata.oauth, app baakalai — lib/crm-oauth.js). En OAuth on
  // rafraîchit avant expiration ; pour Pipedrive on renvoie un objet
  // { oauth, accessToken, apiDomain } que api/pipedrive.js sait consommer
  // (Bearer sur le domaine société, pas api_token sur api.pipedrive.com).
  if (provider === 'hubspot' || provider === 'pipedrive') {
    const integration = await db.userIntegrations.get(userId, provider);
    const metadata = typeof integration?.metadata === 'string'
      ? (() => { try { return JSON.parse(integration.metadata); } catch { return {}; } })()
      : (integration?.metadata || {});

    if (integration && metadata.oauth) {
      try {
        let accessToken = decrypt(integration.access_token);

        const shouldRefresh = integration.refresh_token && integration.expires_at
          && new Date(integration.expires_at).getTime() < Date.now() + 5 * 60 * 1000;
        if (shouldRefresh) {
          const { refreshTokens } = require('./crm-oauth');
          const tokens = await refreshTokens(provider, decrypt(integration.refresh_token));
          accessToken = tokens.access_token;
          await db.userIntegrations.upsert(userId, provider, {
            accessToken: encrypt(tokens.access_token),
            ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
            expiresAt: new Date(Date.now() + Math.max(60, (tokens.expires_in || 1800) - 60) * 1000).toISOString(),
          });
        }

        if (provider === 'pipedrive') {
          return { oauth: true, accessToken, apiDomain: metadata.apiDomain || null };
        }
        return accessToken;
      } catch { return null; }
    }
    // Pas d'OAuth : clé API classique via getUserKey ci-dessous.
  }

  const { getUserKey } = require('../config');
  return getUserKey(userId, provider);
}

module.exports = { getUserCrmToken };
