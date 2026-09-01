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
 */

const db = require('../db');
const logger = require('./logger');

const DAY_MS = 86400000;

/**
 * Score a single opportunity for churn risk.
 * Returns { score, factors[] }
 */
function scoreOpportunity(opp, { deals = [], activities = [], emails = [] } = {}) {
  const now = Date.now();
  const factors = [];
  let score = 0;

  // ── 1. Inactivity (max 30 pts) ──
  // `updated_at` est réécrit à chaque synchro CRM : s'en servir ici rendait le
  // critère d'inactivité — 30 points sur 100, le plus lourd — impossible à
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
  // elle-même est le deal — un statut 'open' qui vieillit sans conclusion
  // est le même signal, quel que soit le CRM.
  const oppDeals = deals.filter(d =>
    d.person_id === opp.crm_contact_id || d.personId === opp.crm_contact_id
  );
  const openDeals = oppDeals.filter(d => d.status === 'open');

  if (oppDeals.length === 0 && opp.status === 'open' && opp.created_at) {
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
  const oppEmails = emails.filter(e =>
    e.to_email?.toLowerCase() === opp.email?.toLowerCase()
  );

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

  // ── 4. Contact completeness (max 10 pts) ──
  let missingFields = 0;
  if (!opp.email) missingFields++;
  if (!opp.company) missingFields++;
  if (!opp.title) missingFields++;
  if (missingFields >= 2) {
    score += 10;
    factors.push({ signal: 'incomplete_profile', weight: 10, detail: `${missingFields} champ(s) manquant(s)` });
  }

  // ── 5. Status-based adjustment (max 15 pts) ──
  if (opp.status === 'lost') {
    score += 15;
    factors.push({ signal: 'status_lost', weight: 15, detail: 'Statut: perdu' });
  } else if (opp.status === 'won') {
    // Un client (won) silencieux est LE signal de churn du produit — l'alourdir,
    // pas le réduire. L'offset -15 ne s'applique qu'aux clients encore actifs.
    if (daysSinceActivity >= 90) {
      score += 20;
      factors.push({ signal: 'client_silent', weight: 20, detail: `Client sans contact depuis ${Math.round(daysSinceActivity)}d` });
    } else {
      score = Math.max(0, score - 15);
      if (score > 0) {
        factors.push({ signal: 'status_won_offset', weight: -15, detail: 'Client actif (won) — risque réduit' });
      }
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

  // Load nurture emails if not provided
  let allEmails = emails;
  if (allEmails.length === 0) {
    try {
      const emailResult = await db.query(
        `SELECT to_email, status, sentiment, replied_at, created_at FROM nurture_emails WHERE user_id = $1`,
        [userId]
      );
      allEmails = emailResult.rows;
    } catch { allEmails = []; }
  }

  let scored = 0;
  let atRisk = 0;

  // Score all opportunities in memory first
  const results = [];
  for (const opp of opps) {
    const { score, factors } = scoreOpportunity(opp, { deals, activities: [], emails: allEmails });
    results.push({ id: opp.id, score, factors: JSON.stringify(factors) });
    scored++;
    if (score >= 50) atRisk++;
  }

  // Bulk UPDATE in batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    try {
      const values = batch.map((r, idx) => `($${idx * 3 + 1}::uuid, $${idx * 3 + 2}::int, $${idx * 3 + 3}::jsonb)`).join(', ');
      const params = batch.flatMap(r => [r.id, r.score, r.factors]);
      await db.query(
        `UPDATE opportunities AS o SET churn_score = v.score, churn_factors = v.factors, churn_scored_at = now()
         FROM (VALUES ${values}) AS v(id, score, factors)
         WHERE o.id = v.id`,
        params
      );
    } catch (err) {
      logger.error('churn-scoring', `Batch update failed (batch ${Math.floor(i / BATCH_SIZE)}): ${err.message}`);
    }
  }

  logger.info('churn-scoring', `User ${userId}: scored ${scored} contacts, ${atRisk} at risk`);

  return { scored, atRisk };
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

module.exports = { scoreOpportunity, scoreAllForUser, getChurnBand };
