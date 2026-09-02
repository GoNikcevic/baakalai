/**
 * Win/Loss Analyst Agent
 *
 * Compares won vs lost deals to identify discriminating patterns:
 * - Company size, sector, persona
 * - Cycle duration, number of touchpoints
 * - Email engagement patterns
 *
 * Outputs: memory patterns about what predicts wins vs losses
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { insights: 0, patterns: [], errors: [] };

  // Tenant des patterns (audit 02/09) : l'équipe si l'utilisateur en a une,
  // sinon l'utilisateur — jamais les deux (règle DAO, migration 089).
  // Résolu une seule fois par run, réutilisé pour chaque écriture.
  let tenant = { userId };
  try {
    const team = await db.teams.getByUser(userId);
    if (team) tenant = { teamId: team.id };
  } catch { /* résolution d'équipe indisponible : le pattern reste scopé user */ }

  try {
    const opps = await db.opportunities.listByUser(userId, 1000, 0);
    const won = opps.filter(o => o.status === 'won');
    const lost = opps.filter(o => o.status === 'lost');

    if (won.length < 3 || lost.length < 3) {
      report.patterns.push('Need at least 3 won + 3 lost deals for analysis');
      return report;
    }

    // Load email counts per contact
    const emailCounts = await db.query(
      `SELECT opportunity_id, COUNT(*) as count,
              COUNT(*) FILTER (WHERE sentiment = 'positive') as positive,
              COUNT(*) FILTER (WHERE sentiment = 'negative') as negative
       FROM nurture_emails WHERE user_id = $1
       GROUP BY opportunity_id`,
      [userId]
    );
    const emailMap = new Map();
    for (const r of emailCounts.rows) {
      emailMap.set(r.opportunity_id, r);
    }

    // Build analysis data
    const wonData = won.map(o => buildDealProfile(o, emailMap));
    const lostData = lost.map(o => buildDealProfile(o, emailMap));

    const prompt = `Analyze won vs lost B2B deals to identify patterns.

WON DEALS (${won.length}):
${wonData.map(d => `- ${d.company || 'N/A'} | ${d.title || 'N/A'} | ${d.companySize || 'N/A'} | ${d.cycleDays}d cycle | ${d.emails} emails | ${d.positiveEmails} positive`).join('\n')}

LOST DEALS (${lost.length}):
${lostData.map(d => `- ${d.company || 'N/A'} | ${d.title || 'N/A'} | ${d.companySize || 'N/A'} | ${d.cycleDays}d cycle | ${d.emails} emails | ${d.positiveEmails} positive`).join('\n')}

Identify the top 3-5 discriminating factors between wins and losses.
For each pattern, indicate if it's about company profile, engagement, timing, or persona.

Return JSON:
{
  "patterns": [
    { "insight": "...", "category": "profile|engagement|timing|persona", "confidence": "high|medium" }
  ],
  "winProfile": "1-sentence ideal deal profile",
  "lossSignals": ["early warning 1", "early warning 2"]
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 1000, 'win_loss_analysis');
    const analysis = safeParseClaudeJSON(result, 'patterns');

    if (analysis?.patterns) {
      for (const p of analysis.patterns) {
        await db.memoryPatterns.replaceOrCreate({
          ...tenant,
          pattern: `Win/Loss: ${p.insight}`,
          category: 'Cible',
          data: JSON.stringify({ type: 'win_loss', category: p.category }),
          confidence: p.confidence === 'high' ? 'Haute' : 'Moyenne',
          sectors: [], targets: [],
        });
        report.insights++;
        report.patterns.push(p.insight);
      }

      if (analysis.winProfile) {
        await db.memoryPatterns.replaceOrCreate({
          ...tenant,
          pattern: `Profil de deal gagnant : ${analysis.winProfile}`,
          category: 'Cible',
          data: JSON.stringify({ type: 'win_profile', lossSignals: analysis.lossSignals }),
          confidence: 'Haute',
          sectors: [], targets: [],
        });
        report.insights++;
      }

      logger.info('win-loss-analyst', `${report.insights} insights from ${won.length} wins / ${lost.length} losses`);
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('win-loss-analyst', err.message);
  }

  return report;
}

function buildDealProfile(opp, emailMap) {
  const emails = emailMap.get(opp.id) || { count: 0, positive: 0, negative: 0 };
  const cycleDays = Math.round(
    (new Date(opp.updated_at || opp.created_at).getTime() - new Date(opp.created_at).getTime()) / DAY_MS
  );
  return {
    company: opp.company,
    title: opp.title,
    companySize: opp.company_size,
    cycleDays,
    emails: parseInt(emails.count) || 0,
    positiveEmails: parseInt(emails.positive) || 0,
    negativeEmails: parseInt(emails.negative) || 0,
  };
}

module.exports = { run };
