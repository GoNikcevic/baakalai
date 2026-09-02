/**
 * ICP Refiner Agent
 *
 * Automatically refines the Ideal Customer Profile based on accumulated data:
 * - Which company sizes convert best
 * - Which job titles respond most
 * - Which sectors have highest win rates
 * - Which sources (Lemlist, Apollo, CRM) produce best leads
 *
 * Outputs: updated ICP recommendations + memory patterns
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');

async function run(userId) {
  const report = { insights: 0, icp: null, errors: [] };

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
    if (opps.length < 20) {
      report.icp = 'Need 20+ contacts for ICP analysis';
      return report;
    }

    const won = opps.filter(o => o.status === 'won');
    const lost = opps.filter(o => o.status === 'lost');
    const total = opps.length;

    // Analyze by company size
    const bySizeWon = groupBy(won, 'company_size');
    const bySizeAll = groupBy(opps, 'company_size');

    // Analyze by title/persona
    const byTitleWon = groupBy(won, 'title');
    const byTitleAll = groupBy(opps, 'title');

    // Analyze by sector (from company or product line)
    const bySectorWon = groupBy(won, 'company');
    const bySectorAll = groupBy(opps, 'company');

    // Load user profile
    const profileRes = await db.query(`SELECT profile_data FROM users WHERE id = $1`, [userId]);
    const profile = profileRes.rows[0]?.profile_data || {};

    const prompt = `Analyze this B2B contact database to refine the Ideal Customer Profile (ICP).

OVERALL: ${total} contacts, ${won.length} won, ${lost.length} lost, ${opps.length - won.length - lost.length} in pipeline

WINS BY COMPANY SIZE:
${formatGroupStats(bySizeWon, bySizeAll)}

WINS BY JOB TITLE:
${formatGroupStats(byTitleWon, byTitleAll)}

TOP COMPANIES (won):
${won.slice(0, 10).map(o => `- ${o.name} (${o.title || 'N/A'}) @ ${o.company || 'N/A'} [${o.company_size || 'N/A'}]`).join('\n')}

Current ICP settings:
- Target sectors: ${profile.target_sectors || 'N/A'}
- Target size: ${profile.target_size || 'N/A'}
- Primary persona: ${profile.persona_primary || 'N/A'}

Based on actual results, refine the ICP. Return JSON:
{
  "idealSize": "recommended company size range",
  "idealPersona": "recommended primary job title/role",
  "idealSectors": ["sector1", "sector2"],
  "surprises": ["unexpected finding 1"],
  "recommendations": ["actionable change 1", "actionable change 2"],
  "summary": "1-2 sentence ICP summary"
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 800, 'icp_refiner');
    const analysis = safeParseClaudeJSON(result, 'idealSize');

    if (analysis) {
      report.icp = analysis;

      // Store as memory pattern
      await db.memoryPatterns.replaceOrCreate({
        ...tenant,
        pattern: `ICP refin\u00e9 : ${analysis.summary}`,
        category: 'Cible',
        data: JSON.stringify(analysis),
        confidence: won.length >= 10 ? 'Haute' : 'Moyenne',
        sectors: analysis.idealSectors || [],
        targets: analysis.idealPersona ? [analysis.idealPersona] : [],
      });
      report.insights++;

      if (analysis.surprises?.length > 0) {
        for (const surprise of analysis.surprises) {
          await db.memoryPatterns.replaceOrCreate({
            ...tenant,
            pattern: `ICP surprise : ${surprise}`,
            category: 'Cible',
            data: JSON.stringify({ type: 'icp_surprise' }),
            confidence: 'Moyenne',
            sectors: [], targets: [],
          });
          report.insights++;
        }
      }

      logger.info('icp-refiner', `ICP refined: ${analysis.summary}`);
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('icp-refiner', err.message);
  }

  return report;
}

function groupBy(items, field) {
  const groups = {};
  for (const item of items) {
    const key = item[field] || 'unknown';
    groups[key] = (groups[key] || 0) + 1;
  }
  return groups;
}

function formatGroupStats(wonGroups, allGroups) {
  return Object.entries(wonGroups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => {
      const total = allGroups[key] || count;
      const rate = Math.round((count / total) * 100);
      return `- "${key}": ${count} won / ${total} total (${rate}%)`;
    })
    .join('\n') || '- Not enough data';
}

module.exports = { run };
