/**
 * Deal Coach Agent
 *
 * Analyzes stagnant deals and suggests the next best action:
 * - Email, call, special offer, content share, intro request
 * - Based on: deal age, sector, persona, past interactions, memory patterns
 *
 * Outputs: actionable suggestions per stagnant deal
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { coached: 0, suggestions: [], errors: [] };

  try {
    const opps = await db.opportunities.listByUser(userId, 500, 0);
    const now = Date.now();

    // Find stagnant deals (open, not updated in 14+ days)
    const stagnant = opps.filter(o => {
      if (o.status === 'won' || o.status === 'lost') return false;
      const age = (now - new Date(o.updated_at || o.created_at).getTime()) / DAY_MS;
      return age >= 14;
    });

    if (stagnant.length === 0) return report;

    // Load memory patterns for context
    const patterns = await db.memoryPatterns.list({ confidence: 'Haute', limit: 10 });
    const patternCtx = patterns.map(p => `- ${p.pattern}`).join('\n');

    // Load recent emails for these contacts
    const emails = await db.query(
      `SELECT to_email, subject, sentiment, status, created_at FROM nurture_emails
       WHERE user_id = $1 AND created_at > now() - interval '60 days'
       ORDER BY created_at DESC`,
      [userId]
    );
    const emailsByContact = new Map();
    for (const e of emails.rows) {
      const key = e.to_email?.toLowerCase();
      if (!emailsByContact.has(key)) emailsByContact.set(key, []);
      emailsByContact.get(key).push(e);
    }

    // Coach top 10 stagnant deals
    const toCoach = stagnant
      .sort((a, b) => (b.churn_score || 0) - (a.churn_score || 0))
      .slice(0, 10);

    for (const deal of toCoach) {
      try {
        const contactEmails = emailsByContact.get(deal.email?.toLowerCase()) || [];
        const daysSinceUpdate = Math.round((now - new Date(deal.updated_at || deal.created_at).getTime()) / DAY_MS);

        const prompt = `You are a B2B sales coach. Suggest the next best action for this stagnant deal.

Contact: ${deal.name} (${deal.title || 'N/A'}) at ${deal.company || 'N/A'}
Status: ${deal.status || 'open'}
Days since last activity: ${daysSinceUpdate}
Churn risk score: ${deal.churn_score || 'N/A'}/100
Churn factors: ${formatChurnFactors(deal.churn_factors)}
Emails sent: ${contactEmails.length}
Last email sentiment: ${contactEmails[0]?.sentiment || 'N/A'}

${patternCtx ? `PATTERNS THAT WORK:\n${patternCtx}` : ''}

Suggest ONE specific action. Return JSON:
{
  "action": "email|call|linkedin|content|intro|offer",
  "reason": "Why this action now",
  "suggestion": "Specific message or approach (2-3 sentences)",
  "urgency": "high|medium|low"
}`;

        const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'deal_coach');
        const coaching = safeParseClaudeJSON(result, 'action');

        if (coaching) {
          report.suggestions.push({
            contactId: deal.id,
            contactName: deal.name,
            company: deal.company,
            ...coaching,
          });
          report.coached++;
        } else {
          // Sans cette branche, un deal dont la reponse etait illisible
          // disparaissait du rapport sans laisser de trace : `coached: 3` sur
          // 10 deals avec `errors: []` se lisait comme "7 deals n'avaient rien
          // a signaler", alors que 7 appels avaient echoue au parsing.
          report.errors.push(`${deal.name}: reponse Claude non parsable`);
        }
      } catch (err) {
        report.errors.push(`${deal.name}: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('deal-coach', err.message);
  }

  return report;
}

function formatChurnFactors(raw) {
  try {
    const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(f) ? f.map(x => x.detail).join(', ') : 'N/A';
  } catch {
    return 'N/A';
  }
}

module.exports = { run };
