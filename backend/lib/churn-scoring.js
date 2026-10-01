/**
 * Churn Prediction Scoring Engine
 *
 * Calculates a churn risk score (0-100) for each contact/opportunity
 * based on multiple weighted signals from CRM data.
 *
 * Score bands:
 *   0-25  = Low risk (green)
 *   26-50 = Medium risk (yellow)
 *   51-75 = High risk (orange)
 *   76-100 = Critical (red)
 *
 * Sector weights (sector_churn_weights) are static/hand-tuned for now. Recalibrating them
 * from real churn_outcomes feedback is future work · intended to reuse the memory_patterns
 * cross-user learning pattern (memory_patterns.sectors) via the existing Sunday Memory Agent,
 * not a separate learning system. This phase only wires up the data collection.
 */

const db = require('../db');
const logger = require('./logger');
const { getSectorMultiplier } = require('./sector-classifier');

const DAY_MS = 86400000;

// Seuil unique « client à risque » · utilisé par le badge de nav, la liste
// « À traiter aujourd'hui » et le compteur atRisk. Le scan de signaux externes
// (churn-external-signals.js) reste volontairement plus large (>= 50) : on
// surveille dès le risque moyen, on n'alerte qu'à partir d'ici.
const AT_RISK_THRESHOLD = 60;

/**
 * Score a single opportunity for churn risk.
 * `ownSectorMultiplier`/`clientSectorMultiplier` are pre-resolved by scoreAllForUser
 * (via lib/sector-classifier) so this function stays synchronous.
 * `upsellEmails` is the subset of nurture_emails from the auto_upsell chain for this contact.
 * `externalSignals` is this opportunity's rows from churn_external_signals (last 30d).
 * Returns { score, factors[] }
 */
function scoreOpportunity(opp, {
  deals = [], activities = [], emails = [],
  ownSectorMultiplier = 1.0, clientSectorMultiplier = 1.0, clientSectorLabel = null,
  upsellEmails = [], externalSignals = [], registrySignals = [],
} = {}) {
  const now = Date.now();
  const factors = [];
  let score = 0;

  // ── 1. Inactivity (max 30 pts) ──
  // `updated_at` est réécrit à chaque synchro CRM : s'en servir ici rendait le
  // critère d'inactivité · 30 points sur 100, le plus lourd · impossible à
  // déclencher. Mesuré avant correction : 286 scores à 0, aucun au-dessus de 40.
  // `last_activity_at` porte la date réelle côté CRM (lib/crm-activity-date.js).
  const lastActivity = opp.last_activity_at || opp.created_at;
  const daysSinceActivity = lastActivity ? (now - new Date(lastActivity).getTime()) / DAY_MS : 999;

  if (daysSinceActivity >= 120) {
    score += 30;
    factors.push({ signal: 'inactivity', weight: 30, detail: `${Math.round(daysSinceActivity)}d sans activité` });
  } else if (daysSinceActivity >= 90) {
    score += 25;
    factors.push({ signal: 'inactivity', weight: 25, detail: `${Math.round(daysSinceActivity)}d sans activité` });
  } else if (daysSinceActivity >= 60) {
    score += 18;
    factors.push({ signal: 'inactivity', weight: 18, detail: `${Math.round(daysSinceActivity)}d sans activité` });
  } else if (daysSinceActivity >= 30) {
    score += 10;
    factors.push({ signal: 'inactivity', weight: 10, detail: `${Math.round(daysSinceActivity)}d sans activité` });
  }

  // ── 2. Deal stagnation (max 25 pts) ──
  // `deals` ne vient que des APIs Pipedrive/Salesforce. Pour les 5 autres
  // providers il est toujours vide, ce qui plafonnait mécaniquement le score
  // à 45/100 (mesuré : max=45 sur 373 opps Notion). Fallback : l'opportunité
  // elle-même est le deal · un statut 'open' qui vieillit sans conclusion
  // est le même signal, quel que soit le CRM.
  const oppDeals = deals.filter(d =>
    d.person_id === opp.crm_contact_id || d.personId === opp.crm_contact_id
  );
  const openDeals = oppDeals.filter(d => d.status === 'open');

  // Ce repli ne vaut QUE pour un contact. Au niveau compte, `created_at` est la
  // date à laquelle la société est entrée dans le CRM, pas l'âge d'une affaire :
  // l'appliquer donnait « Deal ouvert depuis 400d » à tout compte un peu ancien
  // sans affaire, soit +25 points permanents et indifférenciés. Et le repli n'a
  // plus de raison d'être ici : depuis la migration 128, un provider sans objet
  // affaire reçoit des affaires dérivées. Un compte à zéro affaire n'en a
  // réellement aucune en cours.
  if (!opp.isAccount && oppDeals.length === 0 && opp.status === 'open' && opp.created_at) {
    const dealAge = (now - new Date(opp.created_at).getTime()) / DAY_MS;
    if (dealAge >= 90) {
      score += 25;
      factors.push({ signal: 'deal_stagnant', weight: 25, detail: `Deal ouvert depuis ${Math.round(dealAge)}d sans conclusion` });
    } else if (dealAge >= 60) {
      score += 18;
      factors.push({ signal: 'deal_stagnant', weight: 18, detail: `Deal ouvert depuis ${Math.round(dealAge)}d` });
    } else if (dealAge >= 30) {
      score += 10;
      factors.push({ signal: 'deal_stagnant', weight: 10, detail: `Deal ouvert depuis ${Math.round(dealAge)}d` });
    }
  }

  if (openDeals.length > 0) {
    const stalestDeal = openDeals.reduce((oldest, d) => {
      const dateStr = d.updatedAt || d.update_time || d.created_at;
      const age = dateStr ? (now - new Date(dateStr).getTime()) / DAY_MS : 0;
      return (age > oldest.age && !isNaN(age)) ? { deal: d, age } : oldest;
    }, { deal: null, age: 0 });

    if (stalestDeal.age >= 60) {
      score += 25;
      factors.push({ signal: 'deal_stagnant', weight: 25, detail: `Deal ouvert depuis ${Math.round(stalestDeal.age)}d sans mise à jour` });
    } else if (stalestDeal.age >= 30) {
      score += 15;
      factors.push({ signal: 'deal_stagnant', weight: 15, detail: `Deal ouvert depuis ${Math.round(stalestDeal.age)}d` });
    }
  }

  // Lost deals increase risk
  const lostDeals = oppDeals.filter(d => d.status === 'lost');
  if (lostDeals.length > 0 && openDeals.length === 0) {
    score += 15;
    factors.push({ signal: 'deals_lost', weight: 15, detail: `${lostDeals.length} deal(s) perdu(s), aucun ouvert` });
  }

  // ── 3. Email engagement drop (max 20 pts) ──
  // `emailSet` est posé par le scoring de COMPTE (scoreAccountsForUser) : un
  // compte n'a pas une adresse mais celles de tous ses contacts, et sans ça la
  // comparaison à `opp.email` undefined ne matcherait jamais rien, ce qui
  // retirerait silencieusement 20 points sur 100 au score de tout compte.
  // Absent pour un contact : le comportement ne change pas d'une virgule.
  const oppEmails = emails.filter(e => {
    const to = e.to_email?.toLowerCase();
    if (!to) return false;
    return opp.emailSet ? opp.emailSet.has(to) : to === opp.email?.toLowerCase();
  });

  if (oppEmails.length > 0) {
    const recent = oppEmails.filter(e =>
      (now - new Date(e.created_at).getTime()) / DAY_MS <= 30
    );
    const older = oppEmails.filter(e => {
      const age = (now - new Date(e.created_at).getTime()) / DAY_MS;
      return age > 30 && age <= 90;
    });

    // No reply to recent emails
    const recentNoReply = recent.filter(e => e.status === 'sent' && !e.replied_at);
    if (recentNoReply.length >= 2) {
      score += 15;
      factors.push({ signal: 'no_reply', weight: 15, detail: `${recentNoReply.length} emails sans réponse (30d)` });
    } else if (recentNoReply.length === 1) {
      score += 8;
      factors.push({ signal: 'no_reply', weight: 8, detail: '1 email sans réponse (30d)' });
    }

    // Negative sentiment in last response
    const withSentiment = oppEmails.filter(e => e.sentiment);
    if (withSentiment.length > 0) {
      const latest = withSentiment.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (latest.sentiment === 'negative') {
        score += 20;
        factors.push({ signal: 'negative_sentiment', weight: 20, detail: 'Dernière réponse négative' });
      }
    }
  } else if (daysSinceActivity > 30) {
    // No emails at all + inactive = higher risk
    score += 5;
    factors.push({ signal: 'no_emails', weight: 5, detail: 'Aucun email envoyé' });
  }

  // Adresse bouncée définitivement (posé par email-outbound sur rejet 5xx) :
  // le contact a probablement quitté la société · précurseur classique de churn,
  // surtout si c'était le champion du compte.
  if (opp.email_bounced_at) {
    score += 10;
    factors.push({ signal: 'email_bounced', weight: 10, detail: `Email invalide depuis le ${new Date(opp.email_bounced_at).toLocaleDateString('fr-FR')}, contact probablement parti` });
  }

  // ── 4. Complétude (max 10 pts) ──
  // Un COMPTE n'a ni intitulé de poste ni adresse à lui : appliquer le compte
  // de champs manquants du contact lui donnerait 2 manquants sur 3 et donc
  // +10 points à TOUS les comptes, un décalage constant qui ne mesure rien.
  // L'équivalent honnête au niveau société est l'injoignabilité du plan §8.1 :
  // plus un seul interlocuteur porteur d'une adresse valide. C'est à la fois un
  // précurseur de churn (le champion est parti) et le drapeau que tout job
  // d'envoi doit filtrer.
  if (opp.isAccount) {
    if (opp.unreachable) {
      score += 10;
      factors.push({ signal: 'account_unreachable', weight: 10, detail: 'Aucun contact joignable dans ce compte' });
    }
  } else {
    let missingFields = 0;
    if (!opp.email) missingFields++;
    if (!opp.company) missingFields++;
    if (!opp.title) missingFields++;
    if (missingFields >= 2) {
      score += 10;
      factors.push({ signal: 'incomplete_profile', weight: 10, detail: `${missingFields} champ(s) manquant(s)` });
    }
  }

  // ── 5. Status-based adjustment (max 15 pts) ──
  if (opp.status === 'lost') {
    score += 15;
    factors.push({ signal: 'status_lost', weight: 15, detail: 'Statut: perdu' });
  } else if (opp.status === 'won') {
    // Un client (won) silencieux est LE signal de churn du produit · l'alourdir,
    // pas le réduire. L'offset -15 ne s'applique qu'aux clients encore actifs.
    if (daysSinceActivity >= 90) {
      score += 20;
      factors.push({ signal: 'client_silent', weight: 20, detail: `Client sans contact depuis ${Math.round(daysSinceActivity)}d` });
    } else {
      score = Math.max(0, score - 15);
      if (score > 0) {
        factors.push({ signal: 'status_won_offset', weight: -15, detail: 'Client actif (won), risque réduit' });
      }
    }
  }

  // ── 6. Sector weighting ──
  const sectorMultiplier = ownSectorMultiplier * clientSectorMultiplier;
  if (sectorMultiplier !== 1.0) {
    const before = score;
    score = Math.round(score * sectorMultiplier);
    factors.push({
      signal: 'sector_weight',
      weight: score - before,
      detail: clientSectorLabel
        ? `Pondération secteur (client: ${clientSectorLabel}, x${sectorMultiplier.toFixed(2)})`
        : `Pondération secteur (x${sectorMultiplier.toFixed(2)})`,
    });
  }

  // ── 7. Upsell-response history ──
  if (upsellEmails.length > 0) {
    const latest = [...upsellEmails].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (latest.replied_at && latest.sentiment === 'positive') {
      score = Math.max(0, score - 10);
      factors.push({ signal: 'upsell_accepted', weight: -10, detail: 'A répondu positivement à une proposition d’upsell' });
    } else if (latest.status === 'sent' && !latest.replied_at) {
      score += 5;
      factors.push({ signal: 'upsell_ignored', weight: 5, detail: 'Proposition d’upsell envoyée sans réponse' });
    }
  }

  // ── 8. External web signals (last 30 days) ──
  // Dédup avec le facteur 9 : si un registre officiel a confirmé une procédure,
  // le « financial_distress » attrapé par mots-clés Brave est le même événement
  // en moins fiable · il ne doit pas s'empiler.
  const registryTypes = new Set(registrySignals.map(s => s.signal_type));
  const registryConfirmedDistress = registryTypes.has('insolvency_proceeding')
    || registryTypes.has('insolvency_safeguard') || registryTypes.has('company_dissolved');
  const braveTypes = [...new Set(externalSignals.map(s => s.signal_type))]
    .filter(type => !(type === 'financial_distress' && registryConfirmedDistress));
  if (braveTypes.length > 0) {
    const bump = Math.min(braveTypes.length * 10, 20);
    score += bump;
    factors.push({ signal: 'external_signals', weight: bump, detail: `Signal(aux) externe(s) détecté(s) : ${braveTypes.join(', ')}` });
  }

  // ── 9. Santé financière · registres officiels (90 jours) ──
  // BODACC / Companies House / CourtListener / OpenCorporates. Signaux durs et datés,
  // volontairement NON pondérés par le secteur (facteur 6) : une liquidation
  // judiciaire est critique quel que soit le secteur.
  if (registrySignals.length > 0) {
    const detail = registrySignals[0].detail || '';
    if (registryTypes.has('insolvency_proceeding') || registryTypes.has('company_dissolved')) {
      score += 30;
      factors.push({
        signal: registryTypes.has('insolvency_proceeding') ? 'insolvency_proceeding' : 'company_dissolved',
        weight: 30, detail,
      });
      // Procédure collective ou radiation = bande critique d'office.
      score = Math.max(score, 76);
    } else if (registryTypes.has('insolvency_safeguard')) {
      score += 15;
      factors.push({ signal: 'insolvency_safeguard', weight: 15, detail });
    }
    if (registryTypes.has('revenue_drop')) {
      score += 8;
      factors.push({ signal: 'revenue_drop', weight: 8, detail });
    }
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    factors,
  };
}

/**
 * Score all opportunities for a user.
 * Called from the CRM Agent daily.
 */
async function scoreAllForUser(userId, { deals = [], emails = [] } = {}) {
  const opps = await db.opportunities.listByUser(userId, 10000, 0);
  if (opps.length === 0) return { scored: 0, atRisk: 0 };

  // Load nurture emails if not provided (includes opportunity_id + metadata for the
  // upsell-response-history factor, in addition to the existing to_email matching above)
  let allEmails = emails;
  if (allEmails.length === 0) {
    try {
      const emailResult = await db.query(
        `SELECT to_email, status, sentiment, replied_at, created_at, opportunity_id, metadata FROM nurture_emails WHERE user_id = $1`,
        [userId]
      );
      allEmails = emailResult.rows;
    } catch { allEmails = []; }
  }
  const upsellEmailsByOpp = new Map();
  for (const e of allEmails) {
    if (e.metadata?.chain !== 'auto_upsell' || !e.opportunity_id) continue;
    if (!upsellEmailsByOpp.has(e.opportunity_id)) upsellEmailsByOpp.set(e.opportunity_id, []);
    upsellEmailsByOpp.get(e.opportunity_id).push(e);
  }

  // Load external signals grouped by opportunity, split by source :
  // Brave (news, 30 jours · périmé vite) vs registres officiels (90 jours · 
  // une procédure collective reste un risque des mois durant).
  const externalSignalsByOpp = new Map();
  const registrySignalsByOpp = new Map();
  try {
    const sigResult = await db.query(
      `SELECT opportunity_id, signal_type, source, detail, detected_at FROM churn_external_signals
       WHERE user_id = $1 AND detected_at > now() - interval '90 days'`,
      [userId]
    );
    const DAY30 = 30 * DAY_MS;
    for (const s of sigResult.rows) {
      const isRegistry = (s.source || '').startsWith('registry_');
      if (isRegistry) {
        if (!registrySignalsByOpp.has(s.opportunity_id)) registrySignalsByOpp.set(s.opportunity_id, []);
        registrySignalsByOpp.get(s.opportunity_id).push(s);
      } else if (Date.now() - new Date(s.detected_at).getTime() <= DAY30) {
        if (!externalSignalsByOpp.has(s.opportunity_id)) externalSignalsByOpp.set(s.opportunity_id, []);
        externalSignalsByOpp.get(s.opportunity_id).push(s);
      }
    }
  } catch { /* table may be empty, fine */ }

  // Resolve the user's own-business sector multiplier once (not per-opportunity)
  let ownSectorMultiplier = 1.0;
  try {
    const profile = await db.query('SELECT sector FROM user_profiles WHERE user_id = $1', [userId]);
    const ownSectorText = profile.rows[0]?.sector;
    if (ownSectorText) {
      const resolved = await getSectorMultiplier(ownSectorText, 'own_business');
      ownSectorMultiplier = resolved.multiplier;
    }
  } catch { /* neutral fallback */ }

  // Pre-resolve each distinct client sector text once, to avoid a classifier call per opportunity
  const clientSectorMap = new Map();
  const distinctClientSectors = [...new Set(opps.map(o => o.data?.sector).filter(Boolean))];
  for (const raw of distinctClientSectors) {
    try {
      clientSectorMap.set(raw, await getSectorMultiplier(raw, 'client_industry'));
    } catch {
      clientSectorMap.set(raw, { multiplier: 1.0, sector: null });
    }
  }

  let scored = 0;
  let atRisk = 0;

  // Score all opportunities in memory first
  const results = [];
  for (const opp of opps) {
    const clientSector = opp.data?.sector ? clientSectorMap.get(opp.data.sector) : null;
    const { score, factors } = scoreOpportunity(opp, {
      deals, activities: [], emails: allEmails,
      ownSectorMultiplier,
      clientSectorMultiplier: clientSector?.multiplier ?? 1.0,
      clientSectorLabel: clientSector?.sector ?? null,
      upsellEmails: upsellEmailsByOpp.get(opp.id) || [],
      externalSignals: externalSignalsByOpp.get(opp.id) || [],
      registrySignals: registrySignalsByOpp.get(opp.id) || [],
    });
    results.push({ id: opp.id, score, factors: JSON.stringify(factors) });
    scored++;
    if (score >= AT_RISK_THRESHOLD) atRisk++;
  }

  // Bulk UPDATE in batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    try {
      const values = batch.map((r, idx) => `($${idx * 3 + 1}::uuid, $${idx * 3 + 2}::int, $${idx * 3 + 3}::jsonb)`).join(', ');
      const params = batch.flatMap(r => [r.id, r.score, r.factors]);
      await db.query(
        // churn_flagged_at date le franchissement du seuil vers le haut, pas
        // l'état : c'est ce qui permet au déclencheur « client à risque »
        // (lib/trigger-matching.js) de matcher un client une fois au lieu de le
        // reproposer à chaque run. Dans un UPDATE, `o.churn_score` à droite du
        // SET est l'ANCIENNE valeur : la comparaison compare bien avant/après.
        `UPDATE opportunities AS o SET
           churn_score = v.score,
           churn_factors = v.factors,
           churn_scored_at = now(),
           churn_flagged_at = CASE
             WHEN v.score < ${AT_RISK_THRESHOLD} THEN NULL
             WHEN o.churn_score IS NULL OR o.churn_score < ${AT_RISK_THRESHOLD} THEN now()
             ELSE o.churn_flagged_at
           END
         FROM (VALUES ${values}) AS v(id, score, factors)
         WHERE o.id = v.id`,
        params
      );
    } catch (err) {
      logger.error('churn-scoring', `Batch update failed (batch ${Math.floor(i / BATCH_SIZE)}): ${err.message}`);
    }

    // Snapshot dans churn_score_history · opportunities.churn_score est écrasé
    // à chaque run, seul cet historique permet de comparer un score passé au
    // statut actuel (cf. GET /api/analytics/churn-risk-performance).
    try {
      const historyValues = batch.map((r, idx) => `($1, $${idx * 3 + 2}::uuid, $${idx * 3 + 3}::int, $${idx * 3 + 4}::jsonb)`).join(', ');
      const historyParams = [userId, ...batch.flatMap(r => [r.id, r.score, r.factors])];
      await db.query(
        `INSERT INTO churn_score_history (user_id, opportunity_id, score, factors) VALUES ${historyValues}`,
        historyParams
      );
    } catch (err) {
      logger.error('churn-scoring', `History insert failed (batch ${Math.floor(i / BATCH_SIZE)}): ${err.message}`);
    }
  }

  logger.info('churn-scoring', `User ${userId}: scored ${scored} contacts, ${atRisk} at risk`);

  return { scored, atRisk };
}

/**
 * Score les COMPTES d'un utilisateur. Lot 5 du plan comptes.
 *
 * Réutilise `scoreOpportunity` plutôt que de dupliquer un barème : c'est la
 * traduction directe de l'arbitrage du 2026-10-01, « les seuils ne bougent
 * pas ». Deux barèmes qui dérivent l'un de l'autre, c'est la garantie qu'un
 * contact et son compte finissent par se contredire à l'écran sans que personne
 * ne sache lequel croire.
 *
 * Ce qui change, ce sont les ENTRÉES : un compte n'a pas une adresse mais
 * celles de tous ses contacts, pas une date d'activité mais la plus récente des
 * leurs, pas un statut mais celui que ses affaires dessinent.
 */
async function scoreAccountsForUser(userId, { emails = [] } = {}) {
  const accountsRes = await db.query(
    `SELECT id, name, industry, crm_created_at, created_at FROM accounts WHERE user_id = $1`,
    [userId]
  );
  const accounts = accountsRes.rows;
  if (accounts.length === 0) return { scored: 0, atRisk: 0 };

  // Seuls les contacts RATTACHÉS comptent. Un contact dont `account_id` est NULL
  // n'a pas encore de société connue (import antérieur au lot 2, ou CRM sans
  // objet compte non encore dérivé) : le compter nulle part est juste, l'imputer
  // à un compte au hasard ne le serait pas.
  const contactsRes = await db.query(
    `SELECT id, account_id, email, last_activity_at, created_at, status,
            is_primary_contact, email_bounced_at, data
       FROM opportunities
      WHERE user_id = $1 AND account_id IS NOT NULL`,
    [userId]
  );

  const dealsRes = await db.query(
    `SELECT id, account_id, status, crm_created_at, crm_updated_at, created_at, updated_at
       FROM deals
      WHERE user_id = $1 AND account_id IS NOT NULL`,
    [userId]
  );

  let allEmails = emails;
  if (allEmails.length === 0) {
    try {
      const emailResult = await db.query(
        `SELECT to_email, status, sentiment, replied_at, created_at, opportunity_id, metadata FROM nurture_emails WHERE user_id = $1`,
        [userId]
      );
      allEmails = emailResult.rows;
    } catch { allEmails = []; }
  }

  const contactsByAccount = new Map();
  const accountByContact = new Map();
  for (const c of contactsRes.rows) {
    if (!contactsByAccount.has(c.account_id)) contactsByAccount.set(c.account_id, []);
    contactsByAccount.get(c.account_id).push(c);
    accountByContact.set(c.id, c.account_id);
  }

  const dealsByAccount = new Map();
  for (const d of dealsRes.rows) {
    if (!dealsByAccount.has(d.account_id)) dealsByAccount.set(d.account_id, []);
    dealsByAccount.get(d.account_id).push(d);
  }

  // Les emails d'upsell se regroupent par COMPTE en passant par le contact
  // destinataire : une proposition faite à un interlocuteur engage la société.
  const upsellByAccount = new Map();
  for (const e of allEmails) {
    if (e.metadata?.chain !== 'auto_upsell' || !e.opportunity_id) continue;
    const accId = accountByContact.get(e.opportunity_id);
    if (!accId) continue;
    if (!upsellByAccount.has(accId)) upsellByAccount.set(accId, []);
    upsellByAccount.get(accId).push(e);
  }

  // Les signaux externes et de registre sont par nature des faits d'ENTREPRISE :
  // une liquidation judiciaire ne frappe pas un interlocuteur. Ils étaient posés
  // sur le contact faute de table compte ; ici ils rejoignent enfin leur objet.
  const externalByAccount = new Map();
  const registryByAccount = new Map();
  try {
    const sigResult = await db.query(
      `SELECT opportunity_id, signal_type, source, detail, detected_at FROM churn_external_signals
       WHERE user_id = $1 AND detected_at > now() - interval '90 days'`,
      [userId]
    );
    const DAY30 = 30 * DAY_MS;
    for (const s of sigResult.rows) {
      const accId = accountByContact.get(s.opportunity_id);
      if (!accId) continue;
      const isRegistry = (s.source || '').startsWith('registry_');
      const target = isRegistry ? registryByAccount : externalByAccount;
      if (!isRegistry && Date.now() - new Date(s.detected_at).getTime() > DAY30) continue;
      if (!target.has(accId)) target.set(accId, []);
      target.get(accId).push(s);
    }
  } catch { /* table vide, cas normal */ }

  let ownSectorMultiplier = 1.0;
  try {
    const profile = await db.query('SELECT sector FROM user_profiles WHERE user_id = $1', [userId]);
    const ownSectorText = profile.rows[0]?.sector;
    if (ownSectorText) {
      const resolved = await getSectorMultiplier(ownSectorText, 'own_business');
      ownSectorMultiplier = resolved.multiplier;
    }
  } catch { /* neutre */ }

  // Le secteur se lit sur le COMPTE (accounts.industry), pas sur le contact.
  // C'est plus juste et moins cher : une société a un secteur, ses huit
  // interlocuteurs en avaient huit copies parfois divergentes.
  const sectorMap = new Map();
  const distinctSectors = [...new Set(accounts.map(a => a.industry).filter(Boolean))];
  for (const raw of distinctSectors) {
    try {
      sectorMap.set(raw, await getSectorMultiplier(raw, 'client_industry'));
    } catch {
      sectorMap.set(raw, { multiplier: 1.0, sector: null });
    }
  }

  const now = Date.now();
  const results = [];
  let atRisk = 0;

  let sansContact = 0;

  for (const account of accounts) {
    const contacts = contactsByAccount.get(account.id) || [];
    const accountDeals = dealsByAccount.get(account.id) || [];

    // ── Un compte SANS AUCUN contact rattaché n'est pas scoré ──
    //
    // Mesuré sur staging au premier passage réel du 01/10 : 54 comptes sur 103
    // n'ont aucun contact rattaché, dette de rattachement du lot 2 et non fait
    // commercial. Les scorer quand même produisait deux mensonges :
    //
    //   · ils portaient tous `account_unreachable` et ses 10 points, alors que
    //     « personne n'est joignable » et « personne n'est rattaché » sont deux
    //     choses opposées, l'une sur le client et l'autre sur notre import.
    //   · faute de date d'activité, le score retombait sur la date de création
    //     DU COMPTE, donc un compte importé la semaine derniere passait pour
    //     actif. La moyenne affichée (13,1) était diluée par 54 inconnus
    //     comptés comme sains.
    //
    // On laisse donc `churn_score` à NULL, et c'est la règle de toute la base :
    // inconnu ne vaut pas zéro (cf. lib/icp-signals.js). Le compteur remonte
    // dans le rapport pour que le trou de rattachement se voie au lieu de se
    // déguiser en bonne santé.
    if (contacts.length === 0) {
      sansContact++;
      continue;
    }

    // ── L'arbitrage du 2026-10-01, en une ligne ──
    // La date d'activité du compte est la PLUS RÉCENTE de ses contacts. Les
    // affaires n'y entrent volontairement pas : leur ancienneté est déjà
    // mesurée par le facteur 2 (stagnation). La faire entrer ici aussi
    // reviendrait à compter la même preuve deux fois, en sens inverse.
    let lastActivity = null;
    for (const c of contacts) {
      const d = c.last_activity_at || c.created_at;
      if (!d) continue;
      const t = new Date(d).getTime();
      if (!isNaN(t) && (lastActivity === null || t > lastActivity)) lastActivity = t;
    }

    // Statut du compte : ce que ses affaires dessinent, l'ouvert primant sur le
    // gagné et le gagné sur le perdu. Une société qui a une affaire en cours
    // n'est pas un client perdu, même si dix autres ont été perdues avant.
    const statuses = new Set([
      ...accountDeals.map(d => d.status),
      ...(accountDeals.length === 0 ? contacts.map(c => c.status) : []),
    ]);
    const accountStatus = statuses.has('open') ? 'open'
      : statuses.has('won') ? 'won'
      : statuses.has('lost') ? 'lost'
      : null;

    const emailSet = new Set(
      contacts.map(c => c.email?.toLowerCase()).filter(Boolean)
    );

    // Injoignable au sens du plan §8.1 : le compte A des interlocuteurs (le cas
    // zéro contact est sorti plus haut) mais plus un seul ne porte d'adresse
    // valide. La distinction est tout l'intérêt du signal : des contacts qui
    // existent et dont les adresses sont mortes, c'est une équipe qui a quitté
    // la société. Zéro contact rattaché, c'est notre import qui n'a pas fait son
    // travail. Dérivé à chaque passage, jamais stocké.
    const unreachable = !contacts.some(c => c.email && !c.email_bounced_at);

    // Le rebond ne compte que s'il frappe l'interlocuteur PRINCIPAL (migration
    // 125) : c'est le départ du champion, le précurseur. Un opérationnel qui
    // s'en va n'est pas le même événement, et le compte entier devenu
    // injoignable est déjà couvert juste au-dessus.
    const primary = contacts.find(c => c.is_primary_contact);
    const bouncedAt = primary?.email_bounced_at || null;

    // Sentinelle de rattachement : `scoreOpportunity` apparie les affaires par
    // `person_id === crm_contact_id`. On lui donne un identifiant de compte des
    // deux côtés pour que ses affaires lui reviennent toutes, plutôt que de
    // dupliquer le facteur de stagnation ici.
    const sentinel = `__account__${account.id}`;
    const shapedDeals = accountDeals.map(d => ({
      status: d.status,
      person_id: sentinel,
      updatedAt: d.crm_updated_at || d.updated_at,
      created_at: d.crm_created_at || d.created_at,
    }));

    const sector = account.industry ? sectorMap.get(account.industry) : null;

    const synthetic = {
      isAccount: true,
      unreachable,
      emailSet,
      crm_contact_id: sentinel,
      company: account.name,
      last_activity_at: lastActivity ? new Date(lastActivity).toISOString() : null,
      created_at: account.crm_created_at || account.created_at,
      status: accountStatus,
      email_bounced_at: bouncedAt,
    };

    const { score, factors } = scoreOpportunity(synthetic, {
      deals: shapedDeals,
      activities: [],
      emails: allEmails,
      ownSectorMultiplier,
      clientSectorMultiplier: sector?.multiplier ?? 1.0,
      clientSectorLabel: sector?.sector ?? null,
      upsellEmails: upsellByAccount.get(account.id) || [],
      externalSignals: externalByAccount.get(account.id) || [],
      registrySignals: registryByAccount.get(account.id) || [],
    });

    // Qui a maintenu ce compte en vie. C'est ce qui rend l'arbitrage révisable
    // sans migration : le jour où un compte « sain » se révèle perdu, on peut
    // lire que seul un opérationnel répondait encore.
    if (lastActivity !== null) {
      const keeper = contacts.find(c =>
        new Date(c.last_activity_at || c.created_at).getTime() === lastActivity
      );
      factors.push({
        signal: 'activity_source',
        weight: 0,
        detail: keeper
          ? `Dernière activité portée par ${keeper.email || keeper.id}, ${Math.round((now - lastActivity) / DAY_MS)}d`
          : `Dernière activité il y a ${Math.round((now - lastActivity) / DAY_MS)}d`,
      });
    }

    results.push({
      id: account.id,
      score,
      factors: JSON.stringify(factors),
      lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
    });
    if (score >= AT_RISK_THRESHOLD) atRisk++;
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    try {
      const values = batch.map((r, idx) =>
        `($${idx * 4 + 1}::uuid, $${idx * 4 + 2}::int, $${idx * 4 + 3}::jsonb, $${idx * 4 + 4}::timestamptz)`
      ).join(', ');
      const params = batch.flatMap(r => [r.id, r.score, r.factors, r.lastActivity]);
      await db.query(
        // Même garde que sur le contact (migration 109) : `churn_flagged_at`
        // date le FRANCHISSEMENT vers le haut. Dans un UPDATE, `a.churn_score`
        // à droite du SET est l'ANCIENNE valeur, donc la comparaison oppose
        // bien l'avant et l'après.
        `UPDATE accounts AS a SET
           churn_score = v.score,
           churn_factors = v.factors,
           churn_scored_at = now(),
           last_activity_at = COALESCE(v.last_activity, a.last_activity_at),
           churn_flagged_at = CASE
             WHEN v.score < ${AT_RISK_THRESHOLD} THEN NULL
             WHEN a.churn_score IS NULL OR a.churn_score < ${AT_RISK_THRESHOLD} THEN now()
             ELSE a.churn_flagged_at
           END
         FROM (VALUES ${values}) AS v(id, score, factors, last_activity)
         WHERE a.id = v.id`,
        params
      );
    } catch (err) {
      // `UPDATE ... FROM (VALUES ...)` est du Postgres. Le miroir SQLite des
      // tests ne le connaît pas, et le catch d'origine se contentait de
      // journaliser : le scoring paraissait réussir (« scored 1 comptes ») en
      // n'écrivant rien du tout. On écrit donc ligne à ligne en repli, ce qui
      // rend le résultat vérifiable par un test au lieu d'être cru sur parole.
      logger.warn('churn-scoring', `Ecriture groupee des comptes indisponible, repli ligne a ligne: ${err.message}`);
      for (const r of batch) {
        try {
          await db.query(
            `UPDATE accounts SET
               churn_score = $2,
               churn_factors = $3,
               churn_scored_at = now(),
               last_activity_at = COALESCE($4, last_activity_at),
               churn_flagged_at = CASE
                 WHEN $2 < ${AT_RISK_THRESHOLD} THEN NULL
                 WHEN churn_score IS NULL OR churn_score < ${AT_RISK_THRESHOLD} THEN now()
                 ELSE churn_flagged_at
               END
             WHERE id = $1`,
            [r.id, r.score, r.factors, r.lastActivity]
          );
        } catch (e2) {
          logger.error('churn-scoring', `Ecriture du compte ${r.id} echouee: ${e2.message}`);
        }
      }
    }

    try {
      const historyValues = batch.map((r, idx) =>
        `($1, $${idx * 3 + 2}::uuid, $${idx * 3 + 3}::int, $${idx * 3 + 4}::jsonb)`
      ).join(', ');
      const historyParams = [userId, ...batch.flatMap(r => [r.id, r.score, r.factors])];
      await db.query(
        `INSERT INTO churn_score_history (user_id, account_id, score, factors) VALUES ${historyValues}`,
        historyParams
      );
    } catch (err) {
      logger.error('churn-scoring', `Account history insert failed (batch ${Math.floor(i / BATCH_SIZE)}): ${err.message}`);
    }
  }

  logger.info('churn-scoring', `User ${userId}: scored ${results.length} comptes, ${atRisk} à risque, ${sansContact} non scorés faute de contact rattaché`);

  // `notScored` n'est pas un détail de journal : c'est la mesure de la dette de
  // rattachement du lot 2, et elle doit remonter jusqu'à l'écran du lot 7
  // (« N comptes sans interlocuteur, ajoutez un contact », plan §8.1).
  return { scored: results.length, atRisk, notScored: sansContact };
}

/**
 * Le signalement de churn par COMPTE, prêt pour lib/trigger-matching.js.
 *
 * Chargé une fois par run et passé au matcher plutôt que relu par trigger :
 * un utilisateur a une poignée de règles mais peut avoir des centaines de
 * comptes, et c'est surtout ce qui garantit que le cron et la preview évaluent
 * la même population au même instant.
 *
 * Map vide si le lot 5 n'a jamais tourné pour cet utilisateur : le matcher
 * retombe alors sur le signalement par contact, à l'identique d'avant.
 *
 * @returns {Promise<Map<string, {flaggedAt: string, score: number}>>}
 */
async function loadAccountChurn(userId) {
  const map = new Map();
  try {
    const { rows } = await db.query(
      `SELECT id, churn_flagged_at, churn_score
         FROM accounts
        WHERE user_id = $1 AND churn_flagged_at IS NOT NULL AND churn_score >= $2`,
      [userId, AT_RISK_THRESHOLD]
    );
    for (const r of rows) {
      map.set(r.id, { flaggedAt: r.churn_flagged_at, score: r.churn_score });
    }
  } catch (err) {
    // Environnement en retard de migration : on rend une Map vide plutôt que de
    // faire échouer l'évaluation des règles. Le matcher repasse sur le contact.
    logger.warn('churn-scoring', `Signalement de churn par compte indisponible pour ${userId}`, { error: err.message });
  }
  return map;
}

/**
 * Get churn score band label and color
 */
function getChurnBand(score) {
  if (score >= 76) return { band: 'critical', color: 'var(--danger)' };
  if (score >= 51) return { band: 'high', color: 'var(--warning)' };
  if (score >= 26) return { band: 'medium', color: '#D97706' };
  return { band: 'low', color: 'var(--success)' };
}

module.exports = {
  scoreOpportunity, scoreAllForUser, scoreAccountsForUser,
  loadAccountChurn, getChurnBand, AT_RISK_THRESHOLD,
};
