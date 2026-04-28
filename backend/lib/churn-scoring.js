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
  const lastActivity = opp.updated_at || opp.created_at;
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
  const oppDeals = deals.filter(d =>
    d.person_id === opp.crm_contact_id || d.personId === opp.crm_contact_id
  );
  const openDeals = oppDeals.filter(d => d.status === 'open');

  if (openDeals.length > 0) {
    const stalestDeal = openDeals.reduce((oldest, d) => {
      const age = (now - new Date(d.updatedAt || d.update_time || d.created_at).getTime()) / DAY_MS;
      return age > oldest.age ? { deal: d, age } : oldest;
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
    // Won contacts can still churn — but base risk is lower
    score = Math.max(0, score - 15);
    if (score > 0) {
      factors.push({ signal: 'status_won_offset', weight: -15, detail: 'Client actif (won) — risque réduit' });
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

  for (const opp of opps) {
    const { score, factors } = scoreOpportunity(opp, { deals, activities: [], emails: allEmails });

    await db.query(
      `UPDATE opportunities SET churn_score = $1, churn_factors = $2, churn_scored_at = now() WHERE id = $3`,
      [score, JSON.stringify(factors), opp.id]
    );

    scored++;
    if (score >= 50) atRisk++;
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
