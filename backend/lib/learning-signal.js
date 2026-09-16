/**
 * Learning Signal · Real-time pattern & trigger feedback
 *
 * Called immediately when a signal is detected (reply, bounce, deal won/lost).
 * No Claude API calls · pure DB updates for instant feedback.
 *
 * Signals:
 * - positive_reply: prospect replied positively (from activity sync or webhook)
 * - negative_reply: prospect replied negatively / unsubscribed
 * - bounce: email bounced
 * - deal_won: deal status changed to won
 * - deal_lost: deal status changed to lost
 */

const db = require('../db');
const logger = require('./logger');

/**
 * Process a learning signal for a contact's email.
 * Finds the most recent nurture_email sent to this contact and scores its patterns + trigger.
 *
 * @param {string} userId
 * @param {string} contactEmail
 * @param {'positive_reply'|'negative_reply'|'bounce'|'deal_won'|'deal_lost'} signalType
 */
async function processSignal(userId, contactEmail, signalType) {
  if (!userId || !contactEmail || !signalType) return;

  try {
    // Find the most recent nurture email sent to this contact (last 30 days)
    const result = await db.query(
      `SELECT id, trigger_id, pattern_ids, sentiment
       FROM nurture_emails
       WHERE user_id = $1 AND LOWER(to_email) = $2 AND status = 'sent'
         AND sent_at > now() - interval '30 days'
         AND sentiment IS NULL
       ORDER BY sent_at DESC LIMIT 1`,
      [userId, contactEmail.toLowerCase()]
    );

    const email = result.rows[0];
    if (!email) return;

    const sentiment = signalToSentiment(signalType);

    // 1. Mark the email with sentiment + replied_at
    await db.query(
      `UPDATE nurture_emails SET sentiment = $1, replied_at = now() WHERE id = $2`,
      [sentiment, email.id]
    );

    // 2. Score the trigger that generated this email
    if (email.trigger_id) {
      await scoreTriggerLive(email.trigger_id, sentiment);
    }

    // 3. Score the patterns that influenced this email
    if (email.pattern_ids && email.pattern_ids.length > 0) {
      await scorePatternsLive(email.pattern_ids, sentiment);
    }

    logger.info('learning-signal', `${signalType} for ${contactEmail} → scored ${email.pattern_ids?.length || 0} patterns`);
  } catch (err) {
    logger.warn('learning-signal', `Failed for ${contactEmail}: ${err.message}`);
  }
}

/**
 * Map signal type to sentiment.
 */
function signalToSentiment(signalType) {
  switch (signalType) {
    case 'positive_reply':
    case 'deal_won':
      return 'positive';
    case 'negative_reply':
    case 'deal_lost':
      return 'negative';
    case 'bounce':
      return 'negative';
    default:
      return 'neutral';
  }
}

/**
 * Update trigger effectiveness immediately (same logic as response-analysis-agent but inline).
 */
async function scoreTriggerLive(triggerId, sentiment) {
  try {
    const trigger = await db.query('SELECT conditions FROM nurture_triggers WHERE id = $1', [triggerId]);
    if (!trigger.rows[0]) return;

    const conditions = trigger.rows[0].conditions || {};
    const stats = conditions._effectiveness || { positive: 0, negative: 0, neutral: 0, total: 0 };

    stats[sentiment] = (stats[sentiment] || 0) + 1;
    stats.total = (stats.total || 0) + 1;
    stats.successRate = stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0;
    stats.lastUpdated = new Date().toISOString();

    await db.query(
      `UPDATE nurture_triggers SET conditions = jsonb_set(conditions, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(stats), triggerId]
    );
  } catch (err) {
    logger.warn('learning-signal', `Trigger scoring failed: ${err.message}`);
  }
}

/**
 * Update pattern effectiveness immediately. Batch update to minimize queries.
 */
async function scorePatternsLive(patternIds, sentiment) {
  if (!patternIds || patternIds.length === 0) return;

  // Batch: fetch all patterns at once
  const rows = await db.query(
    'SELECT id, confirmations, confidence, data FROM memory_patterns WHERE id = ANY($1)',
    [patternIds]
  );

  for (const p of rows.rows) {
    try {
      const stats = (typeof p.data === 'string' ? JSON.parse(p.data) : p.data) || {};
      const effectiveness = stats._effectiveness || { positive: 0, negative: 0, total: 0 };

      effectiveness[sentiment] = (effectiveness[sentiment] || 0) + 1;
      effectiveness.total++;

      if (sentiment === 'positive') {
        await db.query(
          `UPDATE memory_patterns SET confirmations = COALESCE(confirmations, 0) + 1, last_confirmed_at = now(), data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(effectiveness), p.id]
        );
      } else {
        await db.query(
          `UPDATE memory_patterns SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(effectiveness), p.id]
        );

        // Downgrade confidence if too many negatives
        if (effectiveness.total >= 10 && (effectiveness.negative || 0) / effectiveness.total >= 0.7) {
          const newConfidence = p.confidence === 'Haute' ? 'Moyenne' : 'Faible';
          if (newConfidence !== p.confidence) {
            await db.query('UPDATE memory_patterns SET confidence = $1 WHERE id = $2', [newConfidence, p.id]);
            logger.info('learning-signal', `Pattern ${p.id} downgraded to ${newConfidence}`);
          }
        }
      }
    } catch (err) {
      logger.warn('learning-signal', `Pattern ${p.id} scoring failed: ${err.message}`);
    }
  }
}

module.exports = { processSignal };
