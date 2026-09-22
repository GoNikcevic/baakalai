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

/**
 * Codes Azure AD qui signifient « il faut un administrateur », pas « réessayez ».
 *
 * POURQUOI CETTE DISTINCTION EXISTE
 * ---------------------------------
 * Tant que baakal.ai n'est pas un éditeur vérifié chez Microsoft, la plupart
 * des tenants refusent le consentement utilisateur : le réglage par défaut
 * d'Entra ID n'autorise l'utilisateur à consentir que pour les applications
 * d'éditeurs vérifiés. Le testeur beta n'y peut rien, et réessayer ne marchera
 * jamais. Seul son administrateur peut débloquer, ou la vérification d'éditeur
 * côté baakalai.
 *
 * Les deux callbacks jetaient ce diagnostic : ils ne lisaient même pas
 * `req.query.error`, partaient échanger un `code` inexistant, et affichaient
 * « Échec de connexion, veuillez réessayer ». Le testeur bouclait sans jamais
 * savoir qu'il devait demander à son IT.
 */
const ADMIN_CONSENT_CODES = [
  'AADSTS65001',   // l'utilisateur ou l'administrateur n'a pas consenti
  'AADSTS90094',   // l'octroi demande une autorisation d'administrateur
  'AADSTS900941',  // consentement administrateur requis sur ce tenant
  'AADSTS50194',   // application non configurée comme multi-tenant
];

/** L'utilisateur a explicitement refusé : ce n'est pas un problème d'admin. */
const USER_DECLINED_CODES = ['AADSTS65004', 'AADSTS50105'];

/**
 * Classe le retour d'Azure AD sur le callback OAuth.
 *
 * @param {object} query  req.query du callback
 * @returns {{kind: string, code: string|null, description: string|null}}
 *   kind vaut 'ok' (rien à signaler), 'admin_consent_required',
 *   'user_declined', 'admin_consent_granted' ou 'unknown'.
 */
function classifyCallback(query = {}) {
  // Retour du flux de consentement ADMINISTRATEUR : Azure renvoie
  // `admin_consent=True` et AUCUN code d'autorisation. Sans ce cas, ce retour
  // parfaitement réussi partait dans la branche d'erreur.
  if (query.admin_consent && !query.code) {
    const accorde = String(query.admin_consent).toLowerCase() === 'true';
    return { kind: accorde ? 'admin_consent_granted' : 'user_declined', code: null, description: null };
  }

  const description = query.error_description || null;
  if (!query.error && query.code) return { kind: 'ok', code: null, description: null };
  if (!query.error && !query.code) {
    return { kind: 'unknown', code: null, description: 'Azure a répondu sans code ni erreur' };
  }

  const texte = String(description || '');
  const code = (texte.match(/AADSTS\d+/) || [])[0] || null;

  if (code && ADMIN_CONSENT_CODES.includes(code)) {
    return { kind: 'admin_consent_required', code, description };
  }
  if (code && USER_DECLINED_CODES.includes(code)) {
    return { kind: 'user_declined', code, description };
  }
  // `consent_required` sans code exploitable : Azure le renvoie aussi quand le
  // tenant bloque le consentement utilisateur. On penche vers l'admin, parce
  // que c'est le cas de loin le plus fréquent tant qu'on n'est pas vérifié.
  if (query.error === 'consent_required') {
    return { kind: 'admin_consent_required', code, description };
  }
  return { kind: 'unknown', code, description };
}

/**
 * Lien que le testeur transmet à l'administrateur de son organisation.
 *
 * Accorde le consentement pour tout le tenant, une fois pour toutes. C'est le
 * contournement tant que la vérification d'éditeur n'est pas obtenue, et il
 * reste utile après : beaucoup d'organisations verrouillent le consentement
 * utilisateur même pour les éditeurs vérifiés.
 *
 * `redirectUri` doit être une URI déjà enregistrée sur l'application Azure,
 * sinon Microsoft refuse la demande. On réutilise celle du callback d'envoi.
 */
function adminConsentUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirectUri,
  });
  if (state) params.set('state', state);
  return `https://login.microsoftonline.com/common/adminconsent?${params}`;
}

module.exports = {
  GRAPH_SCOPES,
  isConfigured,
  hasReadGrant,
  authorizeUrl,
  exchangeCode,
  classifyCallback,
  adminConsentUrl,
  ADMIN_CONSENT_CODES,
  storeReadGrant,
  revokeReadGrant,
  getReadToken,
  listInboxSince,
};
