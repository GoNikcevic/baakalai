/**
 * Competitor Watch Agent
 *
 * Monitors competitors of the user's clients by analyzing:
 * - Company profiles in CRM
 * - Web search for competitor activity
 * - Job postings (hiring signals)
 *
 * Outputs: alerts + memory patterns about competitive landscape
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');

async function run(userId) {
  const report = { insights: 0, alerts: [], errors: [] };

  // Tenant des patterns (audit 02/09) : l'équipe si l'utilisateur en a une,
  // sinon l'utilisateur — jamais les deux (règle DAO, migration 089).
  // Résolu une seule fois par run, réutilisé pour chaque écriture.
  let tenant = { userId };
  try {
    const team = await db.teams.getByUser(userId);
    if (team) tenant = { teamId: team.id };
  } catch { /* résolution d'équipe indisponible : le pattern reste scopé user */ }

  try {
    // Load user profile for context
    const profileRes = await db.query(`SELECT profile_data FROM users WHERE id = $1`, [userId]);
    const profile = profileRes.rows[0]?.profile_data || {};

    // Load won + active deals for competitor analysis
    const opps = await db.opportunities.listByUser(userId, 200, 0);
    const activeCompanies = [...new Set(opps.filter(o => o.company && o.status !== 'lost').map(o => o.company))];

    if (activeCompanies.length < 3) {
      report.alerts.push({ type: 'info', message: 'Not enough company data for competitor analysis' });
      return report;
    }

    // Ask Claude to analyze the competitive landscape
    const prompt = `Analyze the competitive landscape for a company in "${profile.sector || 'B2B services'}".

Active client companies: ${activeCompanies.slice(0, 15).join(', ')}
Company description: ${profile.description || 'N/A'}
Value proposition: ${profile.value_prop || 'N/A'}

Based on these clients and the sector:
1. Identify likely competitors these clients might also be talking to
2. Suggest 3 competitive positioning angles
3. Identify potential objections related to competitors
4. Suggest trigger phrases that indicate a prospect is evaluating alternatives

Return JSON:
{
  "competitors": ["name1", "name2"],
  "positioningAngles": ["angle1", "angle2", "angle3"],
  "competitorObjections": ["objection1", "objection2"],
  "evaluationTriggers": ["trigger1", "trigger2"],
  "summary": "1-2 sentence summary"
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 1000, 'competitor_watch');
    const analysis = safeParseClaudeJSON(result, 'competitors');

    if (analysis) {
      // Store as memory patterns
      if (analysis.positioningAngles?.length > 0) {
        await db.memoryPatterns.replaceOrCreate({
          ...tenant,
          pattern: `Angles concurrentiels : ${analysis.positioningAngles.join(' | ')}`,
          category: 'Objection',
          data: JSON.stringify(analysis),
          confidence: 'Moyenne',
          sectors: [profile.sector || 'general'],
          targets: [],
        });
        report.insights++;
      }

      if (analysis.evaluationTriggers?.length > 0) {
        await db.memoryPatterns.replaceOrCreate({
          ...tenant,
          pattern: `Signaux d'\u00e9valuation : ${analysis.evaluationTriggers.join(' | ')}`,
          category: 'Cible',
          data: JSON.stringify({ triggers: analysis.evaluationTriggers }),
          confidence: 'Moyenne',
          sectors: [profile.sector || 'general'],
          targets: [],
        });
        report.insights++;
      }

      report.alerts.push({
        type: 'competitor_watch',
        severity: 'info',
        message: analysis.summary || `${analysis.competitors?.length || 0} competitors identified`,
        data: analysis,
      });
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('competitor-watch', err.message);
  }

  return report;
}

module.exports = { run };
