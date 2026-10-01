/**
 * Signaux ICP · ce qu'on peut déduire du CRM sans rien demander.
 *
 * L'ICP arrêté le 2026-09-02 repose sur 4 critères. Un seul n'est pas
 * déductible (le poste) : il est demandé à l'onboarding. Les trois autres se
 * déduisent du CRM connecté. Ce module est écrit pour dire ce qu'il ne sait pas
 * mesurer au lieu de le masquer derrière une valeur plausible.
 *
 * Règle centrale : NULL veut dire « inconnu », jamais « zéro ». Un critère
 * qu'on ne sait pas mesurer ne doit pas ressortir en faux négatif, sinon on
 * disqualifie des comptes sur une lacune de notre propre import.
 *
 * État au 2026-09-22, les trois critères déductibles sont branchés :
 *   - base clients        : won_date / status
 *   - ancienneté CRM      : min(opportunities.crm_created_at), colonne ajoutée
 *                           par la migration 113 et alimentée à l'import par
 *                           lib/crm-origin.js. À NE PAS confondre avec
 *                           created_at, qui est notre date d'insertion.
 *   - personnes sur le CRM: owners distincts (crm_owner_id, ou owner_email
 *                           pour les connecteurs sans identifiant stable).
 *
 * CE QUI BLOQUAIT JUSQU'AU 2026-09-22
 * -----------------------------------
 * L'ancienneté n'avait nulle part où être stockée : la couche api/ récupérait
 * la date CRM puis la jetait. Les owners, eux, étaient bien passés par
 * crm-agent.js, mais `crm-owner-resolver.js` ne savait lire que la forme brute
 * de chaque API alors que les connecteurs renomment leurs champs : il renvoyait
 * null sur HubSpot, Salesforce et Odoo, d'où 443 lignes de prod sans owner.
 *
 * ATTENTION AUX LIGNES ANCIENNES
 * ------------------------------
 * Les opportunités importées avant la 113 n'ont pas de date CRM. Elles se
 * remplissent au passage suivant du cron CRM (crm-agent.js rattrape la colonne
 * quand elle est vide), pas rétroactivement. Tant qu'un compte n'a aucune ligne
 * datée, l'ancienneté ressort NULL, c'est-à-dire inconnue : jamais zéro.
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
         -- Deux comptages plutôt qu'un COALESCE : selon le connecteur, une
         -- personne est identifiée par un id CRM (Pipedrive, HubSpot,
         -- Salesforce, Odoo) ou seulement par un email (Airtable, dont l'owner
         -- est une colonne libre). Un COALESCE mélangeait les deux registres
         -- dans la même colonne et comptait « 12 » aussi bien qu'une adresse.
         count(DISTINCT crm_owner_id) FILTER (
           WHERE crm_owner_id IS NOT NULL
         )::int AS owner_id_count,
         count(DISTINCT lower(owner_email)) FILTER (
           WHERE crm_owner_id IS NULL AND owner_email IS NOT NULL
         )::int AS owner_email_only_count,
         min(crm_created_at) AS crm_oldest,
         -- Ancienneté de la RELATION, et non du plus ancien contact · un
         -- contact naît en même temps que son compte ou après, jamais avant.
         -- Calculée sur le contact, l'ancienneté était donc systématiquement
         -- sous-estimée, avec des faux négatifs sur le critère « au moins 12
         -- mois d'historique », qui est l'un des trois de l'ICP.
         --
         -- Sous-requete et non jointure : joindre accounts multiplierait les
         -- lignes d opportunities et fausserait tous les comptages ci-dessus.
         -- NULL tant que les comptes ne portent pas de date, et le repli sur
         -- le contact reste alors en place.
         -- (Pas d accent grave dans ce commentaire : il est a l interieur d un
         --  gabarit JavaScript, un backtick y termine la chaine.)
         (SELECT min(a.crm_created_at) FROM accounts a WHERE a.user_id = $1) AS account_oldest
       FROM opportunities
       WHERE user_id = $1`,
      [userId]
    );

    const r = rows[0] || {};
    const dealsCount = r.deals_count || 0;
    const wonCount = r.won_count || 0;
    const outcomeMapped = r.outcome_mapped_count || 0;

    // ── Les sièges se comptent sur les TROIS niveaux (lot 5) ──
    //
    // Compté sur les seuls contacts, ce signal est resté NULL sur 100 % des
    // lignes de production : aucun des connecteurs ne remontait l'owner du
    // contact. Or un Salesforce porte trois owners souvent distincts, et le
    // commercial qu'on cherche à compter est celui de l'AFFAIRE ou du COMPTE,
    // pas celui de la personne. Les migrations 124 et 126 ont créé les deux
    // colonnes manquantes ; les lire est ce qui rend le signal calculable.
    //
    // Les deux registres restent SÉPARÉS, exactement comme sur la requête
    // ci-dessus : selon le connecteur une personne est un id CRM ou une simple
    // adresse, et les mélanger dans un COALESCE comptait « 12 » aussi bien
    // qu'un email. Une requête à part et non une jointure : joindre accounts ou
    // deals multiplierait les lignes d'opportunities et fausserait tous les
    // comptages d'issue calculés plus haut.
    let seatRaw = (r.owner_id_count || 0) + (r.owner_email_only_count || 0);
    try {
      const seats = await db.query(
        // Sous-requete et non CTE : le miroir SQLite des tests reconnait une
        // LECTURE au prefixe `SELECT` et aurait execute un `WITH` comme un ordre
        // d ecriture, en rendant zero ligne sans la moindre erreur. Le comptage
        // serait alors reste nul en silence, exactement le defaut qu on repare.
        `SELECT
           count(DISTINCT crm_owner_id) FILTER (
             WHERE crm_owner_id IS NOT NULL
           )::int AS owner_id_count,
           count(DISTINCT lower(owner_email)) FILTER (
             WHERE crm_owner_id IS NULL AND owner_email IS NOT NULL
           )::int AS owner_email_only_count
         FROM (
           SELECT crm_owner_id, owner_email FROM opportunities WHERE user_id = $1
           UNION ALL
           SELECT crm_owner_id, owner_email FROM accounts WHERE user_id = $1
           UNION ALL
           SELECT crm_owner_id, owner_email FROM deals WHERE user_id = $1
         ) AS tous`,
        [userId]
      );
      const s = seats.rows[0] || {};
      const elargi = (s.owner_id_count || 0) + (s.owner_email_only_count || 0);
      // Jamais à la baisse : si les trois niveaux voient moins de monde que les
      // contacts seuls, c'est une anomalie de lecture, pas une équipe qui a
      // rétréci. On garde alors le comptage historique.
      if (elargi > seatRaw) seatRaw = elargi;
    } catch (err) {
      // Les tables du chantier comptes peuvent manquer sur un environnement en
      // retard de migration : le signal retombe sur le comptage par contact
      // plutôt que de faire échouer tout le calcul ICP.
      logger.warn('icp-signals', `Comptage des sieges sur comptes et affaires indisponible pour ${userId}`, { error: err.message });
    }

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

    // seatRaw vaut 0 tant qu'aucun owner n'a été rapatrié, ce qui reste le cas
    // des lignes importées avant la migration 113. Zéro personne sur un CRM qui
    // contient des deals est impossible : c'est un inconnu, pas un zéro.
    const crmSeatCount = seatRaw > 0 ? seatRaw : null;

    return persist(userId, {
      dealsCount,
      wonCount,
      hasClientBase,
      // La date du COMPTE d'abord, celle du contact en repli · voir la requête.
      // Les deux sont des dates CRM, jamais des dates d'import.
      crmHistoryMonths: monthsSince(r.account_oldest || r.crm_oldest),
      crmSeatCount,
    });
  } catch (err) {
    logger.warn('icp-signals', `Calcul échoué pour ${userId}`, { error: err.message });
    return null;
  }
}

/**
 * Ancienneté du CRM en mois révolus, depuis le plus ancien contact importé.
 *
 * Mois RÉVOLUS et non arrondis : le critère ICP est « ≥ 12 mois d'historique ».
 * Un CRM ouvert il y a 11 mois et 20 jours ne doit pas ressortir à 12, sinon on
 * qualifie un compte sur un arrondi.
 *
 * Renvoie null si aucune opportunité ne porte de date CRM : soit le connecteur
 * ne l'expose pas, soit les lignes datent d'avant la migration 113. Inconnu
 * n'est pas zéro, et un zéro ferait ressortir « CRM créé ce mois-ci », ce qui
 * disqualifierait le compte sur une lacune de notre import.
 *
 * @param {string|Date|null} oldest  date du plus ancien contact, côté CRM
 * @returns {number|null} nombre de mois révolus, ou null si inconnu
 */
function monthsSince(oldest) {
  if (!oldest) return null;
  const from = oldest instanceof Date ? oldest : new Date(oldest);
  if (Number.isNaN(from.getTime())) return null;

  const now = new Date();
  let months = (now.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (now.getUTCMonth() - from.getUTCMonth());
  // Le mois en cours n'est pas révolu tant que le jour du mois n'est pas atteint.
  if (now.getUTCDate() < from.getUTCDate()) months -= 1;

  // Une date CRM dans le futur est une anomalie de saisie, pas une ancienneté
  // négative. Elle est déjà filtrée à l'extraction (lib/crm-activity-date.js),
  // ce garde-fou couvre les lignes écrites avant ce filtre.
  return months > 0 ? months : 0;
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

module.exports = { computeIcpSignals, monthsSince };
