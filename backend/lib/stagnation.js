/**
 * Dormance — définition unique de « ce deal est resté sans activité trop longtemps ».
 *
 * Deux autorités concurrentes coexistaient : un seuil réglable par trigger côté
 * Activation (30 jours par défaut dans le formulaire) et un 14 écrit en dur,
 * partagé par la file de réactivation et le Deal Coach. Un deal silencieux
 * depuis 20 jours était donc dormant sur un écran et pas sur l'autre, sans que
 * rien n'explique pourquoi.
 *
 * La dormance n'a rien d'universel : elle dépend du cycle de vente, du secteur
 * et de l'étape du pipeline. Un contrat à 200 k€ avec un cycle de neuf mois est
 * en bonne santé après 45 jours de silence ; un abonnement mensuel ne l'est pas
 * après dix. Le seuil est donc un réglage de l'utilisateur, avec une valeur de
 * départ, et non une constante décidée à sa place.
 *
 * Un trigger garde son propre `conditions.days` : voir ses deals plus tôt qu'on
 * ne leur écrit automatiquement est un choix légitime. Mais ce choix part
 * désormais de la même valeur au lieu d'un autre nombre en dur.
 */

const db = require('../db');

/** Valeur de départ, reprise de la file de réactivation et du Deal Coach. */
const DEFAULT_STAGNANT_DAYS = 14;

/** Bornes de bon sens : en dessous d'un jour la notion n'a pas de sens, au delà
 *  d'un an ce n'est plus un deal dormant mais un deal mort. */
const MIN_DAYS = 1;
const MAX_DAYS = 365;

function clampDays(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_STAGNANT_DAYS;
  return Math.min(Math.max(n, MIN_DAYS), MAX_DAYS);
}

/** Seuil de dormance de cet utilisateur, en jours. */
async function getStagnantDays(userId) {
  const result = await db.query('SELECT settings FROM users WHERE id = $1', [userId]);
  const raw = result.rows[0]?.settings?.stagnant_days;
  return raw === undefined || raw === null ? DEFAULT_STAGNANT_DAYS : clampDays(raw);
}

module.exports = { DEFAULT_STAGNANT_DAYS, MIN_DAYS, MAX_DAYS, clampDays, getStagnantDays };
