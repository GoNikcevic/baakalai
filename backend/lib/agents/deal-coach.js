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
const { getTimingContext, getCopyContext, getPatternContext, getTeamId } = require('../email-context');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { coached: 0, suggestions: [], errors: [] };

  try {
    const opps = await db.opportunities.listByUser(userId, 500, 0);
    const now = Date.now();

    // Find stagnant deals (open, no activity in 14+ days)
    // `updated_at` est réécrit à chaque synchro CRM (cf. churn-scoring.js) :
    // seul `last_activity_at` reflète la vraie dernière activité côté CRM.
    const stagnant = opps.filter(o => {
      if (o.status === 'won' || o.status === 'lost') return false;
      const age = (now - new Date(o.last_activity_at || o.created_at).getTime()) / DAY_MS;
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
        const daysSinceUpdate = Math.round((now - new Date(deal.last_activity_at || deal.created_at).getTime()) / DAY_MS);

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

/**
 * On-demand coaching + email draft for a SINGLE deal, combined into one Claude call
 * (used by the "Voir le mail" on-demand flow — no daily batch, no separate coach-then-draft
 * pass). Returns { opportunity, subject, body, reason, urgency } or { error }.
 */
async function coachAndDraftOne(userId, opportunityId) {
  const oppResult = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  const deal = oppResult.rows[0];
  if (!deal) return { error: 'not_found' };
  if (deal.status === 'won' || deal.status === 'lost') return { error: 'not_eligible' };
  if (!deal.email) return { error: 'no_email' };

  const [patterns, emails, teamId] = await Promise.all([
    db.memoryPatterns.list({ confidence: 'Haute', limit: 10 }),
    db.query(
      `SELECT to_email, subject, sentiment, status, created_at FROM nurture_emails
       WHERE user_id = $1 AND to_email = $2 AND created_at > now() - interval '60 days'
       ORDER BY created_at DESC`,
      [userId, deal.email]
    ),
    getTeamId(userId),
  ]);
  const [timing, copyCtx, patternCtx] = await Promise.all([
    getTimingContext(userId),
    getCopyContext(userId),
    getPatternContext(teamId, userId),
  ]);

  const contactEmails = emails.rows;
  const patternCtxText = patterns.map(p => `- ${p.pattern}`).join('\n');
  const daysSinceUpdate = Math.round((Date.now() - new Date(deal.last_activity_at || deal.created_at).getTime()) / DAY_MS);

  const prompt = `You are a B2B sales coach and copywriter. For this stagnant deal, decide the
best next action AND draft a personal reactivation email in one pass.

Contact: ${deal.name} (${deal.title || 'N/A'}) at ${deal.company || 'N/A'}
Status: ${deal.status || 'open'}
Days since last activity: ${daysSinceUpdate}
Churn risk score: ${deal.churn_score || 'N/A'}/100
Churn factors: ${formatChurnFactors(deal.churn_factors)}
Emails sent (60d): ${contactEmails.length}
Last email sentiment: ${contactEmails[0]?.sentiment || 'N/A'}

${patternCtxText ? `PATTERNS THAT WORK:\n${patternCtxText}` : ''}
${copyCtx ? `\nCOPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

RULES:
- "reason" explains briefly, in French, why this deal needs reactivating now
- Email: max 6 lines, must sound human and personal (NOT marketing)
- Tone: professional but warm — the goal is to re-engage, not to sell aggressively

Return JSON:
{ "reason": "...", "urgency": "high|medium|low", "subject": "...", "body": "..." }`;

  const result = await claude.callClaude('Return only valid JSON.', prompt, 600, 'deal_coach_draft_one');
  let draft = result.parsed;
  if (!draft) {
    const m = (result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (m) { try { draft = JSON.parse(m[0]); } catch { draft = null; } }
  }
  if (!draft?.subject || !draft?.body) return { error: 'generation_failed' };

  return {
    opportunity: deal,
    patternIds: patternCtx.ids,
    subject: draft.subject,
    body: draft.body,
    reason: draft.reason || '',
    urgency: draft.urgency || 'medium',
  };
}

module.exports = { run, coachAndDraftOne };
