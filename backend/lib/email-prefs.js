/**
 * Email Preferences · opt-out par catégorie pour les emails système (Resend).
 *
 * RGPD art. 21 / ePrivacy : tout email non strictement nécessaire au service
 * doit être désinscriptible simplement. Quatre catégories (migrations 101, 110) :
 *   crm_digest    → digest CRM du lundi
 *   weekly_report → rapport hebdo & tendances
 *   tips          → conseils & découverte (onboarding + rétention)
 *   reply_alert   → un prospect ou un client vient de répondre
 *
 * Deux chemins de désinscription :
 *   - Paramètres > Notifications (toggles, routes/settings.js)
 *   - lien one-click dans chaque email + header List-Unsubscribe (RFC 8058),
 *     via un token HMAC sans état · aucun stockage, vérifiable offline.
 */

const crypto = require('crypto');
const db = require('../db');

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');

// catégorie exposée → colonne user_profiles
const CATEGORIES = {
  crm_digest: 'email_crm_digest',
  weekly_report: 'email_weekly_report',
  tips: 'email_tips',
  reply_alert: 'email_reply_alert',
};

const CATEGORY_LABELS = {
  crm_digest: { fr: 'le digest CRM du lundi', en: 'the Monday CRM digest' },
  weekly_report: { fr: 'le rapport hebdomadaire', en: 'the weekly report' },
  tips: { fr: 'les conseils et découvertes', en: 'tips & product discovery' },
  reply_alert: { fr: 'l\'alerte quand quelqu\'un vous répond', en: 'the alert when someone replies to you' },
};

function isValidCategory(category) {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, category);
}

/** Préférences complètes (défaut : tout activé si pas de ligne profil). */
async function getEmailPrefs(userId) {
  const profile = await db.profiles.get(userId).catch(() => null);
  const prefs = {};
  for (const [category, column] of Object.entries(CATEGORIES)) {
    prefs[category] = !profile || profile[column] !== false;
  }
  return prefs;
}

/** L'utilisateur accepte-t-il cette catégorie ? (défaut true) */
async function isEmailEnabled(userId, category) {
  const prefs = await getEmailPrefs(userId);
  return prefs[category] !== false;
}

async function setEmailPref(userId, category, enabled) {
  if (!isValidCategory(category)) throw new Error(`Unknown email category: ${category}`);
  const column = CATEGORIES[category];
  // Upsert : la ligne user_profiles peut ne pas exister encore (profil jamais rempli).
  await db.query(
    `INSERT INTO user_profiles (user_id, ${column}) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET ${column} = $2, updated_at = now()`,
    [userId, enabled]
  );
}

// ── Token de désinscription sans état (HMAC-SHA256, base64url) ──

function tokenSecret() {
  const secret = process.env.JWT_SECRET || process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error('JWT_SECRET required for unsubscribe tokens');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
}

function makeUnsubscribeToken(userId, category) {
  const payload = Buffer.from(`${userId}:${category}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Renvoie { userId, category } ou null si token invalide/altéré. */
function verifyUnsubscribeToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const decoded = Buffer.from(payload, 'base64url').toString();
  const idx = decoded.indexOf(':');
  if (idx < 1) return null;
  const userId = decoded.slice(0, idx);
  const category = decoded.slice(idx + 1);
  if (!isValidCategory(category)) return null;
  return { userId, category };
}

function unsubscribeUrl(userId, category) {
  return `${APP_URL}/api/public/email-prefs/unsubscribe?token=${makeUnsubscribeToken(userId, category)}`;
}

/**
 * Headers RFC 8058 à passer à sendEmail : one-click exigé par Gmail/Yahoo
 * pour les expéditeurs en volume, et requis ePrivacy pour la catégorie tips.
 */
function unsubscribeHeaders(userId, category) {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(userId, category)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/** Pied d'email : pourquoi cet email + désinscription un clic + lien Paramètres. */
function emailFooter(userId, category, lang = 'fr') {
  const label = (CATEGORY_LABELS[category] || {})[lang === 'en' ? 'en' : 'fr'] || category;
  const unsubscribe = unsubscribeUrl(userId, category);
  const settings = `${APP_URL}/settings`;
  const text = lang === 'en'
    ? `You receive this email because ${label} is enabled on your baakalai account.`
    : `Vous recevez cet email car ${label} est activé sur votre compte baakalai.`;
  const unsubText = lang === 'en' ? 'Unsubscribe' : 'Se désinscrire';
  const prefsText = lang === 'en' ? 'Manage my emails' : 'Gérer mes emails';
  return `
    <div style="max-width: 520px; margin: 0 auto; padding: 20px; border-top: 1px solid #e4e4e7; margin-top: 32px;">
      <p style="color: #a1a1aa; font-size: 11px; line-height: 1.6; margin: 0;">
        ${text}
        <a href="${unsubscribe}" style="color: #71717a;">${unsubText}</a> ·
        <a href="${settings}" style="color: #71717a;">${prefsText}</a>
      </p>
    </div>`;
}

module.exports = {
  CATEGORIES,
  isValidCategory,
  getEmailPrefs,
  isEmailEnabled,
  setEmailPref,
  makeUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
  unsubscribeHeaders,
  emailFooter,
};
