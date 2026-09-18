/**
 * Activity digest · ce que baakalai a fait, semaine par semaine.
 *
 * Alimente le bloc « Cette semaine » du dashboard et l'en-tête du digest du
 * lundi. Tout est agrégé depuis les tables déjà remplies par les agents : rien
 * de nouveau à instrumenter, et le bilan est disponible rétroactivement dès la
 * première connexion d'un utilisateur.
 *
 * Trois couches, dans cet ordre de lecture :
 *   1. `results`  · ce que le travail a produit (deals repartis, réponses,
 *                   clients à risque repérés). C'est ce qui justifie l'abonnement.
 *   2. `counters` · le volume de travail, converti en équivalent temps humain.
 *   3. `pending`  · ce qui a échoué ou attend l'utilisateur. Sans cette couche,
 *                   les deux précédentes ne sont qu'une vitrine.
 *
 * Le barème (RATES) est volontairement bas et affiché dans l'UI : un
 * utilisateur qui recoupe doit trouver le compte honnête, sinon il ne croira
 * plus aucun chiffre du dashboard.
 */

const db = require('../db');

// Minutes de travail humain par action. Ne jamais gonfler : la crédibilité de
// tout le bloc tient à ce tableau, qui est affiché tel quel à l'utilisateur.
const RATES = {
  accountsReviewed: 1,  // relire une fiche et son historique
  signals: 4,           // détecter, qualifier et prioriser un signal
  followUps: 8,         // rédiger une relance personnalisée
  issuesFound: 2,       // repérer un doublon, un email manquant, un champ vide
  analyses: 15,         // produire une analyse (deal coach, upsell, copy)
};

// Compteurs collectés mais volontairement exclus du total (voir l'UI : « non
// compté »). Les exclure coûte des heures affichées et achète de la crédibilité.
const UNCOUNTED = ['scoresRecalculated', 'followUpsSent'];

const TZ = 'Europe/Paris';

/** Équivalent temps humain, en minutes. Fonction pure, testée. */
function computeMinutes(counters) {
  let total = 0;
  for (const [key, rate] of Object.entries(RATES)) {
    const n = Number(counters?.[key]);
    if (Number.isFinite(n) && n > 0) total += n * rate;
  }
  return Math.round(total);
}

/**
 * Durée lisible, toujours arrondie VERS LE BAS à l'heure : 14 h 46 réelles
 * s'affichent « 14 h ». Sous une heure, on garde les minutes pour ne pas
 * afficher « 0 h ».
 */
function formatDuration(minutes, lang = 'fr') {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return lang === 'en' ? `${m} min` : `${m} min`;
  return `${Math.floor(m / 60)} h`;
}

/** Variation en % entre deux valeurs. null si la base est nulle (pas de « +∞ »). */
function variation(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p <= 0) return null;
  return Math.round(((c - p) / p) * 100);
}

/**
 * Bornes de la semaine demandée, en heure de Paris.
 * `weeksAgo = 0` : semaine en cours, du lundi 00 h à maintenant (fenêtre
 * partielle, c'est voulu : l'utilisateur veut voir le travail du jour même).
 * `weeksAgo = 1` : semaine complète précédente.
 */
async function resolveWindow(weeksAgo = 0) {
  // `AT TIME ZONE` lie plus fort que `+` : chaque conversion est parenthésée,
  // sans quoi Postgres applique le fuseau à l'intervalle et non à la date.
  const { rows } = await db.query(
    `WITH w AS (
       SELECT date_trunc('week', (now() AT TIME ZONE $1::text) - ($2::int * INTERVAL '1 week')) AS monday
     )
     SELECT
       (monday AT TIME ZONE $1::text) AS start_at,
       ((monday + INTERVAL '7 days') AT TIME ZONE $1::text) AS full_end_at,
       -- to_char et pas ::date : le driver rendrait un objet Date, dont le
       -- String() vaut « Mon Sep 14 » (sans année), impropre en paramètre DATE.
       to_char(monday, 'YYYY-MM-DD') AS week_start,
       to_char(monday + INTERVAL '6 days', 'YYYY-MM-DD') AS week_end,
       now() AS now_at
     FROM w`,
    [TZ, weeksAgo]
  );

  const row = rows[0];
  const start = new Date(row.start_at);
  const fullEnd = new Date(row.full_end_at);
  const now = new Date(row.now_at);
  const end = fullEnd > now ? now : fullEnd;

  return {
    start,
    end,
    weekStart: String(row.week_start).slice(0, 10),
    weekEnd: String(row.week_end).slice(0, 10),
    partial: end < fullEnd,
  };
}

/**
 * Compteurs bruts sur une fenêtre.
 *
 * `accountsReviewed` s'appuie sur `opportunities.updated_at`, que la synchro
 * CRM réécrit à chaque passage : c'est bien la trace d'une relecture complète
 * du portefeuille. Une modification manuelle de l'utilisateur touche la même
 * colonne, mais la fiche a de toute façon été relue par la synchro du jour :
 * l'écart reste dans le bruit, et jamais dans le sens de la surestimation.
 */
async function collectCounters(userId, start, end) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM opportunities
         WHERE user_id = $1 AND updated_at >= $2 AND updated_at < $3) AS accounts_reviewed,
       (SELECT COUNT(*) FROM signals
         WHERE user_id = $1 AND detected_at >= $2 AND detected_at < $3) AS signals,
       (SELECT COUNT(*) FROM nurture_emails
         WHERE user_id = $1 AND created_at >= $2 AND created_at < $3) AS follow_ups,
       (SELECT COUNT(*) FROM nurture_emails
         WHERE user_id = $1 AND status = 'sent' AND sent_at >= $2 AND sent_at < $3) AS follow_ups_sent,
       (SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(issues) = 'array'
                                 THEN jsonb_array_length(issues) ELSE 0 END), 0)
          FROM crm_cleaning_reports
         WHERE user_id = $1 AND created_at >= $2 AND created_at < $3) AS issues_found,
       (SELECT COUNT(*) FROM strategic_results
         WHERE user_id = $1 AND created_at >= $2 AND created_at < $3) AS analyses,
       (SELECT COUNT(*) FROM churn_score_history
         WHERE user_id = $1 AND scored_at >= $2 AND scored_at < $3) AS scores_recalculated`,
    [userId, start, end]
  );

  const r = rows[0] || {};
  const n = (v) => parseInt(v, 10) || 0;
  return {
    accountsReviewed: n(r.accounts_reviewed),
    signals: n(r.signals),
    followUps: n(r.follow_ups),
    followUpsSent: n(r.follow_ups_sent),
    issuesFound: n(r.issues_found),
    analyses: n(r.analyses),
    scoresRecalculated: n(r.scores_recalculated),
  };
}

/**
 * Ce que le travail a produit. L'attribution d'un deal repart de
 * `opportunities.reactivated_at`, posé par lib/deal-lifecycle-sync : un deal ne
 * compte que si baakalai l'a relancé ET que le deal a bougé ensuite. On ne
 * parle jamais de CA généré, seulement de pipeline touché.
 */
async function collectResults(userId, start, end) {
  const { AT_RISK_THRESHOLD } = require('./churn-scoring');

  const [reactivated, replies, churn] = await Promise.all([
    db.query(
      `SELECT id, name, company, deal_value, reactivated_at
         FROM opportunities
        WHERE user_id = $1 AND reactivated_at >= $2 AND reactivated_at < $3
        ORDER BY deal_value DESC NULLS LAST`,
      [userId, start, end]
    ),
    db.query(
      `SELECT ne.to_name, ne.to_email, ne.replied_at, o.company, o.name AS contact_name
         FROM nurture_emails ne
         LEFT JOIN opportunities o ON o.id = ne.opportunity_id
        WHERE ne.user_id = $1 AND ne.replied_at >= $2 AND ne.replied_at < $3
        ORDER BY ne.replied_at DESC`,
      [userId, start, end]
    ),
    // Clients qui basculent à risque pendant la fenêtre. Le NOT EXISTS évite de
    // re-annoncer chaque semaine un client déjà signalé le mois dernier.
    db.query(
      `SELECT o.id, o.name, o.company, o.churn_score
         FROM opportunities o
        WHERE o.user_id = $1 AND o.status = 'won'
          AND o.churn_score >= $4
          AND o.churn_scored_at >= $2 AND o.churn_scored_at < $3
          AND NOT EXISTS (
            SELECT 1 FROM churn_score_history h
             WHERE h.opportunity_id = o.id AND h.scored_at < $2 AND h.score >= $4
          )
        ORDER BY o.churn_score DESC`,
      [userId, start, end, AT_RISK_THRESHOLD]
    ),
  ]);

  const reactivatedValue = reactivated.rows.reduce(
    (sum, r) => sum + (Number(r.deal_value) || 0), 0
  );

  // Les items nourrissent les lignes nommées du bloc. Le front les met en
  // phrase : rien de rédigé ici, sinon il faudrait traduire le backend.
  const items = [
    ...reactivated.rows.slice(0, 3).map((r) => ({
      kind: 'reactivated',
      id: r.id,
      company: r.company || r.name || null,
      value: r.deal_value != null ? Number(r.deal_value) : null,
    })),
    ...replies.rows.slice(0, 3).map((r) => ({
      kind: 'reply',
      company: r.company || r.to_name || r.contact_name || r.to_email || null,
    })),
    ...churn.rows.slice(0, 2).map((r) => ({
      kind: 'churn',
      id: r.id,
      company: r.company || r.name || null,
      score: Math.min(100, Math.round(Number(r.churn_score) || 0)),
    })),
  ];

  return {
    reactivatedCount: reactivated.rows.length,
    reactivatedValue: Math.round(reactivatedValue),
    replies: replies.rows.length,
    churnAlerts: churn.rows.length,
    items,
  };
}

/** Ce qui a échoué ou attend l'utilisateur. Volontairement hors fenêtre : un
 *  email en attente depuis trois semaines doit rester visible cette semaine. */
async function collectPending(userId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM nurture_emails
         WHERE user_id = $1 AND status = 'pending') AS approvals,
       (SELECT FLOOR(EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 86400)::int
          FROM nurture_emails
         WHERE user_id = $1 AND status = 'pending') AS approvals_oldest_days,
       (SELECT COUNT(*) FROM sequence_enrollments
         WHERE user_id = $1 AND status = 'draft') AS drafts,
       (SELECT COUNT(*) FROM opportunities
         WHERE user_id = $1 AND status NOT IN ('won', 'lost')
           AND (email IS NULL OR email = '')) AS no_email`,
    [userId]
  );

  const r = rows[0] || {};
  const n = (v) => parseInt(v, 10) || 0;
  return {
    approvals: n(r.approvals),
    approvalsOldestDays: n(r.approvals_oldest_days),
    drafts: n(r.drafts),
    noEmail: n(r.no_email),
  };
}

/**
 * Actions par jour, lundi → dimanche. Sert la seule affirmation que le bloc
 * fait sur le mode de travail : il n'y a pas de jour à zéro, week-end compris.
 */
async function collectDaily(userId, start, end) {
  const { rows } = await db.query(
    `SELECT EXTRACT(ISODOW FROM (ts AT TIME ZONE $4::text))::int AS dow, COUNT(*)::int AS n
       FROM (
         SELECT updated_at AS ts FROM opportunities
           WHERE user_id = $1 AND updated_at >= $2 AND updated_at < $3
         UNION ALL SELECT detected_at FROM signals
           WHERE user_id = $1 AND detected_at >= $2 AND detected_at < $3
         UNION ALL SELECT created_at FROM nurture_emails
           WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
         UNION ALL SELECT created_at FROM data_quality_changes
           WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
         UNION ALL SELECT created_at FROM strategic_results
           WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
         UNION ALL SELECT scored_at FROM churn_score_history
           WHERE user_id = $1 AND scored_at >= $2 AND scored_at < $3
         -- Les scans qualité comptent aussi : sans eux, un utilisateur voyait
         -- « 46 fiches repérées » au registre et sept barres à zéro.
         UNION ALL SELECT created_at FROM crm_cleaning_reports
           WHERE user_id = $1 AND created_at >= $2 AND created_at < $3
       ) e
      GROUP BY 1`,
    [userId, start, end, TZ]
  );

  const daily = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const idx = (parseInt(row.dow, 10) || 1) - 1; // ISODOW : 1 = lundi
    if (idx >= 0 && idx < 7) daily[idx] = parseInt(row.n, 10) || 0;
  }
  return daily;
}

/**
 * Bilan complet d'une fenêtre arbitraire. `withPending` est mis à false pour la
 * fenêtre de comparaison : les actions en attente ne dépendent pas de la
 * période, les recalculer serait une requête pour rien.
 */
async function buildActivity(userId, window, { withPending = true } = {}) {
  const [counters, results, pending, daily] = await Promise.all([
    collectCounters(userId, window.start, window.end),
    collectResults(userId, window.start, window.end),
    withPending
      ? collectPending(userId)
      : Promise.resolve({ approvals: 0, approvalsOldestDays: 0, drafts: 0, noEmail: 0 }),
    collectDaily(userId, window.start, window.end),
  ]);

  const minutes = computeMinutes(counters);

  return {
    range: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      partial: window.partial,
    },
    counters,
    minutes,
    results,
    pending,
    daily,
    // Une semaine sans résultat n'est pas une semaine vide : le bloc bascule
    // alors sur la veille (« 412 comptes relus, rien à signaler »).
    hasResults: results.reactivatedCount > 0 || results.replies > 0 || results.churnAlerts > 0,
    hasWork: minutes > 0,
  };
}

/** Bilan d'une semaine entière (0 = en cours, 1 = la précédente). */
async function buildWeeklyActivity(userId, weeksAgo = 0) {
  const window = await resolveWindow(weeksAgo);
  return buildActivity(userId, window);
}

/**
 * Bilan de la semaine en cours + comparaison avec la semaine précédente.
 * La comparaison porte sur une fenêtre de MÊME durée (mardi 15 h se compare au
 * mardi 15 h précédent), sinon une semaine en cours paraîtrait toujours en
 * baisse. Écart d'une heure possible les week-ends de changement d'heure, sans
 * conséquence sur une variation en pourcentage.
 */
async function getDashboardActivity(userId, weeksAgo = 0) {
  const window = await resolveWindow(weeksAgo);
  const elapsedMs = window.end.getTime() - window.start.getTime();

  const previousWindow = await resolveWindow(weeksAgo + 1);
  const previous = {
    ...previousWindow,
    end: new Date(Math.min(
      previousWindow.start.getTime() + elapsedMs,
      previousWindow.end.getTime()
    )),
  };

  const [current, before] = await Promise.all([
    buildActivity(userId, window),
    buildActivity(userId, previous, { withPending: false }),
  ]);

  return {
    ...current,
    rates: RATES,
    uncounted: UNCOUNTED,
    previous: {
      counters: before.counters,
      minutes: before.minutes,
      results: {
        reactivatedCount: before.results.reactivatedCount,
        replies: before.results.replies,
      },
    },
    delta: {
      signals: variation(current.counters.signals, before.counters.signals),
      minutes: variation(current.minutes, before.minutes),
      followUps: variation(current.counters.followUps, before.counters.followUps),
    },
  };
}

/**
 * Fige la semaine écoulée. Appelé le lundi matin par le digest CRM, avant tout
 * early return : l'historique doit s'accumuler même pour un utilisateur
 * désabonné des emails.
 */
async function snapshotWeek(userId, weeksAgo = 1) {
  const activity = await buildWeeklyActivity(userId, weeksAgo);

  await db.query(
    `INSERT INTO weekly_activity_snapshots
       (user_id, week_start, week_end, counters, results, pending, daily, minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end,
       counters = EXCLUDED.counters,
       results  = EXCLUDED.results,
       pending  = EXCLUDED.pending,
       daily    = EXCLUDED.daily,
       minutes  = EXCLUDED.minutes,
       created_at = now()`,
    [
      userId,
      activity.range.weekStart,
      activity.range.weekEnd,
      JSON.stringify(activity.counters),
      JSON.stringify(activity.results),
      JSON.stringify(activity.pending),
      activity.daily,
      activity.minutes,
    ]
  );

  return activity;
}

module.exports = {
  RATES,
  UNCOUNTED,
  computeMinutes,
  formatDuration,
  variation,
  buildWeeklyActivity,
  getDashboardActivity,
  snapshotWeek,
};
