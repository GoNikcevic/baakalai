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
const { populationOf } = require('./crm-scope');
const { outcomeOf, instructionFor } = require('./reply-intents');
const { setPlannedFollowupDate } = require('./reactivation-queue');

// Garde-fou des conversations qui ne concluent pas. Les deux issues nettes ont
// leur propre sortie, sur l'intention détectée et non sur un compteur : une
// demande de RDV déclenche une proposition de créneaux puis l'arrêt, un refus
// coupe l'autopilot sur le contact. Le nombre de tours ne sert qu'au troisième
// cas · l'interlocuteur enchaîne les questions sans jamais dire oui ni non.
//
// Un TOUR = une réponse écrite par baakalai et réellement envoyée. Il n'est
// plus en dur : chaque portée porte le sien (arbitrage Goran du 2026-09-22),
// parce que répondre seul à un inconnu et répondre seul à un client qui paie
// n'engagent pas le même risque.
//
// « S'arrêter à la première réponse et rendre la main » ne s'exprime PAS par
// zéro tour mais en éteignant la portée : deux réglages pour une même chose
// obligeraient l'interface à les réconcilier, et l'un des deux finirait par
// mentir. Portée éteinte (défaut CRM) = alerte, et rien d'autre.
// Ces valeurs ne servent donc que quand la portée est allumée : 3 tours en
// prospection (qualifier puis rendre la main), 1 côté clients (prudence, la
// conversation appartient à l'humain).
const DEFAULT_MAX_TURNS = { prospection: 3, crm: 1 };
const TURNS_CEILING = 5;

/**
 * Profondeur retenue pour une portée. Bornée à TURNS_CEILING : un réglage
 * ancien ou fabriqué à la main ne doit pas autoriser une conversation sans fin.
 * Le minimum est 1, jamais 0 · « ne rien écrire » s'exprime en éteignant la
 * portée, sinon deux réglages diraient la même chose et l'un finirait par
 * mentir. Valeur absente ou illisible = le défaut de la portée.
 */
function clampTurns(value, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), TURNS_CEILING);
}
const MIN_DELAY_MS = 2 * 60 * 60 * 1000;  // 2 hours
const MAX_DELAY_MS = 4 * 60 * 60 * 1000;  // 4 hours
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_NOW_FOLLOWUP_DAYS = 21; // matches the "in a few weeks" wording used in the auto-reply

// Les issues de chaque intention sont déclarées une seule fois, dans
// lib/reply-intents.js · la même source que l'énumération du prompt d'analyse.

/**
 * Process a new reply and decide whether to auto-respond.
 * Called by response-analysis-agent after analyzing a reply.
 *
 * @param {string} userId
 * @param {object} opts - { opportunityId, email, contactName, company, replyContent, intent,
 *   sentiment, channel, enrollmentId } · enrollmentId borne le compteur de tours au workflow
 *   en cours (la campagne, elle, est lue sur le contact).
 * @returns {{ action: 'replied'|'scheduled'|'stopped'|'handoff', reason: string }}
 */
async function processReply(userId, opts) {
  const {
    opportunityId, email, contactName, company, replyContent, intent, sentiment, channel = 'email',
    // Conteneur de la conversation · borne le compteur de tours (migration 110).
    enrollmentId = null,
  } = opts;

  if (!opportunityId || !email) {
    return { action: 'skipped', reason: 'Missing opportunityId or email' };
  }

  // Le contact est chargé avant les réglages : c'est lui qui dit de quelle
  // population relève la conversation, donc quel interrupteur consulter.
  const opp = await db.query(
    'SELECT autopilot_enabled, status, campaign_id FROM opportunities WHERE id = $1 AND user_id = $2',
    [opportunityId, userId]
  );
  if (!opp.rows[0]) {
    return { action: 'skipped', reason: 'Unknown opportunity' };
  }

  const population = populationOf(opp.rows[0]);
  const settings = await getAutopilotSettings(userId);
  const autopilotOn = opp.rows[0].autopilot_enabled !== false && !!settings[population];
  const maxTurns = autopilotOn ? settings.maxTurns[population] : 0;
  const campaignId = opp.rows[0].campaign_id || null;

  // L'alerte part sur CHAQUE réponse, avant toute décision d'autopilot : c'est
  // le seul signal de l'utilisateur quand baakalai ne répond pas, et il doit
  // aussi savoir quand baakalai s'apprête à répondre pour pouvoir l'annuler
  // pendant les 2 à 4 heures d'attente.
  // Best-effort : une alerte en échec ne doit pas avaler la réponse.
  try {
    const { notifyReply } = require('./reply-alert');
    await notifyReply(userId, {
      opportunityId, contactName, company, email, replyContent, intent, channel, population,
      // Un refus met fin à l'échange quel que soit le réglage : la main revient
      // à l'utilisateur dans tous les cas.
      handedOver: !autopilotOn || outcomeOf(intent) === 'stop',
    });
  } catch (err) {
    logger.warn('autopilot', `Alerte de réponse non envoyée (${email}): ${err.message}`);
  }

  // Autopilot éteint = baakalai n'écrit rien et ne touche à rien. Le marquage
  // « perdu » sur un refus reste un geste automatique : il n'a lieu que si
  // l'utilisateur a accepté que l'IA agisse sur cette population.
  if (!autopilotOn) {
    await logConversation(userId, opportunityId, email, 'handoff', { intent, reason: 'autopilot_off' });
    return { action: 'handoff', reason: 'Autopilot off, conversation handed over' };
  }

  // Stop conditions
  if (outcomeOf(intent) === 'stop') {
    // A negative reply is a reasonable signal to mark a not-yet-won deal as lost, but it's an
    // inferred signal (sentiment on one email), not authoritative · it must never downgrade an
    // already-won client's status. Only the CRM's own native status is authoritative for that
    // (see crm-agent.js's deal sync). Stopping autopilot is always correct either way.
    const updates = { autopilot_enabled: false };
    if (opp.rows[0].status !== 'won') updates.status = 'lost';
    await db.opportunities.update(opportunityId, updates);
    await logConversation(userId, opportunityId, email, 'stop', { intent, reason: 'Negative intent detected' });
    return { action: 'stopped', reason: `Intent: ${intent}` };
  }

  // Success · meeting request detected
  if (outcomeOf(intent) === 'success') {
    // Generate meeting proposal reply
    const reply = await generateReply(userId, {
      contactName, company, email, replyContent, intent, channel,
      conversationHistory: await getConversationHistory(userId, email),
      instruction: instructionFor(intent),
    });

    await scheduleReply(userId, opportunityId, email, contactName, reply, channel, { campaignId, enrollmentId });
    await db.opportunities.update(opportunityId, { status: 'meeting' });
    await logConversation(userId, opportunityId, email, 'meeting_proposed', { reply });
    return { action: 'replied', reason: 'Meeting proposal sent' };
  }

  // Check turn count · borné au conteneur de la conversation (cette campagne,
  // ce workflow), pas à la vie entière de l'adresse : un prospect qui n'avait
  // pas répondu et qu'on relance dans une nouvelle campagne 60 jours plus tard
  // repartait sinon avec un compteur déjà épuisé.
  const turnCount = await getConversationTurnCount(userId, { opportunityId, campaignId, enrollmentId });
  if (turnCount >= maxTurns) {
    await logConversation(userId, opportunityId, email, 'handoff', { turns: turnCount, maxTurns });
    return { action: 'handoff', reason: `Max turns reached (${maxTurns})` };
  }

  // L'instruction vient de la déclaration de l'intention ; une valeur inconnue
  // retombe sur le repli, qui poursuit l'échange sans rien conclure.
  let instruction = instructionFor(intent);

  if (intent === 'not_now' && !opts.requestedFollowupDate) {
    // La réponse promet « dans quelques semaines » · on le planifie vraiment,
    // au lieu d'envoyer une politesse sans effet sur la file de réactivation.
    // Si l'appelant a déjà extrait une date précise de la réponse (cf.
    // response-analysis-agent.js), elle a déjà été posée et prime sur ce
    // repli générique · pas de re-planification qui l'écraserait.
    await setPlannedFollowupDate(userId, opportunityId, new Date(Date.now() + NOT_NOW_FOLLOWUP_DAYS * DAY_MS).toISOString(), {
      source: 'auto_email', reason: 'not_now',
    });
  }

  // Dernier tour autorisé : c'est maintenant ou jamais pour proposer le RDV.
  // Le seuil était en dur à 3, ce qui ne voulait plus rien dire une fois le
  // nombre de tours réglable · à 1 tour, l'unique réponse ne demandait jamais
  // le rendez-vous, et la main revenait sans rien avoir tenté.
  const lastTurn = turnCount + 1 >= maxTurns;
  if (lastTurn && intent !== 'not_now') {
    instruction += ' This is the last message before handing over to a human, propose a quick 15-minute call to discuss further.';
  }

  const reply = await generateReply(userId, {
    contactName, company, email, replyContent, intent, channel,
    conversationHistory: await getConversationHistory(userId, email),
    instruction,
  });

  await scheduleReply(userId, opportunityId, email, contactName, reply, channel, { campaignId, enrollmentId });
  await logConversation(userId, opportunityId, email, 'auto_reply', { intent, turn: turnCount + 1, maxTurns, reply });

  return { action: 'scheduled', reason: `Auto-reply scheduled (turn ${turnCount + 1}/${maxTurns})` };
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

  // Load relevant memory patterns, scoped to the tenant (user + ses équipes +
  // pool global partagé). L'ancienne requête `WHERE user_id = $1` levait
  // systématiquement avant la migration 089 (colonne inexistante) : ce contexte
  // n'était jamais injecté dans le prompt.
  let patternCtx = '';
  try {
    const patterns = await db.memoryPatterns.listForPrompt(5, null, userId);
    patternCtx = patterns.map(p => `- ${p.pattern}`).join('\n');
  } catch (err) {
    logger.warn('autopilot', `Memory patterns unavailable: ${err.message}`);
  }

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
${require('./human-style').HUMAN_STYLE_RULES_FR}

${channel === 'linkedin'
    ? 'Retourne un JSON : { "message": "..." }'
    : 'Retourne un JSON : { "subject": "Re: ...", "body": "..." }'}`;

  const result = await claude.callClaude(
    'Conversation de prospection B2B. Retourne uniquement du JSON valide.',
    prompt,
    600,
    'conversation_autopilot'
  );

  const { humanizeFields } = require('./human-style');
  if (result.parsed) return humanizeFields(result.parsed, ['subject', 'body', 'message']);

  const match = (result.raw || '').match(/\{[\s\S]*(?:"message"|"subject")[\s\S]*\}/);
  if (match) {
    try { return humanizeFields(JSON.parse(match[0]), ['subject', 'body', 'message']); } catch { /* fallthrough */ }
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
async function scheduleReply(userId, opportunityId, toEmail, toName, reply, channel, container = {}) {
  const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  const scheduledAt = new Date(Date.now() + delay);

  await db.query(`
    INSERT INTO autopilot_queue (user_id, opportunity_id, campaign_id, enrollment_id, to_email, to_name, channel, content, scheduled_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
  `, [
    userId, opportunityId, container.campaignId || null, container.enrollmentId || null,
    toEmail, toName, channel, JSON.stringify(reply), scheduledAt,
  ]);

  logger.info('autopilot', `Scheduled ${channel} reply to ${toName} at ${scheduledAt.toISOString()}`);
}

/**
 * Send all pending scheduled replies that are due.
 * Called by CRM agent or a dedicated cron.
 */
async function sendScheduledReplies() {
  const pending = await db.query(`
    SELECT aq.*, u.name as user_name, o.campaign_id
    FROM autopilot_queue aq
    JOIN users u ON u.id = aq.user_id
    LEFT JOIN opportunities o ON o.id = aq.opportunity_id
    WHERE aq.status = 'pending' AND aq.scheduled_at <= now()
    ORDER BY aq.scheduled_at
    LIMIT 20
    FOR UPDATE OF aq SKIP LOCKED
  `);

  // Une réponse reste 2 à 4h en file avant de partir. Sans cette vérification,
  // couper l'autopilot ne stoppait pas ce qui était déjà planifié : un
  // utilisateur qui l'éteint parce qu'il ne veut plus que l'IA parle à ses
  // clients voyait quand même partir les réponses des heures suivantes.
  // Le réglage est relu au moment d'envoyer, pas au moment de planifier.
  const settingsByUser = new Map();
  const scopeAllows = async (item) => {
    if (!settingsByUser.has(item.user_id)) {
      settingsByUser.set(item.user_id, await getAutopilotSettings(item.user_id));
    }
    return !!settingsByUser.get(item.user_id)[populationOf(item)];
  };

  let sent = 0;
  for (const item of pending.rows) {
    try {
      if (!await scopeAllows(item)) {
        await db.query(`UPDATE autopilot_queue SET status = 'cancelled' WHERE id = $1`, [item.id]);
        logger.info('autopilot', `reply ${item.id} annulée, portée ${populationOf(item)} désactivée entre-temps`);
        continue;
      }

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
 * Nombre de tours déjà joués dans CETTE conversation · un tour = une réponse
 * écrite par baakalai et réellement envoyée (les brouillons en file ne comptent
 * pas, ils sont encore annulables).
 *
 * Le conteneur borne le compteur : la campagne de prospection, ou le workflow
 * CRM. Relancer un prospect dans une nouvelle campagne rouvre donc un compteur
 * neuf, ce qui n'était pas le cas quand il se comptait par adresse email sur
 * toute la vie du compte. Hors campagne et hors workflow (relance CRM issue
 * d'une règle), il retombe sur le contact, ce qui reste la bonne unité.
 */
async function getConversationTurnCount(userId, { opportunityId, campaignId = null, enrollmentId = null }) {
  const scope = enrollmentId
    ? { clause: 'AND enrollment_id = $3', value: enrollmentId }
    : campaignId
      ? { clause: 'AND campaign_id = $3', value: campaignId }
      : null;

  const params = [userId, opportunityId];
  if (scope) params.push(scope.value);

  const result = await db.query(
    `SELECT COUNT(*) as count FROM autopilot_queue
     WHERE user_id = $1 AND opportunity_id = $2 AND status = 'sent' ${scope ? scope.clause : ''}`,
    params
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

  // Bascule depuis l'ancien interrupteur unique `autopilot_enabled`, qui
  // commandait les deux populations à la fois. Un « oui » historique portait
  // sur la prospection · c'est le seul cas que l'UI décrivait · et ne doit
  // surtout pas se transformer en autorisation de répondre tout seul dans une
  // conversation client en cours. En cas de doute, la portée CRM reste fermée.
  const legacy = settings.autopilot_enabled ?? false;

  return {
    prospection: settings.autopilot_prospection_enabled ?? legacy,
    crm: settings.autopilot_crm_enabled ?? false,
    maxTurns: {
      prospection: clampTurns(settings.autopilot_prospection_max_turns, DEFAULT_MAX_TURNS.prospection),
      crm: clampTurns(settings.autopilot_crm_max_turns, DEFAULT_MAX_TURNS.crm),
    },
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

module.exports = {
  processReply,
  sendScheduledReplies,
  getAutopilotSettings,
  getConversationHistory,
  clampTurns,
  TURNS_CEILING,
  DEFAULT_MAX_TURNS,
};
