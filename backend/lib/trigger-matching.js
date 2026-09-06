/**
 * Trigger Matching — logique unique de sélection des contacts pour les
 * nurture_triggers, partagée entre le cron (crm-agent stepNurture) et la
 * preview (routes/nurture.js). Les deux chemins divergeaient (preview sur
 * updated_at, cron sur last_activity_at) : la preview pouvait afficher 0 ou
 * tous les contacts par rapport à ce que le cron déclenchait réellement.
 *
 * Ancrages temporels :
 * - stagnation / inactivité : last_activity_at — jamais updated_at, que la
 *   synchro CRM réécrit à chaque passage (cf. churn-scoring.js)
 * - événements liés à la clôture (won/lost) : won_date / lost_date
 *   (migration 043), fallback updated_at pour les lignes historiques
 *   antérieures à ces colonnes
 */

const DAY_MS = 86400000;

// Types évalués uniquement par le run manuel : nurture-engine interroge le
// CRM en direct (données newsletter Salesforce absentes de la base locale).
const MANUAL_ONLY_TYPES = ['newsletter_inactive', 'newsletter_engaged'];

/**
 * Retourne les opportunités qui matchent un trigger à l'instant `now`.
 * `opps` = lignes de la table opportunities (SELECT *).
 * Retourne null si le type n'est pas évaluable depuis la base locale
 * (types MANUAL_ONLY_TYPES) — à distinguer de [] (évalué, aucun match).
 */
function matchContacts(trigger, opps, now = Date.now()) {
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
      // l'intégralité des contacts gagnés — seuls la dédup 7 jours et le
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

    case 'deal_stagnant':
      return opps.filter(o => {
        if (o.status === 'won' || o.status === 'lost') return false;
        const age = ageDays(o, o.last_activity_at);
        return age !== null && age >= days;
      });

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
