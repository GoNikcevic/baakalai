/**
 * Les AFFAIRES, lues depuis `deals` (migration 126). Point de passage unique de
 * la bascule des lecteurs annoncée par le lot 4 et due au lot 5.
 *
 * ── Pourquoi un module et pas 101 réécritures ────────────────────────────────
 *
 * Mesuré le 2026-10-01 : les colonnes d'affaire de `opportunities` sont encore
 * lues à 101 endroits dans 19 fichiers, dont 36 dans le seul routes/analytics.js.
 * Les réécrire un par un, c'est exactement le big bang que le plan interdit
 * (§5, lot 4). Tout passe donc par ici, et les appelants migrent au rythme où on
 * peut les vérifier.
 *
 * ── Ce que la bascule rapporte, mesuré et pas suppose ────────────────────────
 *
 * Sur la base de staging, au même instant :
 *
 *   opportunities · 109 affaires avec montant · 2 644 400 €
 *   deals         · 121 affaires avec montant · 3 008 000 €
 *
 * Soit 12 affaires et 363 600 € invisibles, 13,8 % du pipeline. La cause est
 * structurelle et connue : `opportunities` porte UNE ligne par contact, avec un
 * seul montant et une seule étape. Deux affaires sur la même personne n'y
 * tiennent pas, la plus récemment modifiée réclame la ligne et les autres sont
 * comptées puis jetées (`collisions` dans lib/deal-lifecycle-sync.js).
 *
 * ── Le repli, et pourquoi il n'est pas optionnel ─────────────────────────────
 *
 * Un utilisateur dont la table `deals` est vide (synchro jamais passée depuis le
 * lot 4, environnement en retard de migration) verrait ses montants tomber à
 * ZÉRO si on basculait sans repli. Un chiffre qui disparaît est pire qu'un
 * chiffre incomplet : l'un se remarque et fait perdre confiance, l'autre se
 * corrige. On lit donc `deals` quand il y a quelque chose à y lire, et
 * `opportunities` sinon, en DISANT lequel des deux a répondu.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Cet utilisateur a-t-il des affaires dans `deals` ?
 *
 * Ce n'est pas une question de schéma mais de PEUPLEMENT : la table peut exister
 * et être vide pour ce tenant. C'est elle qui décide du repli.
 */
async function hasDeals(userId) {
  try {
    const { rows } = await db.query(
      'SELECT EXISTS(SELECT 1 FROM deals WHERE user_id = $1) AS present',
      [userId]
    );
    // Postgres rend un booleen, SQLite rend 0 ou 1. Comparer strictement a
    // `true` renvoyait donc TOUJOURS false sous le miroir, et tous les lecteurs
    // basculaient en repli sans que rien ne le signale : la bascule aurait
    // paru fonctionner en test tout en ne testant jamais le bon chemin.
    return Boolean(rows[0]?.present);
  } catch (err) {
    // Table absente : environnement antérieur au lot 4.
    logger.warn('deal-reads', `Table deals illisible pour ${userId}: ${err.message}`);
    return false;
  }
}

/**
 * Restriction de périmètre, écrite de façon PORTABLE.
 *
 * Le code existant écrit `($2::uuid[] IS NULL OR id = ANY($2))`. C'est du
 * Postgres pur : le miroir SQLite efface le cast `::uuid` mais laisse les
 * crochets, et ne connaît pas `ANY`. La requête échoue donc, et c'est pour ça
 * que ces agrégats n'avaient jamais été couverts par un test. Comme il s'agit
 * ici de chiffres d'ARGENT, je préfère un SQL vérifiable à un SQL élégant.
 *
 * Les identifiants sont passés en paramètres, jamais concaténés.
 */
function perimetre(colonne, ids, params) {
  if (!ids || ids.length === 0) return '';
  // `params.push` renvoie la nouvelle longueur, qui est exactement le numero du
  // placeholder correspondant. Les valeurs restent des parametres.
  const trous = ids.map(id => `$${params.push(id)}`);
  return ` AND ${colonne} IN (${trous.join(', ')})`;
}

/** Colonnes d'agrégat communes aux deux sources. `now() - interval` est traduit
 *  par le miroir SQLite, `FILTER` est supporté depuis SQLite 3.30. */
const AGREGATS = `
  COUNT(*) FILTER (WHERE status NOT IN ('won','lost') AND deal_value > 0)::int AS open_deals,
  COALESCE(SUM(deal_value) FILTER (WHERE status NOT IN ('won','lost')), 0)::float AS open_value,
  COUNT(*) FILTER (WHERE status = 'won' AND won_date > now() - interval '365 days')::int AS won_365d,
  COUNT(*) FILTER (WHERE status = 'lost' AND lost_date > now() - interval '365 days')::int AS lost_365d,
  COUNT(*) FILTER (WHERE status = 'won' AND won_date > now() - interval '90 days')::int AS won_90d,
  COUNT(*) FILTER (WHERE status = 'lost' AND lost_date > now() - interval '90 days')::int AS lost_90d,
  COUNT(*) FILTER (WHERE reactivated_at IS NOT NULL)::int AS deals_reactivated,
  COUNT(*) FILTER (WHERE last_activity_at < now() - interval '30 days'
    AND status NOT IN ('won','lost') AND deal_value > 0)::int AS open_deals_quiet_30d`;

/**
 * Cycle de vente moyen, en jours révolus.
 *
 * Calculé en JavaScript et non en SQL, pour deux raisons. `EXTRACT(EPOCH FROM)`
 * est du Postgres que le miroir ne traduit pas, et surtout la date de référence
 * demande un arbitrage qui se lit mieux en code : c'est la date de création CÔTÉ
 * CRM, et seulement à défaut la nôtre. Mesurer sur notre date d'insertion
 * faisait grandir le cycle d'un jour par jour (bug corrigé le 30/09).
 *
 * Renvoie null si aucune affaire gagnée n'est mesurable : inconnu ne vaut pas
 * zéro, et un zéro ferait lire « on gagne le jour même ».
 */
async function cycleMoyen(table, userId, ids) {
  const params = [userId];
  const filtre = perimetre(table === 'deals' ? 'primary_contact_id' : 'id', ids, params);
  const { rows } = await db.query(
    `SELECT won_date, crm_created_at, created_at FROM ${table}
      WHERE user_id = $1 AND status = 'won' AND won_date IS NOT NULL${filtre}`,
    params
  );
  const jours = [];
  for (const r of rows) {
    const depart = new Date(r.crm_created_at || r.created_at).getTime();
    const fin = new Date(r.won_date).getTime();
    if (isNaN(depart) || isNaN(fin) || fin <= depart) continue;
    jours.push((fin - depart) / 86400000);
  }
  if (jours.length === 0) return null;
  return Math.round(jours.reduce((a, b) => a + b, 0) / jours.length);
}

/**
 * Agrégats d'affaires : volume ouvert, dénouements, cycle de vente.
 *
 * `contactIds` restreint le périmètre à des CONTACTS, parce que c'est ainsi que
 * les appelants raisonnent aujourd'hui (filtres de l'assistant analytique). Une
 * affaire entre dans le périmètre si son interlocuteur y est. Conséquence à
 * tenir : une affaire rattachée à son seul compte, sans contact nommé, sort d'un
 * périmètre filtré. C'est volontaire, le filtre porte sur des personnes.
 *
 * @returns {Promise<{source: 'deals'|'opportunities', ...agregats}>}
 */
async function dealTotals(userId, { contactIds = null } = {}) {
  const surDeals = await hasDeals(userId);
  const table = surDeals ? 'deals' : 'opportunities';
  const colonne = surDeals ? 'primary_contact_id' : 'id';

  const params = [userId];
  const filtre = perimetre(colonne, contactIds, params);

  const { rows } = await db.query(
    `SELECT ${AGREGATS}
       FROM ${table} WHERE user_id = $1${filtre}`,
    params
  );

  return {
    source: table,
    ...rows[0],
    avg_cycle_days: await cycleMoyen(table, userId, contactIds),
  };
}

/**
 * Le pipeline ouvert par étape CRM.
 *
 * Lu sur `deals`, l'étape retrouve son sens : elle qualifie une AFFAIRE. Portée
 * par un contact, elle ne pouvait décrire qu'une affaire sur N, et un contact à
 * deux affaires dans deux étapes différentes n'apparaissait que dans une seule.
 */
/**
 * Le pipeline ouvert par étape.
 *
 * Il y a eu ici, le temps d'une journée, un garde-fou qui ne lisait les étapes
 * sur `deals` que lorsqu'elles différaient de `crm_stage_id`. Motif : la table
 * contenait « 1 », « 2 », « 3 » au lieu de « Qualified », parce que
 * api/pipedrive.js normalise `stage: d.stage_id` et que lib/deals.js recopiait
 * cette valeur dans une colonne de libellé.
 *
 * Le garde-fou est RETIRÉ, et pour deux raisons. La cause est corrigée à la
 * source : `upsertDeal` passe maintenant par `extractStage()`, le même résolveur
 * que le contact. Et surtout l'heuristique était fausse chez Salesforce, où
 * `StageName` est à la fois le libellé et l'identifiant : le garde-fou aurait
 * conclu « ce ne sont pas des libellés » et serait retombé sur le contact pour
 * le seul provider qui n'a jamais eu le problème.
 */
async function openDealsByStage(userId, { contactIds = null, limit = 15 } = {}) {
  const surDeals = await hasDeals(userId);
  const table = surDeals ? 'deals' : 'opportunities';
  const colonne = surDeals ? 'primary_contact_id' : 'id';

  const params = [userId];
  const filtre = perimetre(colonne, contactIds, params);
  const trouLimite = `$${params.push(limit)}`;

  const { rows } = await db.query(
    `SELECT crm_stage AS stage, COUNT(*)::int AS count,
            COALESCE(SUM(deal_value), 0)::float AS value
       FROM ${table}
      WHERE user_id = $1 AND crm_stage IS NOT NULL AND status NOT IN ('won','lost')${filtre}
      GROUP BY crm_stage ORDER BY count DESC LIMIT ${trouLimite}`,
    params
  );
  return { source: table, stages: rows };
}

module.exports = { hasDeals, dealTotals, openDealsByStage };
