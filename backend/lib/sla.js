/**
 * SLA — seuils de réactivité définis par l'admin, évalués en SQL pur.
 *
 * Trois SLA, choisis pour ne dépendre que de colonnes fiables du sync CRM :
 * - new_lead          : lead status 'new' créé depuis > newLeadDays sans aucune
 *                       activité enregistrée depuis sa création
 * - followup_overdue  : relance planifiée (planned_followup_date — « Reporter »
 *                       ou next_activity_date Pipedrive) dépassée de plus de
 *                       followupGraceDays
 * - inactive          : deal ouvert (ni won ni lost) sans activité depuis
 *                       > inactiveDays
 *
 * Config dans users.settings.sla, OFF par défaut : un SLA est une promesse que
 * l'admin déclare, pas une heuristique qu'on lui impose. Pas de cron ni d'appel
 * IA — évalué à la lecture (« À traiter aujourd'hui », digest du lundi), donc
 * déterministe et gratuit.
 *
 * Un même deal peut violer plusieurs SLA (un lead 'new' jamais touché finit
 * aussi inactif) : dédup par opportunité, la violation la plus actionnable
 * gagne (followup_overdue > new_lead > inactive).
 */

const db = require('../db');

const SLA_DEFAULTS = {
  enabled: false,
  newLeadDays: 2,       // lead entrant contacté sous N jours
  followupGraceDays: 1, // marge après la date de relance planifiée
  inactiveDays: 30,     // activité attendue sur tout deal ouvert sous N jours
};

// Bornes de validation partagées avec la route PATCH /api/settings/sla.
const SLA_BOUNDS = {
  newLeadDays: [1, 30],
  followupGraceDays: [0, 30],
  inactiveDays: [7, 365],
};

const MAX_PER_KIND = 10;

async function getSlaConfig(userId) {
  const r = await db.query(`SELECT settings->'sla' AS sla FROM users WHERE id = $1`, [userId]);
  const stored = (r.rows[0] && r.rows[0].sla) || {};
  return { ...SLA_DEFAULTS, ...stored };
}

/**
 * Liste les violations SLA d'un utilisateur.
 * Retourne [{ kind, days, id, name, email, company, dealValue }] — `days` est
 * l'âge du manquement dans l'unité du SLA (attente du lead, retard de relance,
 * jours d'inactivité).
 */
async function findSlaBreaches(userId, cfg = null) {
  const config = cfg || await getSlaConfig(userId);
  if (!config.enabled) return [];

  const [newLeads, overdue, inactive] = await Promise.all([
    db.query(
      `SELECT id, name, email, company, deal_value,
              EXTRACT(DAY FROM now() - created_at)::int AS days
       FROM opportunities
       WHERE user_id = $1 AND status = 'new'
         AND created_at < now() - interval '1 day' * $2
         AND (last_activity_at IS NULL OR last_activity_at <= created_at)
       ORDER BY created_at ASC LIMIT ${MAX_PER_KIND}`,
      [userId, config.newLeadDays]
    ),
    db.query(
      `SELECT id, name, email, company, deal_value,
              EXTRACT(DAY FROM now() - planned_followup_date)::int AS days
       FROM opportunities
       WHERE user_id = $1 AND status NOT IN ('won', 'lost')
         AND planned_followup_date < now() - interval '1 day' * $2
       ORDER BY planned_followup_date ASC LIMIT ${MAX_PER_KIND}`,
      [userId, config.followupGraceDays]
    ),
    db.query(
      `SELECT id, name, email, company, deal_value,
              EXTRACT(DAY FROM now() - COALESCE(last_activity_at, created_at))::int AS days
       FROM opportunities
       WHERE user_id = $1 AND status NOT IN ('won', 'lost')
         AND COALESCE(last_activity_at, created_at) < now() - interval '1 day' * $2
       ORDER BY COALESCE(last_activity_at, created_at) ASC LIMIT ${MAX_PER_KIND}`,
      [userId, config.inactiveDays]
    ),
  ]);

  const seen = new Set();
  const breaches = [];
  const collect = (rows, kind) => {
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      breaches.push({
        kind,
        days: r.days,
        id: r.id,
        name: r.name,
        email: r.email || null,
        company: r.company || null,
        dealValue: r.deal_value != null ? Number(r.deal_value) : null,
      });
    }
  };
  collect(overdue.rows, 'followup_overdue');
  collect(newLeads.rows, 'new_lead');
  collect(inactive.rows, 'inactive');
  return breaches;
}

module.exports = { SLA_DEFAULTS, SLA_BOUNDS, getSlaConfig, findSlaBreaches };
