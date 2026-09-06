/**
 * LinkedIn Outreach Agent
 *
 * Automates LinkedIn outreach from detected signals:
 * 1. Enriches signal contacts via LinkedIn profile visit
 * 2. Sends personalized connection requests
 * 3. Follows up with a message after connection accepted
 *
 * Respects LinkedIn limits:
 * - Max 30 connections/day, 50 profile views/day, 20 messages/day
 * - Human-like delays (3-8 sec between actions)
 * - Warm-up: first 7 days = 50% of limits
 *
 * Requires: li_at cookie stored in user_integrations
 */

const db = require('../../db');
const linkedin = require('../../api/linkedin');
const claude = require('../../api/claude');
const logger = require('../logger');

const DAY_MS = 86400000;

/**
 * Run LinkedIn outreach for a user's pending signals.
 */
async function run(userId) {
  const report = { enriched: 0, connectionsSent: 0, messagesSent: 0, errors: [] };

  try {
    // Get LinkedIn cookie
    const { getUserKey } = require('../../config');
    const cookie = await getUserKey(userId, 'linkedin');
    if (!cookie) return report; // No LinkedIn connected

    // Check warm-up period (first 7 days = reduced limits)
    const integration = await db.query(
      `SELECT created_at FROM user_integrations WHERE user_id = $1 AND provider = 'linkedin'`, [userId]
    );
    const daysActive = integration.rows[0]
      ? (Date.now() - new Date(integration.rows[0].created_at).getTime()) / DAY_MS
      : 0;
    const warmupMultiplier = daysActive < 7 ? 0.5 : 1;

    // ── Step 1: Enrich pending signals that have no LinkedIn data ──
    const signalsToEnrich = await db.query(
      `SELECT id, company_name, contact_name, contact_title FROM signals
       WHERE user_id = $1 AND status = 'new' AND contact_linkedin IS NULL AND company_name IS NOT NULL
       ORDER BY relevance_score DESC LIMIT ${Math.floor(10 * warmupMultiplier)}`,
      [userId]
    );

    for (const signal of signalsToEnrich.rows) {
      try {
        const searchResults = await linkedin.searchPeople(cookie, {
          keywords: `${signal.contact_name || ''} ${signal.company_name || ''}`.trim(),
          title: signal.contact_title,
          limit: 1,
        }, userId);

        if (searchResults.length > 0) {
          const match = searchResults[0];
          await db.query(
            `UPDATE signals SET contact_name = COALESCE(contact_name, $1), contact_title = COALESCE(contact_title, $2), contact_linkedin = $3 WHERE id = $4`,
            [match.name, match.title, match.profileUrl, signal.id]
          );
          report.enriched++;
        }
      } catch (err) {
        if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') break;
        report.errors.push(`Enrich ${signal.company_name}: ${err.message}`);
      }
    }

    // ── Step 2: Send connection requests for actioned signals ──
    const signalsForOutreach = await db.query(
      `SELECT s.id, s.title AS signal_title, s.description AS signal_desc, s.signal_type,
              s.contact_name, s.contact_title, s.contact_linkedin, s.company_name
       FROM signals s
       WHERE s.user_id = $1 AND s.status = 'actioned' AND s.action_taken = 'add_to_crm'
         AND s.contact_linkedin IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM linkedin_outreach lo WHERE lo.signal_id = s.id AND lo.type = 'connection')
       ORDER BY s.relevance_score DESC LIMIT ${Math.floor(5 * warmupMultiplier)}`,
      [userId]
    );

    for (const signal of signalsForOutreach.rows) {
      try {
        // Generate personalized connection note via Claude
        const notePrompt = `Write a LinkedIn connection request note (max 280 chars) based on this signal.

Signal: ${signal.signal_title}
Context: ${signal.signal_desc || ''}
Contact: ${signal.contact_name} (${signal.contact_title || ''}) at ${signal.company_name || ''}
Signal type: ${signal.signal_type}

Rules:
- Reference the signal naturally (don't say "I saw a signal")
- Be specific and relevant
- End with curiosity or value, not a pitch
- Max 280 characters
- Language: match the contact's likely language (French if French name, English otherwise)

Return JSON: { "note": "..." }`;

        const result = await claude.callClaude('Return only valid JSON.', notePrompt, 300, 'linkedin_note');
        let note = result.parsed?.note;
        if (!note) {
          const m = (result.raw || '').match(/"note"\s*:\s*"([^"]+)"/);
          if (m) note = m[1];
        }
        if (!note) {
          const firstName = (signal.contact_name || '').split(' ')[0];
          const isFrench = /^[A-ZÀ-Ö][a-zà-ö]+(?: [A-ZÀ-Ö][a-zà-ö]+)*$/.test(signal.contact_name || '') && /[àâéèêëïîôùûüÿçœæ]/i.test(signal.contact_name || '');
          note = isFrench
            ? `Bonjour ${firstName}, votre profil a retenu mon attention. Curieux d'échanger.`
            : `Hi ${firstName}, your profile caught my attention. Would love to connect.`;
        }

        // Extract public ID from LinkedIn URL
        const publicId = signal.contact_linkedin.match(/\/in\/([^/?]+)/)?.[1];
        if (!publicId) continue;

        await linkedin.sendConnectionRequest(cookie, {
          profileUrn: publicId,
          message: note.slice(0, 300),
        }, userId);

        // Log the outreach
        await db.query(
          `INSERT INTO linkedin_outreach (user_id, signal_id, type, linkedin_url, message, status)
           VALUES ($1, $2, 'connection', $3, $4, 'sent')`,
          [userId, signal.id, signal.contact_linkedin, note]
        );

        report.connectionsSent++;
      } catch (err) {
        if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') break;
        report.errors.push(`Connection ${signal.contact_name}: ${err.message}`);
      }
    }

    // ── Step 3: Follow up with message for accepted connections (J+2) ──
    const pendingFollowups = await db.query(
      `SELECT lo.id, lo.signal_id, lo.linkedin_url, lo.message AS connection_note,
              s.title AS signal_title, s.description AS signal_desc, s.contact_name, s.contact_title, s.company_name
       FROM linkedin_outreach lo
       JOIN signals s ON s.id = lo.signal_id
       WHERE lo.user_id = $1 AND lo.type = 'connection' AND lo.status = 'sent'
         AND lo.created_at < now() - interval '2 days'
         AND NOT EXISTS (SELECT 1 FROM linkedin_outreach lo2 WHERE lo2.signal_id = lo.signal_id AND lo2.type = 'message')
       LIMIT ${Math.floor(5 * warmupMultiplier)}`,
      [userId]
    );

    for (const followup of pendingFollowups.rows) {
      try {
        // Generate follow-up message
        const msgPrompt = `Write a LinkedIn follow-up message (after connection accepted).

Context: We connected because of this signal: ${followup.signal_title}
Contact: ${followup.contact_name} (${followup.contact_title || ''}) at ${followup.company_name || ''}
Connection note was: "${followup.connection_note}"

Rules:
- Thank for accepting
- Expand briefly on the signal context
- Propose a specific value or question
- 3-4 sentences max
- Natural, not salesy

Return JSON: { "message": "..." }`;

        const result = await claude.callClaude('Return only valid JSON.', msgPrompt, 400, 'linkedin_followup');
        let message = result.parsed?.message;
        if (!message) {
          const m = (result.raw || '').match(/"message"\s*:\s*"([^"]+)"/);
          if (m) message = m[1];
        }
        if (!message) continue;

        const publicId = followup.linkedin_url.match(/\/in\/([^/?]+)/)?.[1];
        if (!publicId) continue;

        await linkedin.sendMessage(cookie, {
          recipientUrn: publicId,
          message,
        }, userId);

        await db.query(
          `INSERT INTO linkedin_outreach (user_id, signal_id, type, linkedin_url, message, status)
           VALUES ($1, $2, 'message', $3, $4, 'sent')`,
          [userId, followup.signal_id, followup.linkedin_url, message]
        );

        // Update connection status
        await db.query(`UPDATE linkedin_outreach SET status = 'followed_up' WHERE id = $1`, [followup.id]);

        report.messagesSent++;
      } catch (err) {
        if (err.code === 'RATE_LIMITED' || err.code === 'SESSION_EXPIRED') break;
        report.errors.push(`Message ${followup.contact_name}: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('linkedin-outreach', err.message);
  }

  if (report.enriched + report.connectionsSent + report.messagesSent > 0) {
    logger.info('linkedin-outreach', `User ${userId}: ${report.enriched} enriched, ${report.connectionsSent} connections, ${report.messagesSent} messages`);
  }

  return report;
}

module.exports = { run };
