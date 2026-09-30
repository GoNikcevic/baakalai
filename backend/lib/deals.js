/**
 * Les AFFAIRES · lot 4 du plan docs/plan-modele-comptes-et-decouverte-crm.md,
 * table `deals` (migration 126).
 *
 * ── Ce que ce module change, en une phrase ──────────────────────────────────
 *
 * Un deal n'a plus besoin d'un contact pour exister.
 *
 * Jusqu'ici, lib/deal-lifecycle-sync.js commençait par `if (!personId)
 * continue` : une affaire dont le CRM ne nomme pas l'interlocuteur n'était ni
 * enregistrée, ni comptée dans le chiffre d'affaires, ni visible nulle part.
 * Elle n'existait pas. Mesuré chez un beta testeur : 308 Opportunity
 * Salesforce sur 308, toutes rattachées à un compte parfaitement renseigné.
 *
 * Et une ligne d'`opportunities` ne portant qu'un seul `crm_deal_id`, deux
 * affaires visant la même personne ne tenaient pas non plus : la plus
 * récemment modifiée réclamait la ligne, les autres étaient comptées en
 * collisions et perdues. Ici, chacune a sa ligne.
 *
 * ── Double écriture ─────────────────────────────────────────────────────────
 *
 * PERSONNE ne lit encore cette table. Les colonnes de deal restent sur
 * `opportunities` et gardent l'autorité pour tous les lecteurs jusqu'au lot 5.
 * Ce module écrit à côté, en parallèle · si son résultat diverge de ce que
 * voient les écrans, c'est `opportunities` qui a raison pour l'instant. C'est
 * la méthode imposée par le plan (§5), et c'est ce qui rend le lot 4 rejouable
 * sans redéploiement inverse.
 *
 * Corollaire assumé : rien de ce qui est écrit ici n'est encore vérifié par
 * l'usage. Le premier lecteur, au lot 5, devra comparer les deux avant de
 * basculer.
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Une date que Postgres acceptera, ou NULL.
 *
 * Les quatre CRM ne s'accordent pas sur le format, et une seule chaîne
 * illisible ferait échouer l'INSERT entier, donc perdre l'affaire · exactement
 * ce que ce lot est censé arrêter de faire. Filtrer vaut mieux que laisser
 * passer et compter sur la base.
 */
function safeDateISO(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Ce que le CRM affirme sur le rattachement d'une affaire. */
const ATTRIBUTION = {
  CRM: 'crm_role',   // le CRM nomme lui-même le contact
  INFERRED: 'inferred', // baakalai l'a deviné (migration 123)
  ACCOUNT: 'account', // rattachée à sa seule société, et c'est dit franchement
};

/**
 * Les comptes de cet utilisateur indexés par identifiant CRM natif.
 * Une lecture par synchro, pas une par deal.
 */
async function loadAccountsByCrmId(userId, provider) {
  const parCrmId = new Map();
  try {
    const rows = await db.query(
      `SELECT id, crm_account_id, name FROM accounts
        WHERE user_id = $1 AND crm_provider = $2 AND crm_account_id IS NOT NULL`,
      [userId, provider]
    );
    for (const a of rows.rows) parCrmId.set(String(a.crm_account_id), a);
  } catch { /* pas encore de comptes : les deals se rattacheront par le contact */ }
  return parCrmId;
}

/**
 * Écrit (ou met à jour) UNE affaire.
 *
 * @param {string} userId
 * @param {string} provider
 * @param {object} deal · forme normalisée commune aux quatre connecteurs
 * @param {object} ctx
 * @param {Map} ctx.accountsByCrmId · sortie de loadAccountsByCrmId
 * @param {object|null} ctx.contact · la ligne d'opportunities correspondante, si trouvée
 * @param {string|null} ctx.attribution · comment le contact a été rattaché
 * @returns {Promise<string|null>} l'id du deal, ou null si rien n'a pu être écrit
 */
async function upsertDeal(userId, provider, deal, ctx = {}) {
  const crmDealId = deal.id != null ? String(deal.id) : null;
  // Sans identifiant natif il n'y a pas de clé d'unicité, donc chaque synchro
  // créerait un doublon. Mieux vaut ne rien écrire que remplir la table de
  // copies : le compteur `sansId` le dit à l'appelant.
  if (!crmDealId) return null;

  const compte = deal.accountId
    ? (ctx.accountsByCrmId?.get(String(deal.accountId)) || null)
    : null;

  // Le compte de l'affaire d'abord, celui du contact en secours. L'ordre est
  // l'inverse de ce que faisait le produit : c'est le deal qui sait à quelle
  // société il appartient, le contact ne fait que l'habiter.
  const accountId = compte?.id || ctx.contact?.account_id || null;

  // 'account' n'est pas un aveu d'échec : une affaire rattachée à sa société et
  // à personne d'autre est correctement décrite. C'est la déduction silencieuse
  // qui était fausse, pas l'absence de contact.
  const attribution = ctx.attribution || (ctx.contact ? ATTRIBUTION.CRM : ATTRIBUTION.ACCOUNT);

  // Aucun connecteur ne renvoie de won_date ni de lost_date : ils renvoient un
  // statut natif et une date de clôture. La date de clôture du CRM vaut
  // toujours mieux que « maintenant », qui n'est un substitut honnête que pour
  // une transition survenue pendant CETTE synchro, jamais pour reconstituer une
  // affaire close l'an dernier. Même règle que deal-lifecycle-sync.js.
  const dateCloture = safeDateISO(deal.closeDate);
  const maintenant = new Date().toISOString();
  const wonDate = deal.status === 'won' ? (dateCloture || maintenant) : null;
  const lostDate = deal.status === 'lost' ? (dateCloture || maintenant) : null;
  // La « prochaine activité » native du CRM · elle porte sur l'AFFAIRE, donc
  // sa raison est 'crm_sync'. La moitié qui porte sur la personne
  // (post_send_cooldown, reply_requested_date) reste sur le contact, dans
  // opportunities.cooldown_until (plan §9.4).
  const relance = safeDateISO(deal.nextActivityDate);

  const values = [
    userId,
    provider,
    crmDealId,
    accountId,
    ctx.contact?.id || null,
    deal.name || null,
    deal.status || 'open',
    deal.value ?? null,
    // Jamais de repli sur 'EUR' · un montant dont on ignore la devise doit se
    // lire comme tel, sinon il entre dans une somme qui ment (plan §9.5).
    deal.currency || null,
    wonDate,
    lostDate,
    deal.lostReason || null,
    deal.lostReason ? 'crm' : null,
    dateCloture,
    deal.stage != null ? String(deal.stage) : null,
    deal.stageId != null ? String(deal.stageId) : null,
    deal.pipelineId != null ? String(deal.pipelineId) : null,
    deal.pipelineName || null,
    safeDateISO(deal.createdAt),
    safeDateISO(deal.updatedAt),
    safeDateISO(deal.lastActivityAt) || safeDateISO(deal.updatedAt),
    relance,
    relance ? 'crm_sync' : null,
    deal.ownerId != null ? String(deal.ownerId) : null,
    ctx.ownerEmail || null,
    ctx.ownerUserId || null,
    attribution,
  ];

  const res = await db.query(
    `INSERT INTO deals
       (user_id, crm_provider, crm_deal_id, account_id, primary_contact_id,
        name, status, deal_value, currency,
        won_date, lost_date, lost_reason, lost_reason_source, close_date,
        crm_stage, crm_stage_id, crm_pipeline_id, crm_pipeline_name,
        crm_created_at, crm_updated_at, last_activity_at,
        planned_followup_date, planned_followup_reason,
        crm_owner_id, owner_email, owner_id, crm_deal_attribution)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     ON CONFLICT (user_id, crm_provider, crm_deal_id) WHERE crm_deal_id IS NOT NULL
     DO UPDATE SET
       account_id = COALESCE(EXCLUDED.account_id, deals.account_id),
       primary_contact_id = COALESCE(EXCLUDED.primary_contact_id, deals.primary_contact_id),
       name = COALESCE(EXCLUDED.name, deals.name),
       -- Le dénouement vient TOUJOURS du CRM, même à rebours : une affaire
       -- que le commercial a rouverte à la main doit cesser d'être un client.
       status = EXCLUDED.status,
       deal_value = COALESCE(EXCLUDED.deal_value, deals.deal_value),
       currency = COALESCE(EXCLUDED.currency, deals.currency),
       won_date = COALESCE(EXCLUDED.won_date, deals.won_date),
       lost_date = COALESCE(EXCLUDED.lost_date, deals.lost_date),
       -- Une raison de perte déjà connue ne se fait pas écraser : elle peut
       -- avoir été saisie à la main, et une resynchro n'a pas à corriger un
       -- humain.
       lost_reason = COALESCE(deals.lost_reason, EXCLUDED.lost_reason),
       lost_reason_source = COALESCE(deals.lost_reason_source, EXCLUDED.lost_reason_source),
       close_date = COALESCE(EXCLUDED.close_date, deals.close_date),
       crm_stage = COALESCE(EXCLUDED.crm_stage, deals.crm_stage),
       crm_stage_id = COALESCE(EXCLUDED.crm_stage_id, deals.crm_stage_id),
       -- L'horodatage du changement d'étape ne bouge que si l'étape bouge ·
       -- sinon toute resynchro ferait passer une affaire figée depuis six mois
       -- pour une affaire qui vient d'avancer, et la stagnation deviendrait
       -- indétectable. Une étape absente de la lecture n'est PAS un changement :
       -- le connecteur qui ne renvoie rien ne dit pas que l'étape a disparu.
       -- Et à la première insertion la colonne reste NULL · observer une étape
       -- pour la première fois n'est pas la voir changer.
       crm_stage_changed_at = CASE
         WHEN EXCLUDED.crm_stage_id IS NOT NULL
           AND COALESCE(deals.crm_stage_id, '') <> EXCLUDED.crm_stage_id THEN now()
         WHEN EXCLUDED.crm_stage IS NOT NULL
           AND COALESCE(deals.crm_stage, '') <> EXCLUDED.crm_stage THEN now()
         ELSE deals.crm_stage_changed_at END,
       crm_pipeline_id = COALESCE(EXCLUDED.crm_pipeline_id, deals.crm_pipeline_id),
       crm_pipeline_name = COALESCE(EXCLUDED.crm_pipeline_name, deals.crm_pipeline_name),
       crm_created_at = COALESCE(EXCLUDED.crm_created_at, deals.crm_created_at),
       crm_updated_at = COALESCE(EXCLUDED.crm_updated_at, deals.crm_updated_at),
       -- La récence n'avance JAMAIS à reculons · une lecture partielle du CRM
       -- ne doit pas faire rajeunir une affaire (même règle que sur le contact).
       -- Écrit en CASE et non en GREATEST : le miroir sqlite des tests ne
       -- connaît pas GREATEST, et l'adaptateur ne le traduit pas.
       last_activity_at = CASE
         WHEN deals.last_activity_at IS NULL THEN EXCLUDED.last_activity_at
         WHEN EXCLUDED.last_activity_at IS NULL THEN deals.last_activity_at
         WHEN EXCLUDED.last_activity_at > deals.last_activity_at THEN EXCLUDED.last_activity_at
         ELSE deals.last_activity_at END,
       planned_followup_date = COALESCE(EXCLUDED.planned_followup_date, deals.planned_followup_date),
       planned_followup_reason = COALESCE(EXCLUDED.planned_followup_reason, deals.planned_followup_reason),
       crm_owner_id = COALESCE(EXCLUDED.crm_owner_id, deals.crm_owner_id),
       owner_email = COALESCE(EXCLUDED.owner_email, deals.owner_email),
       owner_id = COALESCE(EXCLUDED.owner_id, deals.owner_id),
       -- Un rattachement confirmé par un humain ne redescend jamais à une
       -- déduction, même règle que sur opportunities.crm_deal_attribution.
       crm_deal_attribution = CASE
         WHEN deals.crm_deal_attribution = 'user' THEN deals.crm_deal_attribution
         ELSE EXCLUDED.crm_deal_attribution END,
       updated_at = now()
     RETURNING id`,
    values
  );
  return res.rows[0]?.id || null;
}

/**
 * Écrit toutes les affaires d'une synchro.
 *
 * Aucune n'est écartée : celles que le CRM ne rattache à personne entrent avec
 * `primary_contact_id` à NULL et l'attribution 'account'. C'est tout l'objet du
 * lot 4.
 *
 * @param {Array} rattachements · [{ deal, contact, attribution }] tels que la
 *   synchro de cycle de vie les a résolus. `contact` vaut null quand le CRM ne
 *   nomme personne ou quand la personne nommée n'est pas dans nos contacts.
 * @returns {Promise<{ecrits, sansId, sansContact, erreur}>}
 */
async function writeDeals(userId, provider, rattachements) {
  const out = { ecrits: 0, sansId: 0, sansContact: 0, erreur: null, parId: new Map() };
  try {
    const accountsByCrmId = await loadAccountsByCrmId(userId, provider);
    for (const r of rattachements) {
      try {
        const id = await upsertDeal(userId, provider, r.deal, {
          accountsByCrmId,
          contact: r.contact || null,
          attribution: r.attribution || null,
          ownerEmail: r.ownerEmail || null,
          ownerUserId: r.ownerUserId || null,
        });
        if (!id) { out.sansId++; continue; }
        out.ecrits++;
        if (!r.contact) out.sansContact++;
        out.parId.set(String(r.deal.id), id);
      } catch (err) {
        // Une affaire qui refuse d'entrer ne doit pas emporter les autres · la
        // synchro est best-effort de bout en bout.
        out.erreur = out.erreur || err.message;
        logger.warn('deals', `affaire ${r.deal?.id} non écrite pour ${userId} : ${err.message}`);
      }
    }
    logger.info('deals',
      `${provider} · ${out.ecrits} affaire(s) enregistrée(s), dont ${out.sansContact} sans interlocuteur nommé` +
      (out.sansId > 0 ? `, ${out.sansId} sans identifiant CRM` : ''));
  } catch (err) {
    out.erreur = err.message;
    logger.warn('deals', `écriture des affaires ${provider} échouée pour ${userId} : ${err.message}`);
  }
  return out;
}

module.exports = { ATTRIBUTION, loadAccountsByCrmId, upsertDeal, writeDeals };
