/**
 * Microsoft Graph · lecture de la boîte Outlook.
 *
 * Sert un seul besoin : savoir qu'un prospect a répondu. C'est ce qui manquait
 * pour qu'Outlook cesse d'être un connecteur à moitié branché, l'envoi marchant
 * mais la séquence continuant de tourner après une réponse.
 *
 * Le jeton vit à part de celui de l'envoi (migration 111) : Azure AD délivre un
 * jeton pour une ressource à la fois, et `outlook.office365.com/SMTP.Send` et
 * `graph.microsoft.com/Mail.Read` sont deux ressources. Toucher à la demande
 * d'autorisation existante mettrait l'envoi en jeu pour ajouter la lecture.
 *
 * Périmètre volontairement étroit : Mail.Read, jamais Mail.ReadWrite. baakalai
 * lit les réponses, il ne touche pas à la boîte de l'utilisateur.
 */

const db = require('../db');
const logger = require('./logger');
const { encrypt, decrypt } = require('../config/crypto');

const GRAPH_SCOPES = 'https://graph.microsoft.com/Mail.Read offline_access openid profile email';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

// Plafond de pages ramenées en un passage. Une boîte très active ne doit pas
// faire tourner la détection pendant des minutes : au-delà, les réponses les
// plus anciennes de la fenêtre seront vues au prochain passage.
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

function isConfigured() {
  return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

/** Ce compte a-t-il autorisé la lecture ? (l'envoi peut marcher sans). */
function hasReadGrant(account) {
  return !!account?.graph_refresh_token;
}

function authorizeUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    state,
    // L'utilisateur a déjà consenti l'envoi : sans cette invite, Azure peut
    // réutiliser le consentement existant et renvoyer un jeton sans Mail.Read.
    prompt: 'consent',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function exchangeCode(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: GRAPH_SCOPES,
    }),
  });
  const tokens = await res.json();
  if (!res.ok || !tokens.refresh_token) {
    throw new Error(tokens.error_description || `Graph token exchange failed (${res.status})`);
  }
  return tokens;
}

/** Enregistre le consentement de lecture sur le compte email de l'utilisateur. */
async function storeReadGrant(accountId, tokens) {
  await db.query(
    `UPDATE email_accounts
     SET graph_refresh_token = $1, graph_access_token = $2, graph_token_expiry = $3, updated_at = now()
     WHERE id = $4`,
    [
      encrypt(tokens.refresh_token),
      tokens.access_token ? encrypt(tokens.access_token) : null,
      tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      accountId,
    ]
  );
}

/** Oublie le consentement · appelé quand Azure le refuse définitivement. */
async function revokeReadGrant(accountId) {
  await db.query(
    `UPDATE email_accounts
     SET graph_refresh_token = NULL, graph_access_token = NULL, graph_token_expiry = NULL, updated_at = now()
     WHERE id = $1`,
    [accountId]
  );
}

/**
 * Jeton d'accès Graph pour ce compte, rafraîchi si besoin.
 * Retourne null (et journalise) plutôt que de lever : une détection de réponses
 * qui échoue ne doit jamais interrompre le passage du moteur de séquences.
 */
async function getReadToken(account) {
  if (!hasReadGrant(account) || !isConfigured()) return null;

  const expiry = account.graph_token_expiry ? new Date(account.graph_token_expiry).getTime() : 0;
  if (account.graph_access_token && expiry > Date.now() + 300000) {
    try {
      return decrypt(account.graph_access_token);
    } catch {
      // Secret de chiffrement changé : on repasse par le refresh token.
    }
  }

  let refreshToken;
  try {
    refreshToken = decrypt(account.graph_refresh_token);
  } catch (err) {
    logger.error('graph', `Refresh token illisible pour ${account.email_address}: ${err.message}`);
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: GRAPH_SCOPES,
    }),
  });
  const tokens = await res.json().catch(() => ({}));

  if (!res.ok || !tokens.access_token) {
    // invalid_grant = consentement révoqué ou mot de passe changé : inutile de
    // réessayer à chaque passage, on efface et l'interface reproposera le
    // bouton d'autorisation.
    if (tokens.error === 'invalid_grant') {
      await revokeReadGrant(account.id);
      logger.warn('graph', `Consentement de lecture révoqué pour ${account.email_address}, autorisation à refaire`);
    } else {
      logger.warn('graph', `Jeton de lecture indisponible pour ${account.email_address}: ${tokens.error_description || res.status}`);
    }
    return null;
  }

  await db.query(
    `UPDATE email_accounts SET graph_access_token = $1, graph_token_expiry = $2, updated_at = now() WHERE id = $3`,
    [
      encrypt(tokens.access_token),
      tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      account.id,
    ]
  );
  // Azure fait tourner les refresh tokens : garder l'ancien mènerait à une
  // expiration silencieuse quelques semaines plus tard.
  if (tokens.refresh_token) {
    await db.query(
      `UPDATE email_accounts SET graph_refresh_token = $1 WHERE id = $2`,
      [encrypt(tokens.refresh_token), account.id]
    );
  }

  return tokens.access_token;
}

/**
 * Messages reçus depuis `sinceIso`, les plus récents d'abord.
 * Retourne [{ id, fromEmail, receivedAt, snippet }].
 *
 * Choix : on ramène la boîte de réception sur la fenêtre plutôt que d'aller
 * interroger Graph adresse par adresse. Une séquence en cours compte souvent
 * des centaines de prospects, et le filtrage par expéditeur se fait très bien
 * en mémoire, sans multiplier les appels ni buter sur la longueur des filtres.
 */
async function listInboxSince(accessToken, sinceIso) {
  const messages = [];
  const select = 'id,receivedDateTime,bodyPreview,from';
  let url = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages'
    + `?$select=${select}&$top=${PAGE_SIZE}&$orderby=receivedDateTime desc`
    + `&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Graph ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const data = await res.json();
    for (const m of data.value || []) {
      const fromEmail = m.from?.emailAddress?.address;
      if (!fromEmail) continue;
      messages.push({
        id: m.id,
        fromEmail: String(fromEmail).trim().toLowerCase(),
        receivedAt: m.receivedDateTime,
        snippet: m.bodyPreview || '',
      });
    }
    url = data['@odata.nextLink'] || null;
  }

  return messages;
}

module.exports = {
  GRAPH_SCOPES,
  isConfigured,
  hasReadGrant,
  authorizeUrl,
  exchangeCode,
  storeReadGrant,
  revokeReadGrant,
  getReadToken,
  listInboxSince,
};
