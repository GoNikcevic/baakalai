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
const { onlyCrmContacts } = require('../crm-scope');
const { getStagnantDays } = require('../stagnation');
const { safeParseClaudeJSON } = require('../utils/safe-json-parse');
const { getTimingContext, getCopyContext, getPatternContext, getTeamId } = require('../email-context');

const DAY_MS = 86400000;

async function run(userId) {
  const report = { coached: 0, suggestions: [], errors: [] };

  try {
    // Contacts CRM uniquement : les prospects froids d'une campagne de
    // prospection ne sont pas des deals à coacher (cf. lib/crm-scope.js).
    const opps = onlyCrmContacts(await db.opportunities.listByUser(userId, 500, 0));
    const now = Date.now();

    // Deals stagnants, au seuil choisi par l'utilisateur (cf. lib/stagnation.js) —
    // le même que celui de la file de réactivation, qui coachait auparavant sur
    // 14 jours en dur pendant que l'Activation en retenait 30.
    // `updated_at` est réécrit à chaque synchro CRM (cf. churn-scoring.js) :
    // seul `last_activity_at` reflète la vraie dernière activité côté CRM.
    const stagnantDays = await getStagnantDays(userId);
    const stagnant = opps.filter(o => {
      if (o.status === 'won' || o.status === 'lost') return false;
      const age = (now - new Date(o.last_activity_at || o.created_at).getTime()) / DAY_MS;
      return age >= stagnantDays;
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

/**
 * Workflow de relance multicanal pour UN deal (phase 2 enrollments).
 * Même assemblage de contexte que coachAndDraftOne, mais le modèle produit un
 * plan complet : 4-6 steps email/LinkedIn étalés sur ~2 semaines, avec une
 * bifurcation « si l'invitation LinkedIn est acceptée » exécutable par le
 * moteur natif (migration 103). Le résultat est un BROUILLON — rien ne part
 * sans approbation explicite de l'utilisateur.
 * Returns { reason, urgency, steps, patternIds } ou { error }.
 */
async function proposeWorkflow(userId, opportunityId, goal = 'reactivation') {
  const oppResult = await db.query(
    'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  const deal = oppResult.rows[0];
  if (!deal) return { error: 'not_found' };
  if (deal.status === 'won' && goal === 'reactivation') return { error: 'not_eligible' };
  if (deal.status === 'lost') return { error: 'not_eligible' };
  if (!deal.email && !deal.linkedin_url) return { error: 'no_channel' };

  const [patterns, emails, teamId] = await Promise.all([
    db.memoryPatterns.list({ confidence: 'Haute', limit: 10 }),
    deal.email
      ? db.query(
          `SELECT to_email, subject, sentiment, status, created_at FROM nurture_emails
           WHERE user_id = $1 AND to_email = $2 AND created_at > now() - interval '60 days'
           ORDER BY created_at DESC`,
          [userId, deal.email]
        )
      : Promise.resolve({ rows: [] }),
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
  const hasEmail = !!deal.email;
  const hasLinkedin = !!deal.linkedin_url;

  const goalBrief = {
    reactivation: 'Réactiver un deal dormant : recréer le dialogue, comprendre le blocage, obtenir une réponse.',
    upsell: 'Proposer une extension à un client existant : partir de la valeur déjà livrée, jamais agressif.',
    churn_prevention: 'Retenir un client à risque : prendre des nouvelles sincèrement, détecter le problème avant la résiliation.',
  }[goal] || 'Réactiver la relation.';

  const prompt = `You are a B2B sales coach and copywriter. Design a complete multichannel
follow-up workflow for this CRM contact — an existing relationship, NOT a cold prospect.

GOAL: ${goalBrief}

Contact: ${deal.name} (${deal.title || 'N/A'}) at ${deal.company || 'N/A'}
Deal status: ${deal.status || 'open'}${deal.deal_value ? ` — value ${deal.deal_value} €` : ''}
Days since last activity: ${daysSinceUpdate}
Churn risk score: ${deal.churn_score || 'N/A'}/100
Churn factors: ${formatChurnFactors(deal.churn_factors)}
Emails sent (60d): ${contactEmails.length}
Last email sentiment: ${contactEmails[0]?.sentiment || 'N/A'}
Channels available: ${hasEmail ? 'email' : ''}${hasEmail && hasLinkedin ? ' + ' : ''}${hasLinkedin ? 'LinkedIn' : ''}

${patternCtxText ? `PATTERNS THAT WORK:\n${patternCtxText}` : ''}
${copyCtx ? `\nCOPY PATTERNS THAT WORK:\n${copyCtx}` : ''}
${patternCtx.text ? `\nMEMORY PATTERNS:\n${patternCtx.text}` : ''}
${timing.bestDay ? `\nBEST SEND TIMING: ${timing.bestDay}${timing.bestHour != null ? ` at ${timing.bestHour}h` : ''}` : ''}

RULES:
- 4 to 6 steps over 10-15 days. "timing" is "J+N" = N days AFTER the PREVIOUS step (J+0 for the first).
- Types: "email", "linkedin_visit", "linkedin_invite", "linkedin_message".${hasLinkedin ? '' : ' NO LinkedIn steps — this contact has no LinkedIn URL.'}${hasEmail ? '' : ' NO email steps — this contact has no email address.'}
- Everything the contact reads is in FRENCH. Emails max 6 lines, human and personal (NOT marketing). This person KNOWS the sender — reference the existing relationship, never introduce yourself like a stranger.
- linkedin_visit: no subject, no body. linkedin_invite: no subject, body max 300 characters, warm note (no pitch).
- ${hasEmail && hasLinkedin ? 'If you include a linkedin_invite, give it EXACTLY two children: one with conditionType "accepted" (a linkedin_message continuing the conversation) and one with conditionType "not_accepted" (an email taking a different angle). Steps after the fork go back to the top-level array.' : 'No conditional branches (single channel).'}
- "reason": 2-3 French sentences explaining WHY this plan for THIS deal (cite the signals: dormancy, opens, patterns). Shown to the user before approval.

Return JSON:
{
  "reason": "...",
  "urgency": "high|medium|low",
  "steps": [
    { "step": "E1", "type": "email", "timing": "J+0", "subject": "...", "body": "..." },
    { "step": "LI1", "type": "linkedin_invite", "timing": "J+3", "body": "...",
      "children": [
        { "step": "LM1", "type": "linkedin_message", "timing": "J+2", "conditionType": "accepted", "branchLabel": "Si accepté", "body": "..." },
        { "step": "E2", "type": "email", "timing": "J+4", "conditionType": "not_accepted", "branchLabel": "Si pas de réponse", "subject": "...", "body": "..." }
      ] }
  ]
}`;

  const result = await claude.callClaude('Return only valid JSON.', prompt, 2000, 'workflow_proposal');
  let plan = result.parsed;
  if (!plan) {
    const m = (result.raw || '').match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (m) { try { plan = JSON.parse(m[0]); } catch { plan = null; } }
  }
  if (!Array.isArray(plan?.steps) || plan.steps.length === 0) return { error: 'generation_failed' };

  // Filet : retirer les steps sur un canal indisponible (le modèle respecte
  // presque toujours la consigne, mais un step email vers un contact sans
  // email serait skippé en boucle par le moteur).
  const channelOk = (tp) => (tp.type === 'email' ? hasEmail : hasLinkedin);
  const filterSteps = (steps) => steps
    .filter(channelOk)
    .map(tp => ({ ...tp, children: Array.isArray(tp.children) ? filterSteps(tp.children) : [] }));
  const steps = filterSteps(plan.steps);
  if (steps.length === 0) return { error: 'generation_failed' };

  return {
    opportunity: deal,
    patternIds: patternCtx.ids,
    reason: plan.reason || '',
    urgency: plan.urgency || 'medium',
    steps,
  };
}

module.exports = { run, coachAndDraftOne, proposeWorkflow };
