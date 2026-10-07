/**
 * Les déclencheurs d'ÉTAT : « cette condition est vraie depuis N jours ».
 *
 * Ce sont les quatre jobs du produit. Réactivation (lead stagnant, contact
 * inactif), upsell, churn. La veille externe est la porte d'entrée, ceux-ci
 * sont le produit.
 *
 * Ils existaient déjà dans `nurture_triggers`, dans un second système
 * d'automatisation posé à côté du modèle Déclencheur -> Workflow. Ce module
 * les rapatrie, et corrige au passage trois défauts de l'ancien évaluateur
 * (`lib/nurture-engine.evaluateTriggers`) :
 *
 *  1. Il appelle le CRM EN DIRECT à chaque passage, donc il exige un jeton
 *     valide et tire 500 contacts par évaluation.
 *  2. Il ne couvre que 4 connecteurs sur 7 (pipedrive, salesforce, hubspot,
 *     odoo), parce que chaque provider y est écrit à la main.
 *  3. Il est inutilisable là où aucun CRM n'est connecté à l'instant T.
 *
 * Ici tout est lu sur `opportunities`, déjà synchronisé, donc identique sur
 * les 7 connecteurs et évaluable sans jeton.
 *
 * DEUX RÈGLES QUI TIENNENT TOUT :
 *
 * - **Uniquement des contacts CRM** (`campaign_id IS NULL`, voir crm-scope).
 *   Un prospect froid de campagne ne doit jamais recevoir une relance écrite
 *   pour quelqu'un avec qui on a un historique.
 * - **Un état reste vrai tous les jours.** « Stagnant depuis 30 jours » le
 *   sera encore demain. C'est la politique de réinscription du workflow qui
 *   empêche de réinscrire le même contact chaque matin, pas une astuce ici.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Le catalogue. Chaque entrée porte son prédicat SQL, qui reçoit :
 *   $1 = user_id, $2 = nombre de jours
 *
 * `needs` sert à l'interface : dire QUELLE donnée manque quand un type ne peut
 * remonter personne, au lieu d'afficher un zéro sans explication.
 */
const STATE_TRIGGERS = {
  deal_won: {
    defaultDays: 1,
    needs: 'won_date',
    provides: { deal: true, owner: true },
    sql: `o.won_date IS NOT NULL
          AND o.won_date <= now() - make_interval(days => $2::int)
          AND o.won_date > now() - make_interval(days => $2::int + 7)`,
  },
  deal_stagnant: {
    defaultDays: 30,
    needs: 'last_activity_at',
    provides: { deal: true, owner: true },
    // Un deal encore ouvert, qui n'a pas bougé. On regarde d'abord la date de
    // changement d'étape et on retombe sur l'activité : tous les connecteurs
    // ne remontent pas la première.
    sql: `o.won_date IS NULL AND o.lost_date IS NULL
          AND COALESCE(o.crm_stage_changed_at, o.last_activity_at) <= now() - make_interval(days => $2::int)`,
  },
  inactive_contact: {
    defaultDays: 60,
    needs: 'last_activity_at',
    provides: { deal: false, owner: false },
    sql: `o.last_activity_at <= now() - make_interval(days => $2::int)`,
  },
  deal_lost: {
    defaultDays: 14,
    needs: 'lost_date',
    provides: { deal: true, owner: true },
    sql: `o.lost_date IS NOT NULL
          AND o.lost_date <= now() - make_interval(days => $2::int)
          AND o.lost_date > now() - make_interval(days => $2::int + 14)`,
  },
  onboarding_check: {
    defaultDays: 7,
    needs: 'won_date',
    provides: { deal: true, owner: true },
    sql: `o.won_date IS NOT NULL
          AND o.won_date <= now() - make_interval(days => $2::int)
          AND o.won_date > now() - make_interval(days => $2::int + 7)`,
  },
  renewal_reminder: {
    defaultDays: 30,
    needs: 'renewal_date',
    provides: { deal: true, owner: true },
    // Le seul qui regarde DEVANT : on veut prévenir avant l'échéance.
    sql: `o.renewal_date IS NOT NULL
          AND o.renewal_date <= now() + make_interval(days => $2::int)
          AND o.renewal_date > now()`,
  },
  churn_risk: {
    defaultDays: 0,
    needs: 'churn_flagged_at',
    provides: { deal: false, owner: false },
    // Ne s'ancre pas sur une date du CRM mais sur churn_flagged_at
    // (migration 109), le moment où le score a franchi le seuil. Les jours
    // sont un délai de courtoisie, pas une ancienneté.
    sql: `o.churn_flagged_at IS NOT NULL
          AND o.churn_flagged_at <= now() - make_interval(days => $2::int)`,
  },
  upsell_opportunity: {
    defaultDays: 90,
    needs: 'won_date',
    provides: { deal: true, owner: true },
    sql: `o.won_date IS NOT NULL
          AND o.won_date <= now() - make_interval(days => $2::int)`,
  },
  feedback_request: {
    defaultDays: 30,
    needs: 'won_date',
    provides: { deal: true, owner: true },
    sql: `o.won_date IS NOT NULL
          AND o.won_date <= now() - make_interval(days => $2::int)
          AND o.won_date > now() - make_interval(days => $2::int + 14)`,
  },
};

/**
 * Les deux types newsletter de l'ancien catalogue ne sont pas ici, et pas par
 * oubli : ils lisent l'activité d'emailing Salesforce/Fonteva, qui ne vit pas
 * dans `opportunities`. Les déclarer sans pouvoir les évaluer produirait un
 * déclencheur muet de plus.
 */
const NOT_PORTED = ['newsletter_inactive', 'newsletter_engaged'];

const STATE_KEYS = Object.keys(STATE_TRIGGERS);

function isStateKey(key) {
  return Object.prototype.hasOwnProperty.call(STATE_TRIGGERS, key);
}

function daysFor(key, conditions) {
  const d = parseInt(conditions?.days, 10);
  if (Number.isFinite(d) && d >= 0 && d <= 3650) return d;
  return STATE_TRIGGERS[key]?.defaultDays ?? 30;
}

/** Ce qu'un déclencheur d'état met à disposition des étapes. */
function contextFor(key) {
  const p = STATE_TRIGGERS[key]?.provides || {};
  return { contact: true, company: true, signal: false, deal: !!p.deal, owner: !!p.owner };
}

/**
 * Le WHERE, écrit UNE fois.
 *
 * `excludeEnrolled` retire ceux déjà engagés dans un parcours : c'est ce qui
 * rend le compte affiché dans l'interface honnête. Annoncer « 240 contacts
 * concernés » puis n'en inscrire que 3 parce que les autres sont déjà en
 * cours serait exactement le genre d'écart qu'on ne rattrape pas.
 *
 * La liste et le compte posaient la même question ; le compte la posait en
 * ramenant les lignes et en mesurant le tableau. Deux formulations d'une même
 * condition finissent toujours par se répondre différemment.
 */
function clauseDe(key, conditions, { excludeEnrolled = true } = {}) {
  const notEnrolled = excludeEnrolled
    ? `AND NOT EXISTS (
         SELECT 1 FROM sequence_enrollments e
          WHERE e.opportunity_id = o.id AND e.status IN ('draft', 'active', 'paused'))`
    : '';

  return {
    where: `o.user_id = $1
        AND o.campaign_id IS NULL
        AND o.email IS NOT NULL AND o.email <> ''
        AND (${STATE_TRIGGERS[key].sql})
        ${notEnrolled}`,
    params: [null, daysFor(key, conditions)],
  };
}

async function listMatching(userId, key, conditions, { limit = 500, excludeEnrolled = true } = {}) {
  if (!isStateKey(key)) return [];
  const { where, params } = clauseDe(key, conditions, { excludeEnrolled });
  const plafond = Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : 500;

  const r = await db.query(
    `SELECT o.id, o.name, o.company, o.email
       FROM opportunities o
      WHERE ${where}
      ORDER BY o.last_activity_at ASC NULLS LAST
      LIMIT ${plafond}`,
    [userId, params[1]]
  );
  return r.rows;
}

/**
 * Un COUNT, pas une longueur de tableau.
 *
 * Il comptait en ramenant jusqu'à 1000 lignes puis en mesurant le tableau, donc
 * il PLAFONNAIT : une base avec 5000 contacts inactifs annonçait 1000. Le
 * commentaire juste en dessous promet que ce chiffre est la meilleure protection
 * contre la déception ; un chiffre qui sature est exactement ce qui la crée.
 */
async function countMatching(userId, key, conditions) {
  if (!isStateKey(key)) return 0;
  const { where, params } = clauseDe(key, conditions);
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM opportunities o WHERE ${where}`,
    [userId, params[1]]
  );
  return r.rows[0]?.n || 0;
}

/**
 * Le catalogue tel que l'interface doit le montrer : chaque type avec le
 * nombre de contacts qu'il ferait entrer aujourd'hui.
 *
 * Ce compte est la meilleure protection contre la déception. Un type à zéro
 * n'est pas caché, il est affiché avec la donnée qui lui manque : c'est la
 * leçon des connecteurs Notion et des étapes LinkedIn, où la plomberie
 * existait et la donnée non.
 */
async function catalogWithCounts(userId) {
  const out = [];
  for (const key of STATE_KEYS) {
    const def = STATE_TRIGGERS[key];
    // UN COMPTE RATÉ N'EST PAS UN COMPTE DE ZÉRO.
    //
    // Le `catch` rendait 0, et l'écran affichait alors exactement ce qu'il
    // affiche pour « aucun contact ne correspond aujourd'hui ». Deux situations
    // opposées sous le même visage : l'une dit « cette automatisation n'a rien
    // à faire pour l'instant », l'autre dit « je n'ai pas réussi à regarder ».
    // C'est le défaut que le commentaire au-dessus de cette fonction prétend
    // justement éviter.
    //
    // `null` les sépare, et l'écran le dit au lieu d'inventer un chiffre.
    let matching = null;
    let countFailed = false;
    try {
      matching = await countMatching(userId, key, { days: def.defaultDays });
    } catch (err) {
      countFailed = true;
      logger.warn('automation', `Comptage de ${key} impossible : ${err.message}`);
    }
    out.push({
      eventKey: key,
      defaultDays: def.defaultDays,
      needs: def.needs,
      matching,
      countFailed,
      context: contextFor(key),
    });
  }
  return out;
}

module.exports = {
  STATE_TRIGGERS,
  STATE_KEYS,
  NOT_PORTED,
  isStateKey,
  daysFor,
  contextFor,
  listMatching,
  countMatching,
  catalogWithCounts,
};
