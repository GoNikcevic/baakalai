/**
 * LinkedIn Response Sync
 *
 * Detects connection acceptances and message replies from LinkedIn.
 * Stores in prospect_activities for memory/learning pipeline.
 *
 * Flow:
 * 1. Check sent invitations → find accepted ones → log linkedin_connect_accepted
 * 2. Check conversations → find replies to our messages → log linkedin_reply
 * 3. Feed into response-analysis-agent for sentiment/intent analysis
 *
 * Called by CRM agent daily sync or on-demand.
 */

const db = require('../db');
const linkedin = require('../api/linkedin');
const { getUserKey } = require('../config');
const logger = require('./logger');

/**
 * Sync LinkedIn responses for a user.
 * Returns { connectionsAccepted, repliesFound, errors }
 */
async function syncLinkedInResponses(userId) {
  const report = { connectionsAccepted: 0, repliesFound: 0, errors: [] };

  const cookie = await getUserKey(userId, 'linkedin');
  if (!cookie) return report;

  try {
    // ── 1. Check accepted connections ──
    await syncAcceptedConnections(userId, cookie, report);
  } catch (err) {
    if (err.code === 'SESSION_EXPIRED') {
      report.errors.push('LinkedIn session expired');
      return report;
    }
    report.errors.push(`Connections sync: ${err.message}`);
  }

  try {
    // ── 2. Check message replies ──
    await syncMessageReplies(userId, cookie, report);
  } catch (err) {
    report.errors.push(`Messages sync: ${err.message}`);
  }

  if (report.connectionsAccepted > 0 || report.repliesFound > 0) {
    logger.info('linkedin-sync', `User ${userId}: ${report.connectionsAccepted} connections accepted, ${report.repliesFound} replies`);
  }

  return report;
}

/**
 * Check sent invitations, find accepted ones, log to prospect_activities.
 */
async function syncAcceptedConnections(userId, cookie, report) {
  const invitations = await linkedin.getSentInvitations(cookie, { count: 50 });

  // Get our tracked outreach (connections sent via nurture or linkedin-outreach)
  const tracked = await db.query(
    `SELECT DISTINCT lead_email, content FROM prospect_activities
     WHERE user_id = $1 AND type = 'linkedin_connect_sent'
     AND created_at > now() - interval '30 days'`,
    [userId]
  );

  // Also check linkedin_outreach table
  const outreach = await db.query(
    `SELECT lo.linkedin_url, lo.status, s.contact_name, lo.signal_id
     FROM linkedin_outreach lo
     LEFT JOIN signals s ON s.id = lo.signal_id
     WHERE lo.user_id = $1 AND lo.type = 'connection' AND lo.status = 'sent'
     AND lo.created_at > now() - interval '30 days'`,
    [userId]
  );

  // Build a set of LinkedIn URLs we've contacted
  const sentUrls = new Set();
  for (const row of outreach.rows) {
    if (row.linkedin_url) sentUrls.add(row.linkedin_url.toLowerCase());
  }
  for (const row of tracked.rows) {
    try {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      if (content?.linkedin_url) sentUrls.add(content.linkedin_url.toLowerCase());
    } catch { /* skip */ }
  }

  // Check which invitations were accepted
  for (const inv of invitations) {
    if (inv.status !== 'ACCEPTED' || !inv.toProfileUrl) continue;
    const url = inv.toProfileUrl.toLowerCase();

    if (!sentUrls.has(url)) continue;

    // Check if we already logged this acceptance
    const existing = await db.query(
      `SELECT id FROM prospect_activities
       WHERE user_id = $1 AND type = 'linkedin_connect_accepted'
       AND content::text LIKE $2
       LIMIT 1`,
      [userId, `%${inv.toPublicId || inv.toProfileUrl}%`]
    );
    if (existing.rows.length > 0) continue;

    // Find the contact email from opportunities or outreach
    const opp = await db.query(
      `SELECT email, name FROM opportunities WHERE user_id = $1 AND linkedin_url ILIKE $2 LIMIT 1`,
      [userId, `%${inv.toPublicId}%`]
    );
    const email = opp.rows[0]?.email || null;

    // Log accepted connection
    await db.query(
      `INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
       VALUES ($1, $2, 'linkedin_connect_accepted', $3, 'linkedin_sync', now())`,
      [userId, email, JSON.stringify({
        linkedin_url: inv.toProfileUrl,
        publicId: inv.toPublicId,
        name: inv.toName,
        acceptedAt: inv.sentAt,
      })]
    );

    // Update linkedin_outreach status
    if (inv.toProfileUrl) {
      await db.query(
        `UPDATE linkedin_outreach SET status = 'accepted' WHERE user_id = $1 AND linkedin_url = $2 AND type = 'connection' AND status = 'sent'`,
        [userId, inv.toProfileUrl]
      ).catch(() => {});
    }

    report.connectionsAccepted++;
  }
}

/**
 * Check conversations for replies to our messages, log to prospect_activities.
 */
async function syncMessageReplies(userId, cookie, report) {
  const conversations = await linkedin.getConversations(cookie, { count: 20 });

  // Get messages we sent recently
  const sentMessages = await db.query(
    `SELECT lead_email, content FROM prospect_activities
     WHERE user_id = $1 AND type = 'linkedin_message_sent'
     AND created_at > now() - interval '14 days'`,
    [userId]
  );

  // Build set of publicIds we've messaged
  const messagedIds = new Map(); // publicId → lead_email
  for (const row of sentMessages.rows) {
    try {
      const content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      if (content?.publicId) messagedIds.set(content.publicId, row.lead_email);
    } catch { /* skip */ }
  }

  // Also check linkedin_outreach message records
  const outreachMsgs = await db.query(
    `SELECT lo.linkedin_url, s.contact_name
     FROM linkedin_outreach lo
     LEFT JOIN signals s ON s.id = lo.signal_id
     WHERE lo.user_id = $1 AND lo.type = 'message' AND lo.status = 'sent'
     AND lo.created_at > now() - interval '14 days'`,
    [userId]
  );
  for (const row of outreachMsgs.rows) {
    const pid = row.linkedin_url?.match(/\/in\/([^/?]+)/)?.[1];
    if (pid) messagedIds.set(pid, null);
  }

  for (const conv of conversations) {
    // Skip if last message is from us
    if (conv.lastMessageFromSelf) continue;
    if (!conv.lastMessageBody || conv.lastMessageBody.length < 3) continue;

    // Check if any participant matches someone we messaged
    for (const participant of conv.participants) {
      if (!participant.publicId || !messagedIds.has(participant.publicId)) continue;

      // Check if we already logged this reply
      const existing = await db.query(
        `SELECT id FROM prospect_activities
         WHERE user_id = $1 AND type = 'linkedin_reply'
         AND content::text LIKE $2
         AND created_at > now() - interval '1 day'
         LIMIT 1`,
        [userId, `%${participant.publicId}%`]
      );
      if (existing.rows.length > 0) continue;

      const email = messagedIds.get(participant.publicId);

      await db.query(
        `INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
         VALUES ($1, $2, 'linkedin_reply', $3, 'linkedin_sync', now())`,
        [userId, email, JSON.stringify({
          publicId: participant.publicId,
          name: participant.name,
          message: conv.lastMessageBody,
          conversationId: conv.conversationId,
          repliedAt: conv.lastMessageAt,
        })]
      );

      report.repliesFound++;
      break; // one reply per conversation
    }
  }
}

module.exports = { syncLinkedInResponses };
