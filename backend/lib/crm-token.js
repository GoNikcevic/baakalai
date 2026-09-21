/* ===============================================================================
   BAKAL · CRM Token Resolver (shared utility)
   Returns a valid CRM token for any provider.
   For Salesforce OAuth: auto-refreshes if token expires within 5 minutes.
   For other providers: delegates to getUserKey from config.
   =============================================================================== */

const { decrypt, encrypt } = require('../config/crypto');
const db = require('../db');

// Qui est le propriétaire d'un access token Salesforce en circulation.
// api/salesforce.js ne reçoit qu'un token : sans ce registre il ne peut pas
// savoir quel user rafraîchir quand l'org répond INVALID_SESSION_ID.
const sfTokenOwners = new Map();
const SF_OWNERS_MAX = 500;
// Un appelant garde son token pendant toute une opération (une synchro CRM en
// fait des dizaines d'appels) : une fois la session remplacée, on sert le
// successeur au lieu de refaire un refresh à chaque requête.
const sfTokenSuccessors = new Map();
const SF_SUCCESSOR_TTL_MS = 2 * 60 * 1000;
// Un refresh en vol par user : la synchro CRM lance des dizaines d'appels en
// parallèle, et la Connected App fait tourner le refresh token à chaque appel.
const sfRefreshInflight = new Map();

// metadata est du JSONB : selon le driver il arrive en objet ou en texte, et
// un enregistrement abîmé ne doit pas faire tomber un refresh.
function parseMetadata(raw) {
  if (typeof raw !== 'string') return raw || {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function rememberSalesforceToken(token, userId) {
  if (!token || !userId) return token;
  if (sfTokenOwners.size >= SF_OWNERS_MAX) sfTokenOwners.clear();
  sfTokenOwners.set(token, userId);
  return token;
}

/**
 * Échange le refresh token Salesforce contre un access token neuf et le
 * persiste (la Connected App peut faire tourner le refresh token : on réécrit
 * toujours celui qu'elle renvoie, sinon la connexion casse au prochain appel).
 * @returns {Promise<string|null>} le nouvel access token, ou null
 */
async function refreshSalesforceToken(userId) {
  if (sfRefreshInflight.has(userId)) return sfRefreshInflight.get(userId);

  const run = (async () => {
    const integration = await db.userIntegrations.get(userId, 'salesforce');
    if (!integration?.refresh_token) return null;
    const metadata = parseMetadata(integration.metadata);
    const { salesforceCredentials } = require('./crm-oauth');
    const creds = salesforceCredentials(metadata) || {};
    if (!creds.clientId || !creds.clientSecret) return null;

    const refreshHost = metadata.loginHost || 'login.salesforce.com';
    const tokenBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decrypt(integration.refresh_token),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });
    const tokenRes = await fetch(`https://${refreshHost}/services/oauth2/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody,
    });
    if (!tokenRes.ok) return null;

    const tokens = await tokenRes.json();
    await db.userIntegrations.upsert(userId, 'salesforce', {
      accessToken: encrypt(tokens.access_token),
      ...(tokens.refresh_token ? { refreshToken: encrypt(tokens.refresh_token) } : {}),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    return rememberSalesforceToken(tokens.access_token, userId);
  })().catch(() => null).finally(() => sfRefreshInflight.delete(userId));

  sfRefreshInflight.set(userId, run);
  return run;
}

/**
 * Rattrapage appelé par api/salesforce.js sur INVALID_SESSION_ID : retrouve le
 * user derrière un token mort et renvoie un token frais.
 */
async function refreshSalesforceByToken(deadToken) {
  const known = sfTokenSuccessors.get(deadToken);
  if (known && Date.now() - known.at < SF_SUCCESSOR_TTL_MS) return known.token;
  if (known) sfTokenSuccessors.delete(deadToken);

  const userId = sfTokenOwners.get(deadToken);
  if (!userId) return null;

  const fresh = await refreshSalesforceToken(userId);
  if (fresh) {
    if (sfTokenSuccessors.size >= SF_OWNERS_MAX) sfTokenSuccessors.clear();
    sfTokenSuccessors.set(deadToken, { token: fresh, at: Date.now() });
    sfTokenOwners.delete(deadToken);
  }
  return fresh;
}

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
      // Refresh préventif si le token expire dans moins de 5 minutes. L'échéance
      // stockée n'est qu'une estimation (+2h) : le vrai filet de sécurité est le
      // rattrapage sur INVALID_SESSION_ID dans api/salesforce.js.
      const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : null;
      if (expiresAt && expiresAt < Date.now() + 5 * 60 * 1000) {
        const fresh = await refreshSalesforceToken(userId);
        if (fresh) return fresh;
      }
      return rememberSalesforceToken(decrypt(integration.access_token), userId);
    } catch { return null; }
  }
  // HubSpot / Pipedrive : soit clé API (legacy), soit OAuth produit
  // (metadata.oauth, app baakalai · lib/crm-oauth.js). En OAuth on
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

/**
 * Resolve the CRM provider + credentials to use for a user: their explicit
 * active_crm_provider preference, falling back to the first connected provider.
 * Salesforce credentials are shaped as {accessToken, instanceUrl}; every other
 * provider's credentials are returned exactly as getUserCrmToken produced them
 * (e.g. Pipedrive OAuth's { oauth, accessToken, apiDomain } object passes through).
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

module.exports = {
  getUserCrmToken,
  resolveCrmForUser,
  refreshSalesforceToken,
  refreshSalesforceByToken,
};
