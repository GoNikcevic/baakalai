/**
 * Le PLAFOND D'ENVOI PAR SOCIÉTÉ · lot 6, arbitrage Goran du 2026-09-29 (§8.2).
 *
 * ── Pourquoi ce module existe avant le reste du lot 6 ───────────────────────
 *
 * Le lot 6 rend l'envoi multi-threadé au niveau du compte : écrire à plusieurs
 * interlocuteurs d'une même société. C'est le lot que le plan classe en risque
 * « très élevé », et pour une raison précise : trois destinataires au même
 * domaine la même semaine est un motif de spam. Ce n'est pas une gêne pour le
 * destinataire, c'est une réputation d'expéditeur qui s'effondre, et elle met
 * des mois à revenir.
 *
 * On construit donc le FREIN avant l'accélérateur. Tant que ce plafond n'est
 * pas en place et vérifié, rien ne doit pouvoir écrire à deux personnes de la
 * même société.
 *
 * ── Au transport, et nulle part ailleurs ────────────────────────────────────
 *
 * La garde vit dans `sendPersonalEmail`, à côté de celle du désabonnement, et
 * pour le même motif, écrit noir sur blanc dans ce fichier : « un appelant qui
 * oublierait la règle ne doit pas pouvoir la contourner ». Un plafond posé dans
 * le moteur de séquence serait contourné par le premier nouveau chemin d'envoi.
 *
 * Et il est FERMÉ PAR DÉFAUT. Un appelant qui ne dit rien est plafonné ; seul
 * un envoi explicitement déclaré manuel y échappe, parce qu'un humain qui écrit
 * à un troisième interlocuteur sait ce qu'il fait. Les deux appelants actuels
 * du transport sont tous les deux automatiques.
 *
 * ── Ce que le plafond ne fait pas ───────────────────────────────────────────
 *
 * Il ne compte que ce qu'il peut ATTRIBUER à une société. Un destinataire qu'on
 * ne sait rattacher à aucun compte n'est pas plafonné : inventer un
 * rattachement pour pouvoir compter serait pire que ne pas compter. Sur les
 * données de staging, 44 contacts sur 498 portent un `account_id`, donc la
 * couverture réelle du plafond suit la dette de rattachement du lot 2.
 */

const db = require('../db');
const logger = require('./logger');
const { readJsonb } = require('./jsonb');

/** Deux messages par société et par semaine. Arbitrage Goran du 2026-09-29. */
const DEFAULT_WEEKLY_CAP = 2;

/** Bornes du réglage. 0 veut dire « aucun envoi automatique vers une société
 *  identifiée », ce qui est un choix légitime, pas une erreur de saisie. */
const MIN_CAP = 0;
const MAX_CAP = 20;

const FENETRE_JOURS = 7;

function clampCap(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_WEEKLY_CAP;
  return Math.min(MAX_CAP, Math.max(MIN_CAP, Math.round(n)));
}

/**
 * Le plafond de cet utilisateur.
 *
 * Rangé dans `users.settings`, comme le seuil de dormance (lib/stagnation.js) :
 * même patron, et aucune migration pour un entier de réglage.
 */
async function getWeeklyCap(userId) {
  try {
    const { rows } = await db.query('SELECT settings FROM users WHERE id = $1', [userId]);
    // `readJsonb` et non un acces direct : Postgres rend la colonne decodee,
    // le miroir SQLite la rend en chaine, et l'acces direct y vaudrait
    // `undefined` · le reglage de l'utilisateur ne serait jamais lu.
    const brut = readJsonb(rows[0]?.settings).account_weekly_cap;
    return brut === undefined || brut === null ? DEFAULT_WEEKLY_CAP : clampCap(brut);
  } catch {
    // Réglage illisible : on retombe sur le défaut, jamais sur « pas de
    // plafond ». Une panne de lecture ne doit pas ouvrir les vannes.
    return DEFAULT_WEEKLY_CAP;
  }
}

/**
 * La société d'un destinataire, par son adresse.
 *
 * Par l'adresse et non par un identifiant de contact, parce que c'est tout ce
 * que le transport connaît avec certitude : c'est à lui qu'on écrit.
 *
 * @returns {Promise<string|null>} l'identifiant de la société, ou null si on ne
 *   sait pas rattacher ce destinataire.
 */
async function resolveAccountId(userId, email) {
  if (!email) return null;
  try {
    const { rows } = await db.query(
      `SELECT account_id FROM opportunities
        WHERE user_id = $1 AND lower(email) = lower($2) AND account_id IS NOT NULL
        LIMIT 1`,
      [userId, email]
    );
    return rows[0]?.account_id || null;
  } catch {
    return null;
  }
}

/**
 * Cet envoi est-il permis ?
 *
 * @returns {Promise<{allowed: boolean, accountId: string|null, sent: number,
 *   cap: number, reason: string|null}>}
 *   `allowed: true` avec `accountId: null` veut dire « non attribuable, donc
 *   non plafonné », et c'est volontairement distinct de « sous le plafond ».
 */
async function check(userId, email) {
  const cap = await getWeeklyCap(userId);
  const accountId = await resolveAccountId(userId, email);

  if (!accountId) {
    return { allowed: true, accountId: null, sent: 0, cap, reason: 'unattributable' };
  }

  // Les envois RÉELLEMENT partis vers n'importe quel interlocuteur de cette
  // société, sur la fenêtre. Un brouillon en attente ne compte pas : il peut
  // ne jamais partir, et bloquer sur une intention rendrait le plafond
  // dépendant de l'ordre dans lequel on rédige.
  const depuis = new Date(Date.now() - FENETRE_JOURS * 86400000).toISOString();
  let sent = 0;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n
         FROM nurture_emails ne
         JOIN opportunities o ON o.id = ne.opportunity_id
        WHERE ne.user_id = $1 AND o.account_id = $2
          AND ne.status = 'sent' AND ne.sent_at > $3`,
      [userId, accountId, depuis]
    );
    sent = Number(rows[0]?.n) || 0;
  } catch (err) {
    // On ne sait pas compter : on laisse passer, en le DISANT. Bloquer sur une
    // panne de lecture arrêterait toute la prospection d'un utilisateur sans
    // qu'il comprenne pourquoi.
    logger.warn('account-cadence', `Comptage impossible pour ${userId}: ${err.message}`);
    return { allowed: true, accountId, sent: 0, cap, reason: 'count_failed' };
  }

  if (sent >= cap) {
    return { allowed: false, accountId, sent, cap, reason: 'account_weekly_cap' };
  }
  return { allowed: true, accountId, sent, cap, reason: null };
}

module.exports = {
  DEFAULT_WEEKLY_CAP, MIN_CAP, MAX_CAP, FENETRE_JOURS,
  clampCap, getWeeklyCap, resolveAccountId, check,
};
