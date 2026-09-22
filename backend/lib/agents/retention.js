/**
 * Retention Agent · brouillon de rétention pour un client à risque de churn.
 *
 * Existait en creux : toute relance d'un contact gagné passait par
 * upsell-detector.draftOne, dont le prompt impose « naturally introduce the
 * upsell/cross-sell value proposition ». Proposer une extension à un client
 * qui a un pied dehors est exactement le mauvais email. Ici on prend des
 * nouvelles et on cherche le problème : aucune offre, aucun devis, aucune
 * mention du score.
 *
 * Returns { opportunity, patternIds, subject, body } ou { error }.
 */

const db = require('../../db');
const claude = require('../../api/claude');
const { getTimingContext, getCopyContext, getPatternContext, getTeamId } = require('../email-context');
const { HUMAN_STYLE_RULES, humanize } = require('../human-style');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');

const DAY_MS = 86400000;

function formatChurnFactors(raw) {
  try {
    const f = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(f) && f.length > 0 ? f.map(x => x.detail).join(', ') : 'N/A';
  } catch {
    return 'N/A';
  }
}

async function draftOne(userId, opportunityId, { angle } = {}) {
  const oppResult = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  const opp = oppResult.rows[0];
  if (!opp) return { error: 'not_found' };
  // La rétention ne parle qu'aux clients : un deal ouvert se réactive
  // (deal-coach), il ne se retient pas.
  if (opp.status !== 'won') return { error: 'not_eligible' };
  if (!opp.email) return { error: 'no_email' };

  const teamId = await getTeamId(userId);
  const [timing, copyCtx, patternCtx, history] = await Promise.all([
    getTimingContext(userId),
    getCopyContext(userId),
    getPatternContext(teamId, userId),
    db.query(
      `SELECT subject, sentiment, status, created_at FROM nurture_emails
       WHERE user_id = $1 AND to_email = $2 AND created_at > now() - interval '90 days'
       ORDER BY created_at DESC LIMIT 5`,
      [userId, opp.email]
    ),
  ]);

  const contactEmails = history.rows;
  // Même ancrage que le scoring : last_activity_at, jamais updated_at que la
  // synchro CRM réécrit à chaque passage (cf. lib/churn-scoring.js).
  const silentDays = Math.round(
    (Date.now() - new Date(opp.last_activity_at || opp.created_at).getTime()) / DAY_MS
  );

  const prompt = `Write a retention email to an EXISTING CLIENT who shows signs of disengagement.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Client (won deal)${opp.deal_value ? `, contract value ${opp.deal_value} €` : ''}
- Days since last activity: ${silentDays}
- Churn risk score: ${opp.churn_score != null ? `${opp.churn_score}/100` : 'N/A'}
- Warning signals detected: ${formatChurnFactors(opp.churn_factors)}
- Emails sent (90d): ${contactEmails.length}, last sentiment: ${contactEmails[0]?.sentiment || 'N/A'}

${copyCtx ? `COPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

${angle ? `ANGLE IMPOSÉ PAR L'UTILISATEUR (non négociable, construis l'email autour de ça) : ${angle}\n` : ''}
RULES:
- Max 6 lines, in French, must sound human and personal
- This person is a client and knows the sender : reference the existing relationship, never introduce yourself
- Goal is to reopen the dialogue and surface the problem, nothing else
- Sell NOTHING : no upsell, no cross-sell, no new offer, no quote, no renewal pitch
- Ask one open question that is easy to answer honestly (how things are going, what is missing)
- Never mention the churn score, the warning signals, or any automated system
- Never guilt-trip about the silence ("on ne vous entend plus", "cela fait longtemps que")
${HUMAN_STYLE_RULES}

Return JSON: { "subject": "...", "body": "..." }`;

  const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'retention_draft_one');
  const email = safeParseClaudeJSON(result, 'subject');
  if (!email?.subject || !email?.body) return { error: 'generation_failed' };

  return {
    opportunity: opp,
    patternIds: patternCtx.ids,
    subject: humanize(email.subject),
    body: humanize(email.body),
  };
}

module.exports = { draftOne };
