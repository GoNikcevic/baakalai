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
const logger = require('../logger');

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
      const daysSinceWon = (now - new Date(client.updated_at || client.created_at).getTime()) / DAY_MS;
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

module.exports = { run };
