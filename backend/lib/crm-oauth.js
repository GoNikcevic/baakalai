/**
 * OAuth produit pour les CRM grand public (HubSpot, Pipedrive).
 *
 * Contrairement à Salesforce (Connected App créée PAR le client, credentials
 * stockés par utilisateur), ici l'app OAuth est LA NÔTRE : une app baakalai
 * enregistrée chez le fournisseur, credentials en variables d'environnement.
 * C'est le geste de connexion attendu par l'ICP (PME sans profil technique) :
 * un bouton, un consentement, zéro clé API à copier.
 *
 * Tant que les env vars ne sont pas posées (app pas encore enregistrée chez
 * le fournisseur), isConfigured() renvoie false et les routes répondent 501 —
 * le frontend retombe alors sur le champ clé API classique.
 */

const PROVIDERS = {
  hubspot: {
    authUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    // Doit correspondre EXACTEMENT aux scopes déclarés dans l'app HubSpot.
    scopes: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write oauth',
    env: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  },
  pipedrive: {
    authUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    scopes: null, // Pipedrive : les scopes se déclarent dans l'app, pas dans l'URL
    env: ['PIPEDRIVE_CLIENT_ID', 'PIPEDRIVE_CLIENT_SECRET'],
  },
};

function getConfig(provider) {
  const def = PROVIDERS[provider];
  if (!def) return null;
  const clientId = process.env[def.env[0]];
  const clientSecret = process.env[def.env[1]];
  if (!clientId || !clientSecret) return null;
  return { ...def, clientId, clientSecret };
}

function isConfigured(provider) {
  return getConfig(provider) !== null;
}

function authorizeUrl(provider, { redirectUri, state }) {
  const cfg = getConfig(provider);
  if (!cfg) return null;
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    state,
  });
  if (cfg.scopes) params.set('scope', cfg.scopes);
  return `${cfg.authUrl}?${params}`;
}

async function tokenRequest(provider, body) {
  const cfg = getConfig(provider);
  if (!cfg) throw new Error(`OAuth ${provider} non configuré`);

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (provider === 'pipedrive') {
    // Pipedrive attend les credentials en Basic auth, pas dans le corps.
    headers.Authorization = 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  } else {
    body.set('client_id', cfg.clientId);
    body.set('client_secret', cfg.clientSecret);
  }

  const res = await fetch(cfg.tokenUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth ${provider} token: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Échange code → tokens. Renvoie la réponse brute du fournisseur
// (access_token, refresh_token, expires_in, api_domain pour Pipedrive).
async function exchangeCode(provider, { code, redirectUri }) {
  return tokenRequest(provider, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }));
}

async function refreshTokens(provider, refreshToken) {
  return tokenRequest(provider, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

// Salesforce n'est pas dans PROVIDERS (host de login dynamique, app par
// client possible) : credentials de la Connected App du client (metadata de
// user_integrations) sinon l'app centrale Baakalai (org Developer Edition,
// env SALESFORCE_CLIENT_ID/SECRET) — le un-clic sans rien créer côté client.
function salesforceCredentials(metadata) {
  const meta = metadata || {};
  if (meta.consumerKey && meta.encryptedConsumerSecret) {
    try {
      const { decrypt } = require('../config/crypto');
      return { clientId: meta.consumerKey, clientSecret: decrypt(meta.encryptedConsumerSecret), central: false };
    } catch { /* secret illisible → tente l'app centrale */ }
  }
  if (process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET) {
    return { clientId: process.env.SALESFORCE_CLIENT_ID, clientSecret: process.env.SALESFORCE_CLIENT_SECRET, central: true };
  }
  return null;
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, refreshTokens, salesforceCredentials, PROVIDERS };
