/**
 * Reactivation Queue — shared, AI-free detection for both "Deals à relancer" and
 * "Clients à upseller" list pages, plus the "Reporter" (postpone) action shared by both.
 *
 * No Claude calls here — only cheap CRM-data queries. AI generation happens on-demand,
 * per single item, in lib/agents/deal-coach.js's coachAndDraftOne / lib/agents/
 * upsell-detector.js's draftOne, triggered only when the user opens a single candidate.
 */

const db = require('../db');
const upsellDetector = require('./agents/upsell-detector');

const DAY_MS = 86400000;
const STAGNANT_DAYS = 14; // matches deal-coach.js's existing stagnation threshold

// `last_activity_at` (populated from real CRM changes) is the trustworthy staleness signal —
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

function isDue(opp) {
  if (opp.planned_followup_date) return new Date(opp.planned_followup_date).getTime() <= Date.now();
  const daysSinceUpdate = (Date.now() - new Date(lastRealActivity(opp)).getTime()) / DAY_MS;
  return daysSinceUpdate >= STAGNANT_DAYS;
}

/**
 * List active (not won/lost) deals due for reactivation — no planned date and stagnant 14d+,
 * or a planned date that has passed. Rule-based only, no AI call.
 */
async function listDealsToReactivate(userId, sort = 'overdue') {
  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE user_id = $1 AND status NOT IN ('won', 'lost')
       AND (
         (planned_followup_date IS NULL AND COALESCE(last_activity_at, created_at) < now() - interval '${STAGNANT_DAYS} days')
         OR (planned_followup_date IS NOT NULL AND planned_followup_date <= now())
       )`,
    [userId]
  );

  const failedIds = await failedSendIds(userId, 'deal_reactivation', result.rows.map(o => o.id));

  const candidates = result.rows.map(o => {
    const overdue = computeOverdue(o);
    return {
      id: o.id,
      name: o.name,
      company: o.company,
      title: o.title,
      email: o.email,
      status: o.status,
      dealValue: o.deal_value,
      churnScore: o.churn_score,
      ...overdue,
      reason: overdue.overdueLabel,
      hasFailedSend: failedIds.has(o.id),
    };
  });

  candidates.sort((a, b) => sort === 'value'
    ? (b.dealValue || 0) - (a.dealValue || 0)
    : b.overdueDays - a.overdueDays);

  return candidates;
}

/**
 * List won clients eligible for upsell (score-based, from upsell-detector.js's rule-based
 * scoring — no AI), gated by the same planned_followup_date rule as deal reactivation.
 */
async function listClientsToUpsell(userId, sort = 'score') {
  const { opportunities: scored } = await upsellDetector.run(userId);
  if (scored.length === 0) return [];

  const ids = scored.map(o => o.contactId);
  const oppResult = await db.query(
    `SELECT id, planned_followup_date, last_activity_at, created_at, deal_value FROM opportunities WHERE id = ANY($1)`,
    [ids]
  );
  const oppById = new Map(oppResult.rows.map(o => [o.id, o]));

  const dueIds = scored.map(c => c.contactId).filter(id => oppById.has(id) && isDue(oppById.get(id)));
  const failedIds = await failedSendIds(userId, 'auto_upsell', dueIds);

  const candidates = scored
    .map(c => {
      const opp = oppById.get(c.contactId);
      if (!opp) return null;
      if (!isDue(opp)) return null; // planned_followup_date set in the future — not due yet
      const overdue = computeOverdue(opp);
      return {
        id: c.contactId,
        name: c.name,
        company: c.company,
        email: c.email,
        dealValue: opp.deal_value,
        score: c.score,
        reason: c.reasons.join(', '),
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
 * "Reporter" — set (or clear) the planned follow-up date for a deal or upsell candidate.
 */
async function postponeOpportunity(userId, opportunityId, date) {
  const result = await db.query(
    `UPDATE opportunities SET planned_followup_date = $1, planned_followup_reason = 'manual' WHERE id = $2 AND user_id = $3 RETURNING id`,
    [date, opportunityId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Opportunity ids (for this kind's candidate pool) whose most recent draft failed to send —
 * surfaced as an alert badge on the queue tab, NOT in history (the mail never actually left).
 */
async function failedSendIds(userId, kind, opportunityIds) {
  if (opportunityIds.length === 0) return new Set();
  const result = await db.query(
    `SELECT DISTINCT ON (opportunity_id) opportunity_id, status
     FROM nurture_emails
     WHERE user_id = $1 AND opportunity_id = ANY($2) AND metadata ->> 'chain' = $3
     ORDER BY opportunity_id, created_at DESC`,
    [userId, opportunityIds, kind]
  );
  return new Set(result.rows.filter(r => r.status === 'failed').map(r => r.opportunity_id));
}

/**
 * History tab: everything that has happened via Baakalai for this kind's candidates —
 * emails actually sent, follow-ups postponed (manual or automatic — post-send cooldown is
 * excluded, it's covered by the "sent" entry already), and deals/clients closed CRM-side
 * (won/lost). No AI call, rule-based reads only.
 */
async function getHistory(userId, kind) {
  const sentResult = await db.query(
    `SELECT ne.id, ne.opportunity_id, ne.to_name, ne.sent_at, o.company
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
    name: r.to_name,
    company: r.company,
  }));

  const postponedResult = await db.query(
    `SELECT id, name, company, planned_followup_date, planned_followup_reason
     FROM opportunities
     WHERE user_id = $1 AND status ${kind === 'auto_upsell' ? "= 'won'" : "NOT IN ('won', 'lost')"}
       AND planned_followup_date IS NOT NULL AND planned_followup_date > now()
       AND (planned_followup_reason IS NULL OR planned_followup_reason != 'post_send_cooldown')
     ORDER BY planned_followup_date DESC LIMIT 50`,
    [userId]
  );
  const postponed = postponedResult.rows.map(r => ({
    eventType: 'postponed',
    date: r.planned_followup_date,
    opportunityId: r.id,
    name: r.name,
    company: r.company,
    isManual: r.planned_followup_reason === 'manual' || !r.planned_followup_reason,
    reason: r.planned_followup_reason || 'manual',
  }));

  const closedResult = await db.query(
    `SELECT id, name, company, status, won_date, lost_date
     FROM opportunities
     WHERE user_id = $1 AND status ${kind === 'auto_upsell' ? "= 'lost'" : "IN ('won', 'lost')"}
       AND COALESCE(won_date, lost_date) IS NOT NULL
     ORDER BY COALESCE(won_date, lost_date) DESC LIMIT 50`,
    [userId]
  );
  const closed = closedResult.rows.map(r => ({
    eventType: 'closed',
    date: r.won_date || r.lost_date,
    opportunityId: r.id,
    name: r.name,
    company: r.company,
    status: r.status,
  }));

  return [...sent, ...postponed, ...closed]
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

module.exports = { listDealsToReactivate, listClientsToUpsell, postponeOpportunity, failedSendIds, getHistory };
