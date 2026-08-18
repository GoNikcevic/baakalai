/**
 * Conversation Autopilot
 *
 * Manages prospecting conversations autonomously until:
 * - A meeting is proposed AND accepted → STOP (success)
 * - Prospect says not_interested or unsubscribe → STOP (lost)
 * - Max turns reached (5) → STOP (hand off to human)
 * - User manually takes over → STOP
 *
 * Flow:
 * 1. Reply detected (email or LinkedIn) → intent analyzed
 * 2. If autopilot enabled for this opportunity → generate contextual reply
 * 3. Schedule reply with human-like delay (2-4h)
 * 4. Send via user's email/LinkedIn
 * 5. Track conversation state
 * 6. Repeat until stop condition
 *
 * Safety:
 * - Max 5 autopilot turns per conversation
 * - Min 2h delay between replies (human-like)
 * - User always CC'd (BCC) on emails
 * - Conversation history preserved for context
 * - User can disable per-opportunity or globally
 */

const db = require('../db');
const claude = require('../api/claude');
const { sendNurtureEmail } = require('./email-outbound');
const logger = require('./logger');

const MAX_TURNS = 5;
const MIN_DELAY_MS = 2 * 60 * 60 * 1000;  // 2 hours
const MAX_DELAY_MS = 4 * 60 * 60 * 1000;  // 4 hours
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_NOW_FOLLOWUP_DAYS = 21; // matches the "in a few weeks" wording used in the auto-reply

// Intents that stop the autopilot
const STOP_INTENTS = ['not_interested', 'unsubscribe'];
const SUCCESS_INTENTS = ['meeting_request'];

/**
 * Process a new reply and decide whether to auto-respond.
 * Called by response-analysis-agent after analyzing a reply.
 *
 * @param {string} userId
 * @param {object} opts - { opportunityId, email, contactName, company, replyContent, intent, sentiment, channel }
 * @returns {{ action: 'replied'|'scheduled'|'stopped'|'handoff', reason: string }}
 */
async function processReply(userId, opts) {
  const { opportunityId, email, contactName, company, replyContent, intent, sentiment, channel = 'email' } = opts;

  if (!opportunityId || !email) {
    return { action: 'skipped', reason: 'Missing opportunityId or email' };
  }

  // Check if autopilot is enabled for this user
  const settings = await getAutopilotSettings(userId);
  if (!settings.enabled) {
    return { action: 'skipped', reason: 'Autopilot disabled' };
  }

  // Check if this opportunity has autopilot disabled
  const opp = await db.query('SELECT autopilot_enabled, status FROM opportunities WHERE id = $1 AND user_id = $2', [opportunityId, userId]);
  if (!opp.rows[0] || opp.rows[0].autopilot_enabled === false) {
    return { action: 'skipped', reason: 'Autopilot disabled for this contact' };
  }

  // Stop conditions
  if (STOP_INTENTS.includes(intent)) {
    // A negative reply is a reasonable signal to mark a not-yet-won deal as lost, but it's an
    // inferred signal (sentiment on one email), not authoritative — it must never downgrade an
    // already-won client's status. Only the CRM's own native status is authoritative for that
    // (see crm-agent.js's deal sync). Stopping autopilot is always correct either way.
    const updates = { autopilot_enabled: false };
    if (opp.rows[0].status !== 'won') updates.status = 'lost';
    await db.opportunities.update(opportunityId, updates);
    await logConversation(userId, opportunityId, email, 'stop', { intent, reason: 'Negative intent detected' });
    return { action: 'stopped', reason: `Intent: ${intent}` };
  }

  // Success — meeting request detected
  if (SUCCESS_INTENTS.includes(intent)) {
    // Generate meeting proposal reply
    const reply = await generateReply(userId, {
      contactName, company, email, replyContent, intent, channel,
      conversationHistory: await getConversationHistory(userId, email),
      instruction: 'The prospect wants a meeting. Propose 2-3 specific time slots this week or next week. Be enthusiastic but professional.',
    });

    await scheduleReply(userId, opportunityId, email, contactName, reply, channel);
    await db.opportunities.update(opportunityId, { status: 'meeting' });
    await logConversation(userId, opportunityId, email, 'meeting_proposed', { reply });
    return { action: 'replied', reason: 'Meeting proposal sent' };
  }

  // Check turn count
  const turnCount = await getConversationTurnCount(userId, email);
  if (turnCount >= MAX_TURNS) {
    await logConversation(userId, opportunityId, email, 'handoff', { turns: turnCount });
    return { action: 'handoff', reason: `Max turns reached (${MAX_TURNS})` };
  }

  // Generate contextual reply based on intent
  let instruction;
  switch (intent) {
    case 'interested':
      instruction = 'The prospect is interested. Ask a qualifying question about their needs/timeline, and subtly steer toward a meeting. Do NOT propose a meeting yet if this is turn 1-2.';
      break;
    case 'question':
      instruction = 'The prospect has a question. Answer it concisely and professionally based on context. Then ask a follow-up question to keep the conversation going.';
      break;
    case 'not_now':
      instruction = 'The prospect says not now. Acknowledge respectfully, offer to follow up in a few weeks, and ask when would be a better time.';
      // The reply promises "a few weeks" — actually schedule that, instead of just
      // sending a polite auto-reply with no structural effect on the reactivation queue.
      await db.opportunities.update(opportunityId, {
        planned_followup_date: new Date(Date.now() + NOT_NOW_FOLLOWUP_DAYS * DAY_MS).toISOString(),
        planned_followup_reason: 'not_now',
      });
      break;
    default:
      instruction = 'Continue the conversation naturally. Be helpful and professional. Try to understand their needs and move toward a meeting.';
  }

  // If we're at turn 3+, push toward meeting
  if (turnCount >= 3 && intent !== 'not_now') {
    instruction += ' We have been exchanging for a while — propose a quick 15-minute call to discuss further.';
  }

  const reply = await generateReply(userId, {
    contactName, company, email, replyContent, intent, channel,
    conversationHistory: await getConversationHistory(userId, email),
    instruction,
  });

  await scheduleReply(userId, opportunityId, email, contactName, reply, channel);
  await logConversation(userId, opportunityId, email, 'auto_reply', { intent, turn: turnCount + 1, reply });

  return { action: 'scheduled', reason: `Auto-reply scheduled (turn ${turnCount + 1}/${MAX_TURNS})` };
}

/**
 * Generate a contextual reply using Claude with full conversation history.
 */
async function generateReply(userId, opts) {
  const { contactName, company, email, replyContent, intent, channel, conversationHistory, instruction } = opts;

  // Load user profile for personalization
  const user = await db.query('SELECT name, company FROM users WHERE id = $1', [userId]);
  const userName = user.rows[0]?.name || 'Moi';
  const userCompany = user.rows[0]?.company || '';

  // Load relevant memory patterns
  const patterns = await db.query(
    `SELECT pattern FROM memory_patterns WHERE user_id = $1 AND confidence IN ('Haute', 'Moyenne') ORDER BY confirmations DESC LIMIT 5`,
    [userId]
  );
  const patternCtx = patterns.rows.map(p => `- ${p.pattern}`).join('\n');

  const historyText = (conversationHistory || [])
    .slice(-6) // last 6 messages for context
    .map(h => `[${h.from}] ${h.content.slice(0, 300)}`)
    .join('\n\n');

  const prompt = `Tu es ${userName} de ${userCompany}. Tu mènes une conversation de prospection B2B ${channel === 'linkedin' ? 'sur LinkedIn' : 'par email'}.

PROSPECT : ${contactName} chez ${company || 'N/A'}
INTENT DÉTECTÉ : ${intent}

HISTORIQUE DE LA CONVERSATION :
${historyText || '(Premier échange)'}

DERNIER MESSAGE DU PROSPECT :
${replyContent}

PATTERNS QUI FONCTIONNENT :
${patternCtx || '(Pas encore de patterns)'}

INSTRUCTIONS : ${instruction}

RÈGLES :
- Écris comme un humain, pas comme un bot
- Court (3-5 phrases max)
- Pas de formules marketing
- Tutoyer si le prospect tutoie, sinon vouvoyer
- ${channel === 'linkedin' ? 'Format message LinkedIn (pas de subject)' : 'Format email avec subject et body'}
- Langue : détecter la langue du prospect et répondre dans la même langue

${channel === 'linkedin'
    ? 'Retourne un JSON : { "message": "..." }'
    : 'Retourne un JSON : { "subject": "Re: ...", "body": "..." }'}`;

  const result = await claude.callClaude(
    'Conversation de prospection B2B. Retourne uniquement du JSON valide.',
    prompt,
    600,
    'conversation_autopilot'
  );

  if (result.parsed) return result.parsed;

  const match = (result.raw || '').match(/\{[\s\S]*(?:"message"|"subject")[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fallthrough */ }
  }

  // Fallback
  if (channel === 'linkedin') {
    return { message: `Merci ${contactName.split(' ')[0]}, je vous reviens rapidement.` };
  }
  return { subject: `Re: ${contactName}`, body: `Bonjour ${contactName.split(' ')[0]},\n\nMerci pour votre retour. Je vous reviens rapidement.\n\nCordialement` };
}

/**
 * Schedule a reply with a human-like delay.
 */
async function scheduleReply(userId, opportunityId, toEmail, toName, reply, channel) {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  const scheduledAt = new Date(Date.now() + delay);

  await db.query(`
    INSERT INTO autopilot_queue (user_id, opportunity_id, to_email, to_name, channel, content, scheduled_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
  `, [userId, opportunityId, toEmail, toName, channel, JSON.stringify(reply), scheduledAt]);

  logger.info('autopilot', `Scheduled ${channel} reply to ${toName} at ${scheduledAt.toISOString()}`);
}

/**
 * Send all pending scheduled replies that are due.
 * Called by CRM agent or a dedicated cron.
 */
async function sendScheduledReplies() {
  const pending = await db.query(`
    SELECT aq.*, u.name as user_name
    FROM autopilot_queue aq
    JOIN users u ON u.id = aq.user_id
    WHERE aq.status = 'pending' AND aq.scheduled_at <= now()
    ORDER BY aq.scheduled_at
    LIMIT 20
    FOR UPDATE OF aq SKIP LOCKED
  `);

  let sent = 0;
  for (const item of pending.rows) {
    try {
      const content = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;

      if (item.channel === 'linkedin') {
        // Send LinkedIn message
        const { getUserKey } = require('../config');
        const cookie = await getUserKey(item.user_id, 'linkedin');
        if (cookie) {
          const linkedin = require('../api/linkedin');
          const opp = await db.query('SELECT linkedin_url FROM opportunities WHERE id = $1', [item.opportunity_id]);
          const publicId = opp.rows[0]?.linkedin_url?.match(/\/in\/([^/?]+)/)?.[1];
          if (publicId) {
            await linkedin.sendMessage(cookie, { recipientUrn: publicId, message: content.message }, item.user_id);
          }
        }
      } else {
        // Send email
        await sendNurtureEmail(item.user_id, {
          opportunityId: item.opportunity_id,
          to: item.to_email,
          toName: item.to_name,
          subject: content.subject,
          body: content.body,
        });
      }

      // Mark as sent
      await db.query('UPDATE autopilot_queue SET status = $1, sent_at = now() WHERE id = $2', ['sent', item.id]);

      // Log in prospect_activities
      await db.query(
        `INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
         VALUES ($1, $2, $3, $4, 'autopilot', now())`,
        [item.user_id, item.to_email,
          item.channel === 'linkedin' ? 'linkedin_message_sent' : 'email_autopilot_sent',
          item.content]
      );

      sent++;
    } catch (err) {
      await db.query('UPDATE autopilot_queue SET status = $1 WHERE id = $2', ['failed', item.id]);
      logger.error('autopilot', `Failed to send to ${item.to_email}: ${err.message}`);
    }
  }

  return { sent, total: pending.rows.length };
}

/**
 * Get conversation history for a contact (emails + LinkedIn messages).
 */
async function getConversationHistory(userId, email) {
  const activities = await db.query(`
    SELECT type, content, source, created_at
    FROM prospect_activities
    WHERE user_id = $1 AND lead_email = $2
      AND type IN ('email_autopilot_sent', 'linkedin_message_sent', 'linkedin_reply', 'emailsReplied')
    ORDER BY created_at DESC LIMIT 10
  `, [userId, email]);

  // Also get nurture emails sent to this contact
  const emails = await db.query(`
    SELECT subject, body, sent_at
    FROM nurture_emails
    WHERE user_id = $1 AND to_email = $2 AND status = 'sent'
    ORDER BY sent_at DESC LIMIT 5
  `, [userId, email]);

  const history = [];

  for (const e of emails.rows) {
    history.push({
      from: 'me',
      content: `[Email] Objet: ${e.subject}\n${e.body}`,
      date: e.sent_at,
    });
  }

  for (const a of activities.rows) {
    const content = typeof a.content === 'string' ? (() => { try { return JSON.parse(a.content); } catch { return { message: a.content }; } })() : (a.content || {});
    const isFromMe = a.type.includes('sent') || a.type.includes('autopilot');
    history.push({
      from: isFromMe ? 'me' : 'prospect',
      content: content.message || content.body || content.extractedText || JSON.stringify(content).slice(0, 300),
      date: a.created_at,
    });
  }

  return history.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Count autopilot turns for a conversation.
 */
async function getConversationTurnCount(userId, email) {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM autopilot_queue WHERE user_id = $1 AND to_email = $2 AND status = 'sent'`,
    [userId, email]
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}

/**
 * Get autopilot settings for a user.
 */
async function getAutopilotSettings(userId) {
  const result = await db.query(
    `SELECT settings FROM users WHERE id = $1`,
    [userId]
  );
  const settings = result.rows[0]?.settings || {};
  return {
    enabled: settings.autopilot_enabled ?? false,
    maxTurns: settings.autopilot_max_turns ?? MAX_TURNS,
    channels: settings.autopilot_channels ?? ['email', 'linkedin'],
  };
}

/**
 * Log a conversation event.
 */
async function logConversation(userId, opportunityId, email, event, data) {
  await db.query(
    `INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
     VALUES ($1, $2, $3, $4, 'autopilot', now())`,
    [userId, email, `autopilot_${event}`, JSON.stringify({ opportunityId, ...data })]
  );
}

module.exports = { processReply, sendScheduledReplies, getAutopilotSettings, getConversationHistory };
