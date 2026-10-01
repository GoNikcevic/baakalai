/**
 * Trigger Matching · logique unique de sélection des contacts pour les
 * nurture_triggers, partagée entre le cron (crm-agent stepNurture) et la
 * preview (routes/nurture.js). Les deux chemins divergeaient (preview sur
 * updated_at, cron sur last_activity_at) : la preview pouvait afficher 0 ou
 * tous les contacts par rapport à ce que le cron déclenchait réellement.
 *
 * Ancrages temporels :
 * - stagnation / inactivité : last_activity_at · jamais updated_at, que la
 *   synchro CRM réécrit à chaque passage (cf. churn-scoring.js)
 * - événements liés à la clôture (won/lost) : won_date / lost_date
 *   (migration 043), fallback updated_at pour les lignes historiques
 *   antérieures à ces colonnes
 */

const { onlyCrmContacts } = require('./crm-scope');
// Seuil partagé avec le scoring, la file de priorités et la population
// churn_risk du chat : une règle ne doit pas parler d'« à risque » autrement
// que le reste du produit.
const { AT_RISK_THRESHOLD } = require('./churn-scoring');

const DAY_MS = 86400000;

// Types évalués uniquement par le run manuel : nurture-engine interroge le
// CRM en direct (données newsletter Salesforce absentes de la base locale).
const MANUAL_ONLY_TYPES = ['newsletter_inactive', 'newsletter_engaged'];

/**
 * Un seul interlocuteur par société (lot 5).
 *
 * L'ordre de préférence est celui du produit, pas un hasard : l'interlocuteur
 * principal élu par la migration 125 d'abord, et à défaut le plus récemment
 * actif, parce que c'est celui dont on sait qu'il lit encore.
 *
 * Les contacts sans compte rattaché sortent tous : `account_id` NULL veut dire
 * « société inconnue », pas « même société ». Les regrouper n'en garderait
 * qu'un seul pour tout le reste de la base.
 */
function unParCompte(opps) {
  const parCompte = new Map();
  const sansCompte = [];

  for (const o of opps) {
    if (!o.account_id) { sansCompte.push(o); continue; }
    const tenant = parCompte.get(o.account_id);
    if (!tenant) { parCompte.set(o.account_id, o); continue; }

    if (o.is_primary_contact && !tenant.is_primary_contact) {
      parCompte.set(o.account_id, o);
      continue;
    }
    if (tenant.is_primary_contact) continue;

    const dateDe = x => new Date(x.last_activity_at || x.updated_at || x.created_at || 0).getTime();
    if (dateDe(o) > dateDe(tenant)) parCompte.set(o.account_id, o);
  }

  return [...sansCompte, ...parCompte.values()];
}

/**
 * Retourne les opportunités qui matchent un trigger à l'instant `now`.
 * `defaults.stagnantDays` fournit le repli du trigger deal_stagnant quand il ne
 * porte pas de seuil explicite (cf. lib/stagnation.js).
 * `opps` = lignes de la table opportunities (SELECT *).
 * Retourne null si le type n'est pas évaluable depuis la base locale
 * (types MANUAL_ONLY_TYPES) · à distinguer de [] (évalué, aucun match).
 *
 * Les prospects froids d'une campagne de prospection sont écartés en entrée
 * (cf. crm-scope.js) : les triggers d'Activation ne parlent qu'aux contacts
 * venus du CRM. Le filtre est ici et non dans les requêtes appelantes parce
 * que cette fonction est le point de passage unique du cron (crm-agent) et
 * de la preview (routes/nurture.js) · les deux héritent donc de la règle.
 */
function matchContacts(trigger, allOpps, now = Date.now(), defaults = {}) {
  const opps = onlyCrmContacts(allOpps);
  const conditions = trigger.conditions || {};
  const days = conditions.days || 30;

  const ageDays = (o, dateStr) => {
    const d = dateStr || o.created_at;
    return d ? (now - new Date(d).getTime()) / DAY_MS : null;
  };
  const inWindow = (age, from, span) => age !== null && age >= from && age < from + span;

  switch (trigger.trigger_type) {
    case 'deal_won':
      // Fenêtre de 7 jours après [days] : sans fenêtre, chaque run rematchait
      // l'intégralité des contacts gagnés · seuls la dédup 7 jours et le
      // plafond par run masquaient le problème.
      return opps.filter(o =>
        o.status === 'won' &&
        inWindow(ageDays(o, o.won_date || o.updated_at), conditions.days || 1, 7)
      );

    case 'deal_lost':
      return opps.filter(o =>
        o.status === 'lost' &&
        inWindow(ageDays(o, o.lost_date || o.updated_at), days, 7)
      );

    case 'deal_stagnant': {
      // Même job que la file de réactivation : à défaut de seuil explicite sur
      // le trigger, on repart du réglage de dormance de l'utilisateur plutôt
      // que d'un autre nombre en dur (cf. lib/stagnation.js). Un trigger qui
      // porte son propre `days` le garde : écrire automatiquement plus tard
      // qu'on ne regarde est un choix légitime, mais il part de la même base.
      const stagnantDays = conditions.days || defaults.stagnantDays || days;
      return opps.filter(o => {
        if (o.status === 'won' || o.status === 'lost') return false;
        const age = ageDays(o, o.last_activity_at);
        return age !== null && age >= stagnantDays;
      });
    }

    case 'inactive_contact':
      return opps.filter(o => {
        if (o.status === 'lost') return false;
        const age = ageDays(o, o.last_activity_at);
        return age !== null && age >= days;
      });

    case 'onboarding_check':
      return opps.filter(o =>
        o.status === 'won' &&
        inWindow(ageDays(o, o.won_date || o.updated_at), days, 3)
      );

    case 'renewal':
    case 'renewal_reminder':
      return opps.filter(o => {
        if (o.status !== 'won') return false;
        if (o.renewal_date) {
          const daysUntilRenewal = (new Date(o.renewal_date).getTime() - now) / DAY_MS;
          return daysUntilRenewal <= days && daysUntilRenewal >= -7; // X jours avant + 7 jours de grâce
        }
        // Fallback : won_date + days comme estimation de renouvellement
        const age = ageDays(o, o.won_date || o.updated_at);
        return age !== null && age >= days;
      });

    case 'churn_risk': {
      // Le churn est un état : sans date de franchissement, la règle
      // reproposerait la même population tous les jours. On matche donc sur
      // l'ÉVÉNEMENT « ce client vient de passer à risque » (churn_flagged_at,
      // migration 109), avec la même fenêtre de 7 jours que deal_won : le
      // client est vu une fois, la dédup 7 jours fait le reste.
      // `days` = délai de courtoisie avant de relancer (0 = dès le signalement).
      // NB : `churn_flagged_at` doit être testée explicitement · ageDays()
      // retombe sur created_at quand la date est absente, ce qui ferait matcher
      // de vieux clients jamais signalés.
      //
      // Lot 5 · `defaults.accountChurn` est la Map des comptes scorés
      // (migration 131). Quand elle est fournie, c'est le signalement du COMPTE
      // qui fait foi : un client qui part est une société, pas une personne.
      // Absente, le comportement est exactement celui d'avant.
      const parCompte = defaults.accountChurn;
      const retenus = opps.filter(o => {
        if (o.status !== 'won') return false;
        const compte = parCompte && o.account_id ? parCompte.get(o.account_id) : null;
        const flaggedAt = compte ? compte.flaggedAt : o.churn_flagged_at;
        const score = compte ? compte.score : o.churn_score;
        if (!flaggedAt) return false;
        if ((score || 0) < AT_RISK_THRESHOLD) return false;
        return inWindow(ageDays(o, flaggedAt), conditions.days || 0, 7);
      });
      // Un client à risque est UNE société, et on ne lui écrit qu'une fois. Sans
      // ce repli, une société à huit interlocuteurs déclenchait huit relances le
      // même jour, toutes vers le même domaine : le motif de spam exact que le
      // lot 6 cherche à éviter.
      return parCompte ? unParCompte(retenus) : retenus;
    }

    case 'upsell_opportunity':
      return opps.filter(o => {
        if (o.status !== 'won') return false;
        const age = ageDays(o, o.won_date || o.updated_at);
        return age !== null && age >= days;
      });

    case 'feedback_request':
      return opps.filter(o =>
        o.status === 'won' &&
        inWindow(ageDays(o, o.won_date || o.updated_at), days, 7)
      );

    default:
      return MANUAL_ONLY_TYPES.includes(trigger.trigger_type) ? null : [];
  }
}

module.exports = { matchContacts, MANUAL_ONLY_TYPES, DAY_MS };
