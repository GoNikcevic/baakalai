/**
 * Upsell Detector Agent
 *
 * Identifies clients ready for upsell/cross-sell by analyzing:
 * - Won deals with high engagement
 * - Product lines assigned (cross-sell to unassigned lines)
 * - Time since deal won (maturity)
 * - Positive sentiment in recent interactions
 *
 * Outputs: ranked list of upsell opportunities
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { getTimingContext, getCopyContext, getPatternContext, getTeamId } = require('../email-context');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { opportunities: [], errors: [] };

  try {
    const opps = await db.opportunities.listByUser(userId, 1000, 0);
    const won = opps.filter(o => o.status === 'won');

    if (won.length < 2) return report;

    // Load product lines
    const plResult = await db.query(
      `SELECT pl.id, pl.name FROM product_lines pl
       WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
      [userId]
    );
    const productLines = plResult.rows;

    // Load product line assignments
    const assignResult = await db.query(
      `SELECT opl.opportunity_id, opl.product_line_id FROM opportunity_product_lines opl
       JOIN opportunities o ON o.id = opl.opportunity_id
       WHERE o.user_id = $1`,
      [userId]
    );
    const assignsByOpp = new Map();
    for (const a of assignResult.rows) {
      if (!assignsByOpp.has(a.opportunity_id)) assignsByOpp.set(a.opportunity_id, []);
      assignsByOpp.get(a.opportunity_id).push(a.product_line_id);
    }

    // Load recent positive interactions
    const positiveEmails = await db.query(
      `SELECT opportunity_id, COUNT(*) as count FROM nurture_emails
       WHERE user_id = $1 AND sentiment = 'positive' AND created_at > now() - interval '90 days'
       GROUP BY opportunity_id`,
      [userId]
    );
    const positiveByOpp = new Map();
    for (const r of positiveEmails.rows) {
      positiveByOpp.set(r.opportunity_id, parseInt(r.count));
    }

    const now = Date.now();

    for (const client of won) {
      // won_date is the precise signal (set by CRM sync at the moment a deal transitions to
      // won); last_activity_at is a reasonable fallback for legacy won deals that predate it.
      // `updated_at` is reset to now() by a DB trigger on every internal write and must
      // never be used to measure maturity.
      const wonReference = client.won_date || client.last_activity_at || client.created_at;
      const daysSinceWon = (now - new Date(wonReference).getTime()) / DAY_MS;
      const assignedPLs = new Set(assignsByOpp.get(client.id) || []);
      const positiveCount = positiveByOpp.get(client.id) || 0;

      // Score upsell potential
      let score = 0;
      const reasons = [];

      // Mature client (30+ days since won)
      if (daysSinceWon >= 30) { score += 20; reasons.push(`Client depuis ${Math.round(daysSinceWon)}j`); }
      if (daysSinceWon >= 90) { score += 10; reasons.push('Client mature (90j+)'); }

      // Positive engagement
      if (positiveCount >= 2) { score += 25; reasons.push(`${positiveCount} interactions positives`); }
      else if (positiveCount === 1) { score += 10; reasons.push('1 interaction positive'); }

      // Cross-sell: not assigned to all product lines
      if (productLines.length > 1 && assignedPLs.size < productLines.length) {
        const unassigned = productLines.filter(pl => !assignedPLs.has(pl.id));
        score += 15 * unassigned.length;
        reasons.push(`Cross-sell possible : ${unassigned.map(pl => pl.name).join(', ')}`);
      }

      // Low churn risk = good candidate
      if (client.churn_score != null && client.churn_score < 30) {
        score += 15;
        reasons.push('Risque churn faible');
      }

      if (score >= 25) {
        report.opportunities.push({
          contactId: client.id,
          name: client.name,
          company: client.company,
          email: client.email,
          score,
          reasons,
          assignedProductLines: assignedPLs.length,
          totalProductLines: productLines.length,
        });
      }
    }

    // Sort by score desc
    report.opportunities.sort((a, b) => b.score - a.score);
    report.opportunities = report.opportunities.slice(0, 20);

    if (report.opportunities.length > 0) {
      logger.info('upsell-detector', `Found ${report.opportunities.length} upsell opportunities for user ${userId}`);
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('upsell-detector', err.message);
  }

  return report;
}

/**
 * On-demand upsell email draft for a SINGLE client (used by the "Voir le mail" on-demand
 * flow — no daily batch). Recomputes cross-sell context for just this client, then drafts
 * with one Claude call. Returns { opportunity, subject, body } or { error }.
 */
async function draftOne(userId, opportunityId) {
  const oppResult = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  const opp = oppResult.rows[0];
  if (!opp) return { error: 'not_found' };
  if (opp.status !== 'won') return { error: 'not_eligible' };
  if (!opp.email) return { error: 'no_email' };

  let productLines = [];
  try {
    const plResult = await db.query(
      `SELECT pl.id, pl.name, pl.description FROM product_lines pl
       WHERE pl.team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
      [userId]
    );
    productLines = plResult.rows;
  } catch { /* no product lines */ }

  const assignedPLIds = new Set();
  try {
    const assigns = await db.query(
      'SELECT product_line_id FROM opportunity_product_lines WHERE opportunity_id = $1',
      [opp.id]
    );
    assigns.rows.forEach(r => assignedPLIds.add(r.product_line_id));
  } catch { /* ok */ }
  const unassignedPLs = productLines.filter(pl => !assignedPLIds.has(pl.id));
  const crossSellContext = unassignedPLs.length > 0
    ? `Cross-sell products available: ${unassignedPLs.map(pl => `${pl.name} (${pl.description || ''})`).join(', ')}`
    : '';

  const [teamId] = await Promise.all([getTeamId(userId)]);
  const [timing, copyCtx, patternCtx] = await Promise.all([
    getTimingContext(userId),
    getCopyContext(userId),
    getPatternContext(teamId),
  ]);

  const prompt = `Generate a personal upsell/cross-sell email for an existing client.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Client since: won deal
${crossSellContext ? `- ${crossSellContext}` : ''}

${copyCtx ? `COPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

RULES:
- Max 6 lines, must sound human and personal
- Start by acknowledging the existing relationship (they are a client)
- Naturally introduce the upsell/cross-sell value proposition
- Tone: appreciative, not pushy — this is a valued client
- Do NOT mention scores or automated systems

Return JSON: { "subject": "...", "body": "..." }`;

  const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'upsell_draft_one');
  let email = result.parsed;
  if (!email) {
    const m = (result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (m) { try { email = JSON.parse(m[0]); } catch { email = null; } }
  }
  if (!email?.subject || !email?.body) return { error: 'generation_failed' };

  return {
    opportunity: opp,
    patternIds: patternCtx.ids,
    subject: email.subject,
    body: email.body,
    crossSellProducts: unassignedPLs.map(pl => pl.name),
  };
}

module.exports = { run, draftOne };
