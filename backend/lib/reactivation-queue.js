/**
 * Reactivation Queue · shared, AI-free detection for both "Deals à relancer" and
 * "Clients à upseller" list pages, plus the "Reporter" (postpone) action shared by both.
 *
 * No Claude calls here · only cheap CRM-data queries. AI generation happens on-demand,
 * per single item, in lib/agents/deal-coach.js's coachAndDraftOne / lib/agents/
 * upsell-detector.js's draftOne, triggered only when the user opens a single candidate.
 */

const db = require('../db');
const upsellDetector = require('./agents/upsell-detector');

const DAY_MS = 86400000;
const { getStagnantDays } = require('./stagnation');
const logger = require('./logger');

// `last_activity_at` (populated from real CRM changes) is the trustworthy staleness signal · 
// `updated_at` gets reset to now() by a DB trigger on every internal write (churn scoring,
// chain executions, etc.) and can't be used to measure genuine inactivity.
function lastRealActivity(opp) {
  return opp.last_activity_at || opp.created_at;
}

function computeOverdue(opp) {
  const now = Date.now();
  if (opp.planned_followup_date) {
    const overdueDays = Math.floor((now - new Date(opp.planned_followup_date).getTime()) / DAY_MS);
    const dateStr = new Date(opp.planned_followup_date).toLocaleDateString('fr-FR');
    return {
      hasPlannedDate: true,
      overdueDays,
      overdueLabel: overdueDays > 0
        ? `En retard de ${overdueDays}j sur la date prévue du ${dateStr}`
        : `Prévu aujourd'hui (${dateStr})`,
    };
  }
  const overdueDays = Math.floor((now - new Date(lastRealActivity(opp)).getTime()) / DAY_MS);
  return {
    hasPlannedDate: false,
    overdueDays,
    overdueLabel: `Inactif depuis ${overdueDays}j`,
  };
}

// Le seuil est passé par l'appelant : il vient du réglage de l'utilisateur
// (cf. lib/stagnation.js), pas d'une constante décidée à sa place.
function isDue(opp, stagnantDays) {
  if (opp.planned_followup_date) return new Date(opp.planned_followup_date).getTime() <= Date.now();
  const daysSinceUpdate = (Date.now() - new Date(lastRealActivity(opp)).getTime()) / DAY_MS;
  return daysSinceUpdate >= stagnantDays;
}

/**
 * List active (not won/lost) deals due for reactivation · no planned date and stagnant past the
 * user's threshold, or a planned date that has passed. Rule-based only, no AI call.
 */
async function listDealsToReactivate(userId, sort = 'overdue') {
  const stagnantDays = await getStagnantDays(userId);

  // ── Les deux dates sont calculées en JS et passées en paramètre ────────────
  //
  // La requête employait `now() - ($2 || ' days')::interval`. C'est du Postgres
  // pur, et l'adaptateur SQLite des tests n'efface pas `::interval` : il ne
  // connaît que les casts scalaires. La requête échouait donc sur
  // « unrecognized token: ":" », ce qui veut dire que cette file n'a JAMAIS pu
  // s'exécuter sous le miroir, donc n'a jamais été couverte par un test.
  // Decouvert en ecrivant les tests du lot 7.
  //
  // `now()` posait le second piège, celui que lib/account-list.js documente
  // deja : traduit en `datetime('now')`, il produit « 2026-10-01 12:00:00 »
  // quand les valeurs stockées sont des ISO « 2026-10-01T12:00:00.000Z », et le
  // « T » pèse plus lourd que l'espace dans une comparaison lexicale. Des deux
  // côtés en ISO, la comparaison est juste partout.
  const seuilStagnation = new Date(Date.now() - stagnantDays * DAY_MS).toISOString();
  const maintenant = new Date().toISOString();

  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE user_id = $1 AND status NOT IN ('won', 'lost')
       -- Contacts CRM uniquement : un prospect froid de campagne n'a jamais
       -- eu d'échange à « réactiver » (cf. lib/crm-scope.js).
       AND campaign_id IS NULL
       AND (
         (planned_followup_date IS NULL AND COALESCE(last_activity_at, created_at) < $2)
         OR (planned_followup_date IS NOT NULL AND planned_followup_date <= $3)
       )`,
    [userId, seuilStagnation, maintenant]
  );

  const failedIds = await failedSendIds(userId, 'deal_reactivation', result.rows.map(o => o.id));

  // ── Une carte par SOCIETE, ses affaires listees dedans (lot 7) ──
  //
  // La file rendait un CONTACT par ligne. Une societe a trois interlocuteurs
  // dormants y apparaissait donc trois fois, et un envoi groupe faisait partir
  // trois messages au meme domaine le meme jour · le motif de spam exact que la
  // regle du lot 5 interdit.
  //
  // Arbitrage : une ligne par AFFAIRE, parce que c'est l'affaire qu'on relance
  // et c'est elle qui porte le montant, mais GROUPEES par societe avec un seul
  // envoi. Masquer les affaires derriere un total aurait cache ce qu'on va
  // relancer ; les lister a plat aurait fait partir trois emails.
  //
  // La SELECTION ne change pas : une societe entre dans la file si l'un de ses
  // contacts est du, exactement comme avant. Seule l'unite d'affichage et
  // d'action change.
  const churnParCompte = new Map();
  const affairesParCompte = new Map();
  try {
    const acc = await db.query(
      `SELECT id, churn_score FROM accounts WHERE user_id = $1 AND churn_score IS NOT NULL`,
      [userId]
    );
    for (const a of acc.rows) churnParCompte.set(a.id, a.churn_score);

    // Les affaires OUVERTES de ces comptes : ce sont elles qu'on relance. Une
    // affaire gagnee ou perdue n'a plus rien a relancer.
    const comptes = [...new Set(result.rows.map(o => o.account_id).filter(Boolean))];
    if (comptes.length > 0) {
      const trous = comptes.map((_, i) => `$${i + 2}`).join(', ');
      const aff = await db.query(
        `SELECT id, account_id, name, deal_value, currency, crm_stage,
                crm_updated_at, updated_at, last_activity_at
           FROM deals
          WHERE user_id = $1 AND account_id IN (${trous})
            AND status NOT IN ('won', 'lost')
          ORDER BY deal_value DESC NULLS LAST`,
        [userId, ...comptes]
      );
      for (const d of aff.rows) {
        if (!affairesParCompte.has(d.account_id)) affairesParCompte.set(d.account_id, []);
        affairesParCompte.get(d.account_id).push(d);
      }
    }
  } catch (err) {
    // Environnement en retard de migration : la file retombe sur le contact,
    // ce qui est le comportement d'avant le lot 7 plutot qu'une page vide.
    logger.warn('reactivation-queue', `Affaires par compte indisponibles pour ${userId}: ${err.message}`);
  }

  // Regroupement. Un contact sans societe rattachee reste son propre groupe :
  // `account_id` NULL veut dire « societe inconnue », pas « meme societe », et
  // les fusionner n'en garderait qu'un pour tout le reste de la base.
  const groupes = new Map();
  for (const o of result.rows) {
    const cle = o.account_id ? `compte:${o.account_id}` : `personne:${o.id}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(o);
  }

  const jours = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY_MS) : null;

  const candidates = [...groupes.values()].map(membres => {
    // La cible de l'envoi : le principal d'abord, puis le plus recemment actif,
    // et jamais une adresse qui a definitivement rebondi.
    const joignables = membres.filter(m => m.email && !m.email_bounced_at);
    const cible = joignables.find(m => m.is_primary_contact)
      || joignables.sort((a, b) =>
           new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0))[0]
      || membres.find(m => m.is_primary_contact)
      || membres[0];

    const accountId = cible.account_id || null;
    const affaires = accountId ? (affairesParCompte.get(accountId) || []) : [];

    // Le groupe est du depuis le contact le PLUS en retard : c'est lui qui a
    // fait entrer la societe dans la file.
    const overdue = membres
      .map(computeOverdue)
      .sort((a, b) => b.overdueDays - a.overdueDays)[0];

    const churnCompte = accountId ? churnParCompte.get(accountId) : undefined;

    // Montant : la somme des affaires ouvertes de la societe quand on les
    // connait, sinon la ligne du contact. Deux affaires sur une personne ne
    // tiennent pas sur sa ligne, c'est tout l'objet de la bascule.
    const montantAffaires = affaires.reduce((s, d) => s + Number(d.deal_value || 0), 0);
    const montantContacts = membres.reduce((s, m) => s + Number(m.deal_value || 0), 0);

    return {
      // Sujet des actions : une personne, parce qu'on ecrit a une personne. Le
      // contrat de /reactivation/:opportunityId/draft est donc inchange.
      id: cible.id,
      accountId,
      name: cible.name,
      company: cible.company,
      title: cible.title,
      email: joignables.length > 0 ? cible.email : null,
      status: cible.status,
      dealValue: affaires.length > 0 ? montantAffaires : montantContacts,
      // Les AFFAIRES a relancer, listees dans la carte. Vide quand la societe
      // n'est pas rattachee ou que `deals` n'a rien : l'ecran n'affiche alors
      // rien de plus, au lieu d'un cadre vide.
      deals: affaires.map(d => ({
        id: d.id,
        name: d.name,
        value: d.deal_value,
        currency: d.currency,
        stage: d.crm_stage,
        stalledDays: jours(d.crm_updated_at || d.last_activity_at || d.updated_at),
      })),
      contactsCount: membres.length,
      // L'ecran doit pouvoir dire POURQUOI rien ne partira.
      injoignable: joignables.length === 0,
      churnScore: churnCompte != null ? churnCompte : cible.churn_score,
      // D'ou vient le chiffre affiche. Sans cette distinction, impossible de
      // savoir a l'ecran si on lit la sante d'une societe ou celle d'un contact.
      churnScope: churnCompte != null ? 'account' : 'contact',
      ...overdue,
      reason: overdue.overdueLabel,
      hasFailedSend: membres.some(m => failedIds.has(m.id)),
    };
  });

  candidates.sort((a, b) => sort === 'value'
    ? (b.dealValue || 0) - (a.dealValue || 0)
    : b.overdueDays - a.overdueDays);

  return candidates;
}

/**
 * List won clients eligible for upsell (score-based, from upsell-detector.js's rule-based
 * scoring · no AI), gated by the same planned_followup_date rule as deal reactivation.
 */
async function listClientsToUpsell(userId, sort = 'score') {
  const stagnantDays = await getStagnantDays(userId);
  const { opportunities: scored } = await upsellDetector.run(userId);
  if (scored.length === 0) return [];

  const ids = scored.map(o => o.contactId);
  const oppResult = await db.query(
    `SELECT id, planned_followup_date, last_activity_at, created_at, deal_value FROM opportunities WHERE id = ANY($1)`,
    [ids]
  );
  const oppById = new Map(oppResult.rows.map(o => [o.id, o]));

  const dueIds = scored.map(c => c.contactId).filter(id => oppById.has(id) && isDue(oppById.get(id), stagnantDays));
  const failedIds = await failedSendIds(userId, 'auto_upsell', dueIds);

  const candidates = scored
    .map(c => {
      const opp = oppById.get(c.contactId);
      if (!opp) return null;
      if (!isDue(opp, stagnantDays)) return null; // planned_followup_date set in the future, not due yet
      const overdue = computeOverdue(opp);
      return {
        id: c.contactId,
        name: c.name,
        company: c.company,
        email: c.email,
        dealValue: opp.deal_value,
        score: c.score,
        reason: c.reasons.join(', '),
        factors: c.factors,
        ownedProducts: c.ownedProducts,
        crossSellProducts: c.crossSellProducts,
        ...overdue,
        hasFailedSend: failedIds.has(c.contactId),
      };
    })
    .filter(Boolean);

  candidates.sort((a, b) => sort === 'value'
    ? (b.dealValue || 0) - (a.dealValue || 0)
    : b.score - a.score);

  return candidates;
}

/**
 * Single write path for opportunities.planned_followup_date. Every caller
 * (Reporter manuel, réponse email analysée, autopilot, sync CRM) passe par ici
 * pour que followup_date_history garde une trace réelle (old → new, source,
 * raison) au lieu de ne connaître que la valeur courante. No-op si la date ne
 * change pas réellement (évite de bruiter l'historique).
 */
async function setPlannedFollowupDate(userId, opportunityId, newDate, { source, reason = null } = {}) {
  const current = await db.query(
    `SELECT planned_followup_date FROM opportunities WHERE id = $1 AND user_id = $2`,
    [opportunityId, userId]
  );
  if (current.rows.length === 0) return null;
  const oldDate = current.rows[0].planned_followup_date;
  const oldTime = oldDate ? new Date(oldDate).getTime() : null;
  const newTime = newDate ? new Date(newDate).getTime() : null;
  if (oldTime === newTime) return { id: opportunityId };

  const result = await db.query(
    `UPDATE opportunities SET planned_followup_date = $1, planned_followup_reason = $2 WHERE id = $3 AND user_id = $4 RETURNING id`,
    [newDate, reason, opportunityId, userId]
  );
  if (result.rows.length === 0) return null;

  await db.query(
    `INSERT INTO followup_date_history (user_id, opportunity_id, old_date, new_date, source, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, opportunityId, oldDate, newDate, source, reason]
  );

  return result.rows[0];
}

/**
 * "Reporter" · set (or clear) the planned follow-up date for a deal or upsell candidate.
 */
async function postponeOpportunity(userId, opportunityId, date) {
  return setPlannedFollowupDate(userId, opportunityId, date, { source: 'manual', reason: 'manual' });
}

/**
 * Opportunity ids (for this kind's candidate pool) whose most recent draft failed to send · 
 * surfaced as an alert badge on the queue tab, NOT in history (the mail never actually left).
 */
async function failedSendIds(userId, kind, opportunityIds) {
  if (opportunityIds.length === 0) return new Set();

  // `SELECT DISTINCT ON (...)` et `= ANY($2)` sont du Postgres pur, que le
  // miroir SQLite des tests ne connaît ni l'un ni l'autre : la requête
  // échouait sur « near "ON" », donc cette fonction n'a jamais pu s'exécuter
  // sous le miroir et le badge « envoi échoué » n'a jamais été couvert.
  //
  // La sémantique est conservée au mot près : on ne retient que le DERNIER
  // email de chaque contact, et on ne signale que s'il a échoué. Un contact
  // dont le dernier envoi a réussi après un échec n'est pas en échec.
  const trous = opportunityIds.map((_, i) => `$${i + 3}`).join(', ');
  const result = await db.query(
    `SELECT opportunity_id, status, created_at
       FROM nurture_emails
      WHERE user_id = $1 AND metadata ->> 'chain' = $2
        AND opportunity_id IN (${trous})
      ORDER BY opportunity_id, created_at DESC`,
    [userId, kind, ...opportunityIds]
  );

  const vus = new Set();
  const echoues = new Set();
  for (const r of result.rows) {
    if (vus.has(r.opportunity_id)) continue;
    vus.add(r.opportunity_id);
    if (r.status === 'failed') echoues.add(r.opportunity_id);
  }
  return echoues;
}

/**
 * History tab: everything that has happened via Baakalai for this kind's candidates ·
 * emails actually sent, follow-up date changes (old → new, with source: manual Reporter,
 * auto_email reply analysis, or crm_sync · post-send cooldown is excluded, it's covered
 * by the "sent" entry already), and deals/clients closed CRM-side (won/lost). No AI call,
 * rule-based reads only.
 */
async function getHistory(userId, kind) {
  const sentResult = await db.query(
    `SELECT ne.id, ne.opportunity_id, ne.to_name, ne.sent_at, ne.subject,
            o.title, o.company, o.account_id
     FROM nurture_emails ne
     LEFT JOIN opportunities o ON o.id = ne.opportunity_id
     WHERE ne.user_id = $1 AND ne.metadata ->> 'chain' = $2 AND ne.status = 'sent'
     ORDER BY ne.sent_at DESC LIMIT 50`,
    [userId, kind]
  );
  const sent = sentResult.rows.map(r => ({
    eventType: 'sent',
    date: r.sent_at,
    opportunityId: r.opportunity_id,
    accountId: r.account_id || null,
    name: r.to_name,
    title: r.title,
    company: r.company,
    // L'OBJET de l'email parti. « Email envoye le 12/08 » ne dit pas ce qu'on a
    // envoye · c'est la premiere chose qu'on veut savoir en relisant un
    // historique, et elle etait la, a une colonne pres.
    subject: r.subject || null,
  }));

  // Trace réelle des changements (old → new, source) plutôt qu'un instantané de
  // la valeur courante · un changement reste visible même une fois sa date
  // passée ou re-changée depuis (cf. migration 116 / setPlannedFollowupDate).
  const postponedResult = await db.query(
    `SELECT h.id, h.old_date, h.new_date, h.source, h.reason, h.changed_at,
            o.id AS opportunity_id, o.name, o.title, o.company, o.account_id
     FROM followup_date_history h
     JOIN opportunities o ON o.id = h.opportunity_id
     WHERE h.user_id = $1 AND o.status ${kind === 'auto_upsell' ? "= 'won'" : "NOT IN ('won', 'lost')"}
       AND o.campaign_id IS NULL
       AND (h.reason IS NULL OR h.reason != 'post_send_cooldown')
     ORDER BY h.changed_at DESC LIMIT 50`,
    [userId]
  );
  const postponed = postponedResult.rows.map(r => ({
    eventType: 'postponed',
    date: r.changed_at,
    opportunityId: r.opportunity_id,
    accountId: r.account_id || null,
    name: r.name,
    title: r.title,
    company: r.company,
    oldDate: r.old_date,
    newDate: r.new_date,
    source: r.source,
    isManual: r.source === 'manual',
    reason: r.reason || 'manual',
  }));

  const closedResult = await db.query(
    `SELECT id, name, title, company, status, won_date, lost_date, account_id
     FROM opportunities
     WHERE user_id = $1 AND status ${kind === 'auto_upsell' ? "= 'lost'" : "IN ('won', 'lost')"}
       AND COALESCE(won_date, lost_date) IS NOT NULL
     ORDER BY COALESCE(won_date, lost_date) DESC LIMIT 50`,
    [userId]
  );
  // ── Combien de relances sont REELLEMENT parties vers ces contacts ───────
  //
  // Un deal gagne ou perdu est un fait du CRM, pas une action de baakalai. Les
  // afficher nus dans un onglet « Historique » laissait croire qu'on avait
  // travaille ces clients et qu'on les avait perdus · mesure sur staging le
  // 2026-10-07 : 23 lignes « Perdu le... » pour ZERO email envoye sur cette
  // chaine. L'ecran racontait exactement l'inverse de ce qui s'etait passe.
  //
  // Le compte de relances tranche : « perdu apres 2 relances » et « perdu sans
  // qu'on lui ecrive une seule fois » sont deux informations opposees, et c'est
  // la seconde qui est actionnable.
  const toucheParContact = new Map();
  let comptageLisible = true;
  try {
    const touches = await db.query(
      `SELECT opportunity_id, COUNT(*) AS n
         FROM nurture_emails
        WHERE user_id = $1 AND metadata ->> 'chain' = $2 AND status = 'sent'
          AND opportunity_id IS NOT NULL
        GROUP BY opportunity_id`,
      [userId, kind]
    );
    for (const t of touches.rows) toucheParContact.set(String(t.opportunity_id), Number(t.n) || 0);
  } catch (err) {
    // Comptage illisible : on rend `null` et l'ecran se tait sur ce point,
    // plutot que d'afficher « aucune relance », qui serait peut-etre faux.
    comptageLisible = false;
    logger.warn('reactivation-queue', `Comptage des relances impossible : ${err.message}`);
  }

  const closed = closedResult.rows.map(r => ({
    eventType: 'closed',
    date: r.won_date || r.lost_date,
    opportunityId: r.id,
    accountId: r.account_id || null,
    name: r.name,
    title: r.title,
    company: r.company,
    status: r.status,
    // `null` quand on n'a pas su compter · distinct de 0, qui AFFIRME qu'on
    // n'a rien envoye. L'ecran doit pouvoir se taire plutot que de mentir.
    touchCount: comptageLisible ? (toucheParContact.get(String(r.id)) || 0) : null,
  }));

  return [...sent, ...postponed, ...closed]
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = { listDealsToReactivate, listClientsToUpsell, postponeOpportunity, setPlannedFollowupDate, failedSendIds, getHistory, computeOverdue };
