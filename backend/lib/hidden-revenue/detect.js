/**
 * Détection des candidats et mesure de la base · la couche SQL du Hidden Revenue Score.
 *
 * Deux règles tiennent tout le fichier :
 *
 * 1. `snapshotAt` est l'horloge. Aucune requête n'utilise now() : toutes les
 *    ancienneté se mesurent par rapport au moment gelé du calcul, sinon
 *    relancer le score demain sur les mêmes données donne un autre résultat.
 *
 * 2. Périmètre CRM uniquement (`campaign_id IS NULL`, cf. lib/crm-scope.js).
 *    Un prospect froid importé par une campagne n'a jamais parlé à
 *    l'utilisateur : il n'y a aucun revenu « dormant » à récupérer chez lui.
 *
 * La dormance n'est pas redéfinie ici : elle vient du réglage de l'utilisateur
 * (lib/stagnation.js), le même que la file de réactivation et le compte-rendu
 * de lecture. Trois écrans qui comptent des deals dormants différemment, c'est
 * la première chose qu'un utilisateur remarque.
 */

const db = require('../../db');
const logger = require('../logger');
const { CRM_CONTACT_SQL } = require('../crm-scope');

const DAY_MS = 86400000;
const MONTH_DAYS = 30.44;

/** Un client silencieux depuis 90 jours : même seuil que le facteur
 *  `client_silent` de lib/churn-scoring.js, volontairement partagé. */
const SILENT_CLIENT_DAYS = 90;

/** Au delà de 24 mois, un deal perdu n'est plus une vente différée. */
const LOST_LOOKBACK_MONTHS = 24;

/** Profondeur d'historique au delà de laquelle la confiance ne gagne plus rien. */
const HISTORY_TARGET_MONTHS = 24;

/** Volume conclu en dessous duquel tout taux calculé est du bruit. */
const VOLUME_TARGET_CLOSED = 30;

/** Garde-fou de volume par dimension. Le produit plafonne à 5 personnes sur le
 *  CRM d'une PME : dépasser ce nombre de candidats signale une base hors
 *  gabarit, pas un usage normal. Le dépassement est signalé, jamais silencieux
 *  (cf. `truncated` dans le contexte du snapshot). */
const MAX_CANDIDATES_PER_DIMENSION = 5000;

/**
 * Les candidats les plus gros d'abord, et on signale si la requête a buté sur
 * le plafond. Un écrêtage silencieux se lirait comme « voilà tout ce qu'il y a ».
 */
function capRows(rows, source) {
  if (rows.length <= MAX_CANDIDATES_PER_DIMENSION) return { rows, truncated: false };
  logger.warn('hidden-revenue', `${source} : ${rows.length} candidats, tronqué à ${MAX_CANDIDATES_PER_DIMENSION}`);
  return { rows: rows.slice(0, MAX_CANDIDATES_PER_DIMENSION), truncated: true };
}

/**
 * Base de revenu et couvertures de données, en une passe.
 * La base de revenu (pipeline ouvert + gagné sur 12 mois) est le dénominateur
 * des intensités : elle répond à « dormant par rapport à quoi ».
 */
async function loadBase(userId, snapshotAt) {
  const r = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE deal_value IS NOT NULL AND deal_value > 0)::int AS with_value,
       COUNT(*) FILTER (WHERE last_activity_at IS NOT NULL)::int AS with_activity,
       COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '' AND email_bounced_at IS NULL)::int AS contactable,
       COUNT(*) FILTER (WHERE status = 'won')::int AS won_count,
       COUNT(*) FILTER (WHERE status = 'lost')::int AS lost_count,
       COUNT(*) FILTER (WHERE status = 'lost' AND lost_reason IS NOT NULL AND lost_reason <> '')::int AS lost_with_reason,
       COUNT(*) FILTER (WHERE status NOT IN ('won', 'lost') AND created_at < $2::timestamptz - interval '3 years')::int AS zombie_open,
       COUNT(*) FILTER (WHERE status = 'won' AND won_date IS NULL)::int AS won_without_date,
       MIN(created_at) AS oldest_record,
       COALESCE(SUM(deal_value) FILTER (WHERE status NOT IN ('won', 'lost')), 0)::float AS open_value,
       COALESCE(SUM(deal_value) FILTER (
         WHERE status = 'won'
           AND COALESCE(won_date, last_activity_at, created_at) > $2::timestamptz - interval '365 days'
       ), 0)::float AS won_value_12m
     FROM opportunities
     WHERE user_id = $1 AND ${CRM_CONTACT_SQL}`,
    [userId, snapshotAt]
  );

  const row = r.rows[0] || {};
  const total = row.total || 0;
  const closed = (row.won_count || 0) + (row.lost_count || 0);
  const ratio = (n) => (total > 0 ? n / total : 0);

  const historyMonths = row.oldest_record
    ? (new Date(snapshotAt).getTime() - new Date(row.oldest_record).getTime()) / DAY_MS / MONTH_DAYS
    : 0;

  return {
    total,
    openValue: row.open_value || 0,
    wonValue12m: row.won_value_12m || 0,
    revenueBase: (row.open_value || 0) + (row.won_value_12m || 0),
    wonCount: row.won_count || 0,
    lostCount: row.lost_count || 0,
    historyMonths: Math.round(historyMonths * 10) / 10,
    coverage: {
      amountCoverage: ratio(row.with_value || 0),
      activityCoverage: ratio(row.with_activity || 0),
      contactability: ratio(row.contactable || 0),
      historyDepth: Math.min(1, historyMonths / HISTORY_TARGET_MONTHS),
      volume: Math.min(1, closed / VOLUME_TARGET_CLOSED),
      // Deux incohérences classiques : des deals « ouverts » depuis plus de
      // trois ans que personne n'a jamais clos, et des gagnés sans date de
      // signature. Les deux faussent toute mesure d'ancienneté.
      statusCoherence: total > 0
        ? Math.max(0, 1 - ((row.zombie_open || 0) + (row.won_without_date || 0)) / total)
        : 0,
      // Rapportée aux perdus seulement : un CRM sans aucune perte enregistrée
      // ne doit pas être puni sur ce critère, il n'a rien à renseigner.
      lostReasonCoverage: (row.lost_count || 0) > 0
        ? (row.lost_with_reason || 0) / row.lost_count
        : 1,
    },
  };
}

/**
 * Médianes des deals gagnés, globale et par famille d'étape · sert de valeur de
 * repli quand le CRM ne porte aucun montant. C'est le cas type de la PME mal
 * renseignée, et laisser ces deals à zéro reviendrait à dire « vous n'avez rien
 * à récupérer » alors qu'on ne sait simplement pas combien.
 *
 * La médiane, pas la moyenne : un seul contrat exceptionnel ne doit pas
 * redéfinir la valeur de tous les deals vides de la base.
 */
async function loadWonMedians(userId, snapshotAt) {
  const { stageBucket } = require('./probability');
  const r = await db.query(
    `SELECT deal_value, crm_stage FROM opportunities
     WHERE user_id = $1 AND ${CRM_CONTACT_SQL}
       AND status = 'won' AND deal_value IS NOT NULL AND deal_value > 0
       AND COALESCE(won_date, last_activity_at, created_at) <= $2::timestamptz
     LIMIT 5000`,
    [userId, snapshotAt]
  );

  const median = (values) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };

  const all = [];
  const byBucket = { late: [], early: [], unknown: [] };
  for (const row of r.rows) {
    const value = Number(row.deal_value);
    if (!Number.isFinite(value) || value <= 0) continue;
    all.push(value);
    byBucket[stageBucket(row.crm_stage)].push(value);
  }

  return {
    sample: all.length,
    global: median(all),
    // Sous 5 deals gagnés à une étape donnée, la médiane par étape est du bruit :
    // on retombe sur la médiane globale.
    byBucket: {
      late: byBucket.late.length >= 5 ? median(byBucket.late) : null,
      early: byBucket.early.length >= 5 ? median(byBucket.early) : null,
      unknown: byBucket.unknown.length >= 5 ? median(byBucket.unknown) : null,
    },
  };
}

/**
 * Engagement email par opportunité · relances restées sans réponse (180 j) et
 * réponse positive récente (90 j).
 */
async function loadEngagement(userId, snapshotAt) {
  const map = new Map();
  try {
    const r = await db.query(
      `SELECT opportunity_id,
         COUNT(*) FILTER (
           WHERE status = 'sent' AND replied_at IS NULL
             AND created_at > $2::timestamptz - interval '180 days'
             AND created_at <= $2::timestamptz
         )::int AS unanswered,
         COUNT(*) FILTER (
           WHERE sentiment = 'positive' AND replied_at IS NOT NULL
             AND replied_at > $2::timestamptz - interval '90 days'
             AND replied_at <= $2::timestamptz
         )::int AS positive
       FROM nurture_emails
       WHERE user_id = $1 AND opportunity_id IS NOT NULL
       GROUP BY opportunity_id`,
      [userId, snapshotAt]
    );
    for (const row of r.rows) {
      map.set(row.opportunity_id, {
        unansweredCount: row.unanswered || 0,
        positiveReply: (row.positive || 0) > 0,
      });
    }
  } catch { /* aucun email envoyé : engagement neutre pour tout le monde */ }
  return map;
}

/**
 * Pipeline dormant · deux familles que le vendeur vit de la même façon
 * (« ce deal ne bouge plus ») et que le CRM enregistre différemment :
 *
 *   - les deals ouverts silencieux au delà du seuil de l'utilisateur ;
 *   - les deals marqués perdus dans les 24 derniers mois, dont la raison de
 *     perte dit souvent « pas maintenant » plutôt que « jamais ».
 *
 * Les pertes plus fraîches que le seuil de dormance sont exclues : le vendeur
 * s'en souvient, ce n'est pas du revenu oublié.
 */
async function listDormantPipeline(userId, snapshotAt, stagnantDays) {
  const r = await db.query(
    `SELECT id, name, company, email, status, deal_value, crm_stage, lost_reason,
            created_at, email_bounced_at,
            COALESCE(last_activity_at, created_at) AS last_touch,
            COALESCE(lost_date, last_activity_at, created_at) AS closed_at
     FROM opportunities
     WHERE user_id = $1 AND ${CRM_CONTACT_SQL}
       AND (
         (status NOT IN ('won', 'lost')
            AND COALESCE(last_activity_at, created_at) < $2::timestamptz - ($3 || ' days')::interval)
         OR
         (status = 'lost'
            AND COALESCE(lost_date, last_activity_at, created_at) < $2::timestamptz - ($3 || ' days')::interval
            AND COALESCE(lost_date, last_activity_at, created_at) > $2::timestamptz - interval '${LOST_LOOKBACK_MONTHS} months')
       )
     ORDER BY deal_value DESC NULLS LAST
     LIMIT ${MAX_CANDIDATES_PER_DIMENSION + 1}`,
    [userId, snapshotAt, String(stagnantDays)]
  );
  return capRows(r.rows, 'pipeline dormant');
}

/**
 * Réactivation client · les comptes déjà gagnés devenus silencieux.
 *
 * La valeur retenue est ce que le client dépensait, pas une projection : « il
 * achetait 25 k€, on n'a plus aucune trace depuis 14 mois ». C'est le seul
 * montant qu'on puisse défendre sans rien inventer.
 */
async function listCustomerReactivation(userId, snapshotAt) {
  const r = await db.query(
    `SELECT id, name, company, email, status, deal_value, crm_stage, lost_reason,
            created_at, email_bounced_at, won_date,
            COALESCE(last_activity_at, won_date, created_at) AS last_touch
     FROM opportunities
     WHERE user_id = $1 AND ${CRM_CONTACT_SQL}
       AND status = 'won'
       AND COALESCE(last_activity_at, won_date, created_at) < $2::timestamptz - interval '${SILENT_CLIENT_DAYS} days'
     ORDER BY deal_value DESC NULLS LAST
     LIMIT ${MAX_CANDIDATES_PER_DIMENSION + 1}`,
    [userId, snapshotAt]
  );
  return capRows(r.rows, 'réactivation client');
}

module.exports = {
  loadBase,
  loadWonMedians,
  loadEngagement,
  listDormantPipeline,
  listCustomerReactivation,
  SILENT_CLIENT_DAYS,
  LOST_LOOKBACK_MONTHS,
  HISTORY_TARGET_MONTHS,
  VOLUME_TARGET_CLOSED,
  MAX_CANDIDATES_PER_DIMENSION,
};
