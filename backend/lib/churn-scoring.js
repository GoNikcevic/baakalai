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
 * from real churn_outcomes feedback is future work — intended to reuse the memory_patterns
 * cross-user learning pattern (memory_patterns.sectors) via the existing Sunday Memory Agent,
 * not a separate learning system. This phase only wires up the data collection.
 */

const db = require('../db');
const logger = require('./logger');
const { getSectorMultiplier } = require('./sector-classifier');

const DAY_MS = 86400000;

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
  upsellEmails = [], externalSignals = [],
} = {}) {
  const now = Date.now();
  const factors = [];
  let score = 0;

  // ── 1. Inactivity (max 30 pts) ──
  // `last_activity_at` reflects genuine CRM changes; `updated_at` is reset to now() by a
  // DB trigger on every internal write (including this very scoring pass), so it can't
  // be trusted to measure staleness.
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
  const oppDeals = deals.filter(d =>
    d.person_id === opp.crm_contact_id || d.personId === opp.crm_contact_id
  );
  const openDeals = oppDeals.filter(d => d.status === 'open');

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
    // Won contacts can still churn — but base risk is lower
    score = Math.max(0, score - 15);
    if (score > 0) {
      factors.push({ signal: 'status_won_offset', weight: -15, detail: 'Client actif (won) — risque réduit' });
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
  if (externalSignals.length > 0) {
    const distinctTypes = [...new Set(externalSignals.map(s => s.signal_type))];
    const bump = Math.min(distinctTypes.length * 10, 20);
    score += bump;
    factors.push({ signal: 'external_signals', weight: bump, detail: `Signal(aux) externe(s) détecté(s) : ${distinctTypes.join(', ')}` });
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

  // Load external signals from the last 30 days, grouped by opportunity
  const externalSignalsByOpp = new Map();
  try {
    const sigResult = await db.query(
      `SELECT opportunity_id, signal_type FROM churn_external_signals
       WHERE user_id = $1 AND detected_at > now() - interval '30 days'`,
      [userId]
    );
    for (const s of sigResult.rows) {
      if (!externalSignalsByOpp.has(s.opportunity_id)) externalSignalsByOpp.set(s.opportunity_id, []);
      externalSignalsByOpp.get(s.opportunity_id).push(s);
    }
  } catch { /* table may be empty — fine */ }

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
    });
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
