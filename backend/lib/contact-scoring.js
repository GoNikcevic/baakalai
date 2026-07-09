/**
 * Unified Contact Score (0-100)
 *
 * Combines 3 signal groups:
 * - Activity (max 40): email opens, clicks, replies, recency (last 30 days)
 * - Fit (max 30): sector, company size, persona, zone match vs ICP
 * - Status (max 30): pipeline position + campaign engagement metrics
 *
 * Replaces the old separate lead-scoring + engagement-scoring engines.
 */

const db = require('../db');
const logger = require('./logger');

const DAY_MS = 86400000;

// ── Status-based scoring (max 30) ──

const STATUS_POINTS = {
  'new': 0,
  'interesse': 15,
  'intéressé': 15,
  'interested': 15,
  'call planifie': 25,
  'call planifié': 25,
  'meeting': 25,
  'negotiation': 28,
  'won': 30,
  'rappeler': 12,
  'lost': 3,
  'perdu': 3,
};

// ── Fit scoring (max 30) ──

function computeFit(opportunity, campaign, profile) {
  if (!profile) return { score: 0, factors: [] };
  let score = 0;
  const factors = [];

  const targetSectors = (profile.target_sectors || '').toLowerCase();
  const campaignSector = (campaign?.sector || '').toLowerCase();
  if (targetSectors && campaignSector && targetSectors.includes(campaignSector.split(' ')[0])) {
    score += 12;
    factors.push({ signal: 'sector_match', weight: 12 });
  }

  const targetSize = (profile.target_size || '').toLowerCase();
  const oppSize = (opportunity.company_size || '').toLowerCase();
  if (targetSize && oppSize && (targetSize.includes(oppSize) || oppSize.includes(targetSize))) {
    score += 8;
    factors.push({ signal: 'size_match', weight: 8 });
  }

  const personas = ((profile.persona_primary || '') + ' ' + (profile.persona_secondary || '')).toLowerCase();
  const title = (opportunity.title || '').toLowerCase();
  if (personas && title) {
    const titleWords = title.split(/\s+/);
    if (titleWords.some(w => w.length > 3 && personas.includes(w))) {
      score += 10;
      factors.push({ signal: 'persona_match', weight: 10 });
    }
  }

  return { score: Math.min(score, 30), factors };
}

// ── Activity scoring (max 40) ──

function computeActivity(activities) {
  if (!activities || activities.length === 0) return { score: 0, factors: [] };

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * DAY_MS;
  const factors = [];
  let score = 0;

  const recent = activities.filter(a => {
    const ts = a.happened_at ? new Date(a.happened_at).getTime() : 0;
    return ts >= thirtyDaysAgo;
  });

  // Opens (max 10)
  const openCount = recent.filter(a => a.type === 'emailsOpened').length;
  let openPts = 0;
  if (openCount >= 5) openPts = 10;
  else if (openCount >= 3) openPts = 8;
  else if (openCount >= 1) openPts = 4;
  if (openPts > 0) factors.push({ signal: 'email_opens', weight: openPts, detail: `${openCount} open(s)` });
  score += openPts;

  // Clicks (max 10)
  const clickCount = recent.filter(a => a.type === 'emailsClicked').length;
  let clickPts = 0;
  if (clickCount >= 3) clickPts = 10;
  else if (clickCount >= 1) clickPts = 6;
  if (clickPts > 0) factors.push({ signal: 'email_clicks', weight: clickPts, detail: `${clickCount} click(s)` });
  score += clickPts;

  // Replies (max 12 — strongest signal)
  const replyCount = recent.filter(a => a.type === 'emailsReplied').length;
  let replyPts = 0;
  if (replyCount >= 3) replyPts = 12;
  else if (replyCount >= 2) replyPts = 10;
  else if (replyCount >= 1) replyPts = 7;
  if (replyPts > 0) factors.push({ signal: 'email_replies', weight: replyPts, detail: `${replyCount} reply/replies` });
  score += replyPts;

  // Recency (max 8)
  let lastTs = 0;
  for (const a of activities) {
    const ts = a.happened_at ? new Date(a.happened_at).getTime() : 0;
    if (ts > lastTs) lastTs = ts;
  }
  let recencyPts = 0;
  if (lastTs > 0) {
    const days = (now - lastTs) / DAY_MS;
    if (days < 7) recencyPts = 8;
    else if (days < 30) recencyPts = 5;
    else if (days < 90) recencyPts = 2;
    factors.push({ signal: 'recency', weight: recencyPts, detail: `${Math.round(days)}d ago` });
  }
  score += recencyPts;

  return { score: Math.min(score, 40), factors };
}

// ── Status scoring (max 30) ──

function computeStatus(opportunity, campaign) {
  let score = 0;
  const status = (opportunity.status || 'new').toLowerCase();
  score += STATUS_POINTS[status] || 0;

  // Campaign metrics boost (only if not already in a terminal status)
  if (campaign && status !== 'won' && status !== 'lost') {
    if (campaign.reply_rate > 5) score += 3;
    if (campaign.open_rate > 50) score += 2;
  }

  return Math.min(score, 30);
}

// ── Main scoring function ──

function scoreContact(opportunity, { campaign, profile, activities } = {}) {
  const activityResult = computeActivity(activities || []);
  const fitResult = computeFit(opportunity, campaign, profile);
  const statusScore = computeStatus(opportunity, campaign);

  const total = Math.min(100, activityResult.score + fitResult.score + statusScore);

  return {
    score: total,
    breakdown: {
      activity: activityResult.score,
      fit: fitResult.score,
      status: statusScore,
    },
    factors: [...activityResult.factors, ...fitResult.factors],
  };
}

/**
 * Score all contacts for a user. Fetches activities from DB.
 */
async function scoreAllContacts(userId) {
  const [opportunities, allCampaigns, profile] = await Promise.all([
    db.opportunities.listByUser(userId, 10000, 0),
    db.campaigns.list({ userId }),
    db.profiles.get(userId),
  ]);

  if (opportunities.length === 0) {
    return { contacts: [], avgScore: 0, distribution: { high: 0, medium: 0, low: 0 } };
  }

  const campaignMap = {};
  for (const c of allCampaigns) campaignMap[c.id] = c;

  // Fetch activities (last 90 days)
  let allActivities = [];
  try {
    const result = await db.query(
      `SELECT * FROM prospect_activities WHERE user_id = $1 AND happened_at > now() - interval '90 days' ORDER BY happened_at DESC`,
      [userId]
    );
    allActivities = result.rows;
  } catch (err) {
    logger.error('contact-scoring', `Failed to fetch activities: ${err.message}`);
  }

  // Index activities by email and opportunity_id
  const activitiesByEmail = {};
  const activitiesByOppId = {};
  for (const a of allActivities) {
    if (a.lead_email) {
      const key = a.lead_email.toLowerCase();
      if (!activitiesByEmail[key]) activitiesByEmail[key] = [];
      activitiesByEmail[key].push(a);
    }
    if (a.opportunity_id) {
      if (!activitiesByOppId[a.opportunity_id]) activitiesByOppId[a.opportunity_id] = [];
      activitiesByOppId[a.opportunity_id].push(a);
    }
  }

  const scoredContacts = [];
  let totalScore = 0;
  const distribution = { high: 0, medium: 0, low: 0 };

  for (const opp of opportunities) {
    // Match activities to contact
    const acts = [
      ...(activitiesByOppId[opp.id] || []),
      ...(opp.email ? (activitiesByEmail[opp.email.toLowerCase()] || []) : []),
    ];
    const seen = new Set();
    const uniqueActs = acts.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });

    const campaign = opp.campaign_id ? campaignMap[opp.campaign_id] : null;
    const result = scoreContact(opp, { campaign, profile, activities: uniqueActs });

    // Find last activity date
    let lastActivity = null;
    if (uniqueActs.length > 0) {
      const maxTs = Math.max(...uniqueActs.map(a => a.happened_at ? new Date(a.happened_at).getTime() : 0));
      if (maxTs > 0) lastActivity = new Date(maxTs).toISOString();
    }
    if (!lastActivity && opp.updated_at) lastActivity = opp.updated_at;

    scoredContacts.push({
      id: opp.id,
      name: opp.name,
      email: opp.email,
      company: opp.company,
      title: opp.title,
      status: opp.status,
      score: result.score,
      breakdown: result.breakdown,
      factors: result.factors,
      campaign: campaign?.name || null,
      lastActivity: lastActivity ? (typeof lastActivity === 'string' ? lastActivity.split('T')[0] : null) : null,
    });

    totalScore += result.score;
    if (result.score >= 70) distribution.high++;
    else if (result.score >= 40) distribution.medium++;
    else distribution.low++;
  }

  scoredContacts.sort((a, b) => b.score - a.score);

  const avgScore = scoredContacts.length > 0
    ? Math.round((totalScore / scoredContacts.length) * 10) / 10
    : 0;

  logger.info('contact-scoring', `User ${userId}: scored ${scoredContacts.length} contacts, avg=${avgScore}`);

  return { contacts: scoredContacts, avgScore, distribution };
}

// Backwards-compatible wrapper for code that calls scoreOpportunities(opps, profile, campaignMap)
function scoreOpportunities(opportunities, profile, campaignMap) {
  return opportunities.map(opp => {
    const campaign = opp.campaign_id ? campaignMap[opp.campaign_id] : null;
    const result = scoreContact(opp, { campaign, profile, activities: [] });
    return {
      ...opp,
      score: result.score,
      scoreBreakdown: { engagement: result.breakdown.activity, fit: result.breakdown.fit, total: result.score },
    };
  });
}

module.exports = { scoreContact, scoreAllContacts, scoreOpportunities, computeFit, computeActivity };
