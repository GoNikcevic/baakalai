/**
 * Signaux ICP · ce qu'on peut déduire du CRM sans rien demander.
 *
 * L'ICP arrêté le 2026-09-02 repose sur 4 critères. Un seul n'est pas
 * déductible (le poste) : il est demandé à l'onboarding. Les trois autres
 * devraient se déduire du CRM connecté. Dans les faits, un seul y arrive
 * aujourd'hui, et ce module est écrit pour le dire au lieu de le masquer.
 *
 * Règle centrale : NULL veut dire « inconnu », jamais « zéro ». Un critère
 * qu'on ne sait pas mesurer ne doit pas ressortir en faux négatif, sinon on
 * disqualifie des comptes sur une lacune de notre propre import.
 *
 * État au 2026-09-21, vérifié sur les 443 opportunités de prod :
 *   - base clients        : calculable (won_date / status)
 *   - ancienneté CRM      : NON · opportunities.created_at est la date
 *                           d'insertion chez nous. La date CRM (add_time,
 *                           createdate, CreatedDate) est bien récupérée par
 *                           la couche api/ puis jetée, faute de colonne.
 *   - personnes sur le CRM: NON · owner_email et crm_owner_id sont vides sur
 *                           la totalité des lignes, les 9 points d'appel à
 *                           opportunities.create ne les passent pas.
 *
 * Les deux manquants se débloquent en persistant ces champs à l'import. Tant
 * que ce n'est pas fait, ils restent NULL et aucun score composite n'est
 * calculé : un score bâti sur un critère sur trois serait faux.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Recalcule les signaux ICP d'un utilisateur à partir de ses opportunités.
 * Ne throw jamais : un échec de qualification ne doit pas casser un import.
 *
 * @returns {Promise<object|null>} les signaux calculés, ou null si échec
 */
async function computeIcpSignals(userId) {
  if (!userId) return null;

  try {
    const { rows } = await db.query(
      `SELECT
         count(*)::int AS deals_count,
         count(*) FILTER (
           WHERE won_date IS NOT NULL OR lower(status) = 'won'
         )::int AS won_count,
         count(*) FILTER (
           WHERE lower(status) IN ('won', 'lost')
         )::int AS outcome_mapped_count,
         count(DISTINCT COALESCE(crm_owner_id, owner_email))::int AS seat_count
       FROM opportunities
       WHERE user_id = $1`,
      [userId]
    );

    const r = rows[0] || {};
    const dealsCount = r.deals_count || 0;
    const wonCount = r.won_count || 0;
    const outcomeMapped = r.outcome_mapped_count || 0;
    const seatRaw = r.seat_count || 0;

    // Aucun deal : rien n'est mesurable, tout reste inconnu. On horodate
    // quand même, pour distinguer « jamais calculé » de « calculé, vide ».
    if (dealsCount === 0) {
      return persist(userId, {
        dealsCount: 0,
        wonCount: 0,
        hasClientBase: null,
        crmHistoryMonths: null,
        crmSeatCount: null,
      });
    }

    // Base clients : vrai dès qu'un deal est gagné. Faux seulement si l'issue
    // des deals est effectivement mappée chez ce client (au moins un won ou
    // un lost) et qu'aucun n'est gagné. Sinon inconnu : 67 lignes de prod sont
    // restées en statut « imported », leur issue n'a jamais été rapatriée, et
    // en conclure « pas de clients » serait un faux négatif.
    let hasClientBase = null;
    if (wonCount > 0) hasClientBase = true;
    else if (outcomeMapped > 0) hasClientBase = false;

    // seatRaw vaut 0 quand owner_email et crm_owner_id sont NULL partout,
    // ce qui est le cas de 100 % de la prod aujourd'hui. Zéro personne sur un
    // CRM qui contient des deals est impossible : c'est un inconnu, pas un zéro.
    const crmSeatCount = seatRaw > 0 ? seatRaw : null;

    return persist(userId, {
      dealsCount,
      wonCount,
      hasClientBase,
      // Non calculable tant que la date CRM n'est pas persistée à l'import.
      crmHistoryMonths: null,
      crmSeatCount,
    });
  } catch (err) {
    logger.warn('icp-signals', `Calcul échoué pour ${userId}`, { error: err.message });
    return null;
  }
}

/**
 * Upsert et non update : un utilisateur qui connecte son CRM avant d'avoir
 * rempli son profil n'a pas encore de ligne dans user_profiles, et un UPDATE
 * y perdrait silencieusement le calcul.
 */
async function persist(userId, s) {
  await db.query(
    `INSERT INTO user_profiles (
       user_id, icp_deals_count, icp_won_deals_count, icp_has_client_base,
       icp_crm_history_months, icp_crm_seat_count, icp_computed_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (user_id) DO UPDATE SET
       icp_deals_count = EXCLUDED.icp_deals_count,
       icp_won_deals_count = EXCLUDED.icp_won_deals_count,
       icp_has_client_base = EXCLUDED.icp_has_client_base,
       icp_crm_history_months = EXCLUDED.icp_crm_history_months,
       icp_crm_seat_count = EXCLUDED.icp_crm_seat_count,
       icp_computed_at = now(),
       updated_at = now()`,
    [userId, s.dealsCount, s.wonCount, s.hasClientBase, s.crmHistoryMonths, s.crmSeatCount]
  );
  return s;
}

module.exports = { computeIcpSignals };
