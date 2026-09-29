/**
 * Opposition d'un CONTACT aux emails d'un utilisateur (migration 120).
 *
 * À ne pas confondre avec lib/email-prefs.js, qui gère les emails que
 * baakalai adresse à SES utilisateurs. Ici c'est la personne au bout de la
 * chaîne, le prospect ou le client, qui refuse les relances partant de la
 * boîte de l'utilisateur.
 *
 * Pourquoi c'est obligatoire : en B2B, c'est le consentement préalable qui
 * est assoupli, jamais le droit d'opposition. L'article L.34-5 du CPCE exige
 * un moyen de s'opposer dès le premier message, et l'article 21 du RGPD rend
 * ce droit absolu, sans intérêt légitime opposable.
 *
 * Le verrou est posé dans `sendPersonalEmail`, point de passage unique de
 * tous les envois, au même endroit et pour la même raison que `humanize()` :
 * un appelant qui oublierait la règle ne peut pas la contourner.
 *
 * L'adresse du destinataire ne circule JAMAIS dans l'URL de désinscription.
 * Le jeton ne porte qu'un HMAC non réversible, sinon chaque lien
 * dissémine une donnée personnelle dans les journaux de serveurs, les
 * référents et les historiques de navigateur.
 */

const crypto = require('crypto');
const db = require('../db');

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

function secret() {
  const value = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('ENCRYPTION_SECRET required for contact opt-out tokens');
  return value;
}

/** Normalise avant toute comparaison : les adresses sont insensibles à la casse. */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Empreinte non réversible de l'adresse. Salée par le secret d'instance :
 * un haché volé ne permet pas de tester un dictionnaire d'adresses sans lui.
 */
function hashEmail(email) {
  return crypto.createHmac('sha256', secret())
    .update(`contact-optout:${normalizeEmail(email)}`)
    .digest('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Jeton sans état : `base64url(userId:emailHash).signature`. Aucune adresse. */
function makeToken(userId, email) {
  const payload = Buffer.from(`${userId}:${hashEmail(email)}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Renvoie { userId, emailHash } ou null si le jeton est absent, malformé ou altéré. */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx < 1) return null;
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Comparaison à temps constant, et longueurs vérifiées avant : timingSafeEqual
  // lève si elles diffèrent.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const decoded = Buffer.from(payload, 'base64url').toString();
  const sep = decoded.indexOf(':');
  if (sep < 1) return null;
  const userId = decoded.slice(0, sep);
  const emailHash = decoded.slice(sep + 1);
  if (!userId || !emailHash) return null;
  return { userId, emailHash };
}

function unsubscribeUrl(userId, email) {
  return `${APP_URL}/api/public/unsubscribe?token=${makeToken(userId, email)}`;
}

/**
 * En-têtes RFC 8058. Le POST one-click est ce que Gmail et Yahoo exigent des
 * expéditeurs en volume : sans lui, le message part en indésirable avant même
 * d'être lu.
 */
function unsubscribeHeaders(userId, email) {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(userId, email)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Ce contact a-t-il refusé les emails de cet utilisateur ? */
async function isOptedOut(userId, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM contact_optouts WHERE user_id = $1 AND email_hash = $2 LIMIT 1`,
    [userId, hashEmail(normalized)]
  );
  return rows.length > 0;
}

/**
 * Enregistre l'opposition. Idempotent : recliquer un vieux lien ne crée pas
 * de doublon et ne remonte pas d'erreur, ce qui est le comportement attendu
 * d'un lien qui reste valable indéfiniment.
 *
 * `email` peut être null quand l'opposition arrive par jeton : on ne connaît
 * alors que le haché, et c'est suffisant pour bloquer les envois. L'adresse
 * est renseignée quand l'appelant la connaît, pour que l'utilisateur voie qui
 * s'est désinscrit.
 */
async function recordOptOut(userId, { email = null, emailHash = null, source = 'link', userAgent = null, ipHash = null }) {
  const normalized = email ? normalizeEmail(email) : null;
  const hash = emailHash || (normalized ? hashEmail(normalized) : null);
  if (!userId || !hash) throw new Error('recordOptOut requires userId and an email or emailHash');

  await db.query(
    `INSERT INTO contact_optouts (user_id, email, email_hash, source, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, email_hash) DO UPDATE
       -- L'adresse n'est complétée que si on la connaît maintenant et pas
       -- avant : une opposition par jeton (haché seul) suivie d'une saisie
       -- manuelle enrichit la ligne au lieu de l'écraser par NULL.
       SET email = COALESCE(EXCLUDED.email, contact_optouts.email)`,
    [userId, normalized, hash, source, userAgent, ipHash]
  );
  return { emailHash: hash };
}

/**
 * Pied de message ajouté à chaque email sortant.
 *
 * Volontairement sobre et sans image : le message doit continuer à ressembler
 * à un email écrit à la main, ce qui est tout l'argument du produit. Une
 * phrase et un lien suffisent à satisfaire l'obligation.
 */
function footerText(userId, email, lang = 'fr') {
  const url = unsubscribeUrl(userId, email);
  return lang === 'en'
    ? `\n\n--\nDon't want to hear from me again? ${url}`
    : `\n\n--\nVous ne souhaitez plus recevoir mes messages ? ${url}`;
}

function footerHtml(userId, email, lang = 'fr') {
  const url = unsubscribeUrl(userId, email);
  const label = lang === 'en' ? "Don't want to hear from me again?" : 'Vous ne souhaitez plus recevoir mes messages ?';
  const action = lang === 'en' ? 'Unsubscribe' : 'Se désinscrire';
  return `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e4e4e0;">`
    + `<span style="color:#7a7a78;font-size:11px;font-family:Arial,Helvetica,sans-serif;">`
    + `${label} <a href="${url}" style="color:#7a7a78;">${action}</a>`
    + `</span></div>`;
}

module.exports = {
  normalizeEmail,
  hashEmail,
  makeToken,
  verifyToken,
  unsubscribeUrl,
  unsubscribeHeaders,
  isOptedOut,
  recordOptOut,
  footerText,
  footerHtml,
};
