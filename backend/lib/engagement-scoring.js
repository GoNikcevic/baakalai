/**
 * Engagement Scoring Engine
 *
 * Calculate engagement score (0-100) for each contact.
 *
 * Signals (weighted):
 * - Email opens in last 30 days: 0-25 points
 * - Email clicks in last 30 days: 0-25 points
 * - Email replies in last 30 days: 0-25 points
 * - Recency of last activity: 0-25 points (25 if <7 days, 15 if <30, 5 if <90, 0 if >90)
 */

const db = require('../db');
const logger = require('./logger');

const DAY_MS = 86400000;

/**
 * Score a single contact for engagement based on their activities.
 * Returns { engagement_score, engagement_factors }
 */
function scoreContact(contact, activities) {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * DAY_MS;
  const factors = [];
  let score = 0;

  // Filter activities to last 30 days
  const recentActivities = activities.filter(a => {
    const ts = a.happened_at ? new Date(a.happened_at).getTime() : 0;
    return ts >= thirtyDaysAgo;
  });

  // ── 1. Email opens (max 25 pts) ──
  const opens = recentActivities.filter(a => a.type === 'emailsOpened');
  const openCount = opens.length;
  let openPoints = 0;
  if (openCount >= 5) openPoints = 25;
  else if (openCount >= 3) openPoints = 20;
  else if (openCount >= 2) openPoints = 15;
  else if (openCount >= 1) openPoints = 8;
  if (openPoints > 0) {
    factors.push({ signal: 'email_opens', weight: openPoints, detail: `${openCount} open(s) in last 30d` });
  }
  score += openPoints;

  // ── 2. Email clicks (max 25 pts) ──
  const clicks = recentActivities.filter(a => a.type === 'emailsClicked');
  const clickCount = clicks.length;
  let clickPoints = 0;
  if (clickCount >= 5) clickPoints = 25;
  else if (clickCount >= 3) clickPoints = 20;
  else if (clickCount >= 2) clickPoints = 15;
  else if (clickCount >= 1) clickPoints = 10;
  if (clickPoints > 0) {
    factors.push({ signal: 'email_clicks', weight: clickPoints, detail: `${clickCount} click(s) in last 30d` });
  }
  score += clickPoints;

  // ── 3. Email replies (max 25 pts) ──
  const replies = recentActivities.filter(a => a.type === 'emailsReplied');
  const replyCount = replies.length;
  let replyPoints = 0;
  if (replyCount >= 3) replyPoints = 25;
  else if (replyCount >= 2) replyPoints = 20;
  else if (replyCount >= 1) replyPoints = 15;
  if (replyPoints > 0) {
    factors.push({ signal: 'email_replies', weight: replyPoints, detail: `${replyCount} reply/replies in last 30d` });
  }
  score += replyPoints;

  // ── 4. Recency of last activity (max 25 pts) ──
  let lastActivityTs = 0;
  for (const a of activities) {
    const ts = a.happened_at ? new Date(a.happened_at).getTime() : 0;
    if (ts > lastActivityTs) lastActivityTs = ts;
  }
  // Also consider the contact's own updated_at
  const contactUpdated = contact.updated_at ? new Date(contact.updated_at).getTime() : 0;
  if (contactUpdated > lastActivityTs) lastActivityTs = contactUpdated;

  let recencyPoints = 0;
  if (lastActivityTs > 0) {
    const daysSince = (now - lastActivityTs) / DAY_MS;
    if (daysSince < 7) recencyPoints = 25;
    else if (daysSince < 30) recencyPoints = 15;
    else if (daysSince < 90) recencyPoints = 5;
    // else 0
    factors.push({ signal: 'recency', weight: recencyPoints, detail: `Last activity ${Math.round(daysSince)}d ago` });
  } else {
    factors.push({ signal: 'recency', weight: 0, detail: 'No activity recorded' });
  }
  score += recencyPoints;

  return {
    engagement_score: Math.min(100, Math.max(0, score)),
    engagement_factors: factors,
    last_activity: lastActivityTs > 0 ? new Date(lastActivityTs).toISOString() : null,
  };
}

/**
 * Score engagement for all contacts of a user.
 * @param {string} userId
 * @param {Array} [contacts] - optional pre-fetched contacts; if omitted, fetched from DB
 * @returns {{ contacts: Array, avgScore: number, distribution: { high: number, medium: number, low: number } }}
 */
async function scoreEngagement(userId, contacts) {
  // Fetch contacts if not provided
  if (!contacts) {
    contacts = await db.opportunities.listByUser(userId, 10000, 0);
  }
  if (contacts.length === 0) {
    return { contacts: [], avgScore: 0, distribution: { high: 0, medium: 0, low: 0 } };
  }

  // Fetch all prospect activities for this user (last 90 days for recency, last 30d for scoring)
  let allActivities = [];
  try {
    const result = await db.query(
      `SELECT * FROM prospect_activities WHERE user_id = $1 AND happened_at > now() - interval '90 days' ORDER BY happened_at DESC`,
      [userId]
    );
    allActivities = result.rows;
  } catch (err) {
    logger.error('engagement-scoring', `Failed to fetch activities: ${err.message}`);
  }

  // Index activities by lead_email (lowercase) and opportunity_id
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

  for (const contact of contacts) {
    // Match activities to this contact by opportunity_id or email
    const activities = [
      ...(activitiesByOppId[contact.id] || []),
      ...(contact.email ? (activitiesByEmail[contact.email.toLowerCase()] || []) : []),
    ];

    // Deduplicate by activity id
    const seen = new Set();
    const uniqueActivities = activities.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });

    const result = scoreContact(contact, uniqueActivities);

    scoredContacts.push({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      company: contact.company,
      status: contact.status,
      engagement_score: result.engagement_score,
      engagement_factors: result.engagement_factors,
      last_activity: result.last_activity,
    });

    totalScore += result.engagement_score;
    if (result.engagement_score >= 70) distribution.high++;
    else if (result.engagement_score >= 30) distribution.medium++;
    else distribution.low++;
  }

  // Sort by score descending
  scoredContacts.sort((a, b) => b.engagement_score - a.engagement_score);

  const avgScore = scoredContacts.length > 0
    ? Math.round((totalScore / scoredContacts.length) * 10) / 10
    : 0;

  logger.info('engagement-scoring', `User ${userId}: scored ${scoredContacts.length} contacts, avg=${avgScore}`);

  return { contacts: scoredContacts, avgScore, distribution };
}

module.exports = { scoreContact, scoreEngagement };
