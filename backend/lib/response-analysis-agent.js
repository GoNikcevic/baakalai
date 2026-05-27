/**
 * Response Analysis Agent
 *
 * Reads replies/activities from CRM (Pipedrive), analyzes them with Claude,
 * and tracks nurture campaign effectiveness.
 *
 * Flow:
 * 1. Fetch recent activities from Pipedrive (emails received, notes)
 * 2. Match to nurture emails we sent (by contact + time window)
 * 3. Claude analyzes each reply → sentiment, intent, suggested action
 * 4. Update opportunity status + score
 * 5. Score trigger effectiveness (which triggers produce results)
 * 6. Feed patterns into memory for future improvement
 *
 * Runs as part of the CRM Agent (after nurture step).
 */

const db = require('../db');
const { getUserKey } = require('../config');
const pipedrive = require('../api/pipedrive');
const claude = require('../api/claude');
const logger = require('./logger');

const DAY_MS = 86400000;

/**
 * Analyze responses for a user's nurture campaigns.
 */
async function analyzeResponses(userId) {
  const token = await getUserKey(userId, 'pipedrive');
  if (!token) return { analyzed: 0, positive: 0, negative: 0 };

  const report = { analyzed: 0, positive: 0, negative: 0, neutral: 0, actions: [] };

  // 1. Get nurture emails sent in the last 14 days
  const recentEmails = await db.query(
    `SELECT ne.*, o.name as contact_name, o.company, o.crm_contact_id, o.id as opp_id,
            nt.name as trigger_name, nt.trigger_type, nt.id as trigger_id
     FROM nurture_emails ne
     LEFT JOIN opportunities o ON o.id = ne.opportunity_id
     LEFT JOIN nurture_triggers nt ON nt.id = ne.trigger_id
     WHERE ne.user_id = $1 AND ne.status = 'sent'
       AND ne.sent_at > now() - interval '14 days'
       AND ne.analyzed_at IS NULL`,
    [userId]
  );

  if (recentEmails.rows.length === 0) return report;

  // 2. For each sent email, check if the contact has new activities in Pipedrive
  for (const email of recentEmails.rows) {
    if (!email.crm_contact_id) continue;

    try {
      const activities = await pipedrive.getActivities(token, parseInt(email.crm_contact_id, 10));

      // Find activities that happened AFTER our email was sent
      const sentAt = new Date(email.sent_at).getTime();
      const recentActivities = activities.filter(a => {
        const actDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        return actDate > sentAt && actDate < sentAt + 14 * DAY_MS;
      });

      if (recentActivities.length === 0) continue;

      // 3. Analyze each response with Claude
      const activityTexts = recentActivities
        .map(a => `[${a.type}] ${a.subject || ''} ${a.note || ''}`.trim())
        .filter(t => t.length > 10);

      if (activityTexts.length === 0) continue;

      const analysis = await analyzeWithClaude(email, activityTexts);
      report.analyzed++;

      if (analysis.sentiment === 'positive') report.positive++;
      else if (analysis.sentiment === 'negative') report.negative++;
      else report.neutral++;

      // 4. Update opportunity status based on analysis
      if (email.opp_id && analysis.suggestedStatus) {
        await db.opportunities.update(email.opp_id, {
          status: analysis.suggestedStatus,
        });
        report.actions.push({
          contact: email.contact_name,
          sentiment: analysis.sentiment,
          action: analysis.suggestedAction,
          newStatus: analysis.suggestedStatus,
        });
      }

      // 5. Log the analysis on the nurture email
      await db.query(
        `UPDATE nurture_emails SET analyzed_at = now(), crm_activity_id = $1 WHERE id = $2`,
        [JSON.stringify(analysis), email.id]
      );

      // 6-7. Score trigger + patterns (skip if already scored by real-time learning-signal)
      const alreadyScored = !!email.sentiment;
      if (!alreadyScored) {
        if (email.trigger_id && analysis.sentiment === 'positive') {
          await scoreTrigger(email.trigger_id, 'positive');
        } else if (email.trigger_id && analysis.sentiment === 'negative') {
          await scoreTrigger(email.trigger_id, 'negative');
        }

        if (email.pattern_ids && email.pattern_ids.length > 0) {
          await scorePatterns(email.pattern_ids, analysis.sentiment);
        }
      }

    } catch (err) {
      logger.warn('response-agent', `Failed for ${email.contact_name}: ${err.message}`);
    }
  }

  // ── LinkedIn response analysis ──
  try {
    const linkedinReplies = await db.query(
      `SELECT pa.*, o.id as opp_id, o.name as contact_name, o.company, o.status as opp_status
       FROM prospect_activities pa
       LEFT JOIN opportunities o ON o.email = pa.lead_email AND o.user_id = pa.user_id
       WHERE pa.user_id = $1
         AND pa.type IN ('linkedin_reply', 'linkedin_connect_accepted')
         AND pa.created_at > now() - interval '14 days'
         AND NOT EXISTS (
           SELECT 1 FROM prospect_activities pa2
           WHERE pa2.user_id = pa.user_id AND pa2.type = 'linkedin_analyzed'
             AND pa2.content::text LIKE '%' || pa.id::text || '%'
         )
       ORDER BY pa.created_at DESC LIMIT 20`,
      [userId]
    );

    for (const activity of linkedinReplies.rows) {
      try {
        const content = typeof activity.content === 'string' ? JSON.parse(activity.content) : (activity.content || {});

        if (activity.type === 'linkedin_connect_accepted') {
          // Connection accepted → positive signal
          report.analyzed++;
          report.positive++;

          if (activity.opp_id && activity.opp_status === 'imported') {
            await db.opportunities.update(activity.opp_id, { status: 'interested' });
          }

          report.actions.push({
            contact: activity.contact_name || content.name,
            sentiment: 'positive',
            action: 'LinkedIn connection accepted',
            channel: 'linkedin',
          });
        } else if (activity.type === 'linkedin_reply' && content.message) {
          // Message reply → analyze with Claude
          const analysis = await analyzeWithClaude(
            { contact_name: activity.contact_name || content.name, company: activity.company, subject: 'LinkedIn message', body: '' },
            [`[LinkedIn reply] ${content.message}`]
          );

          report.analyzed++;
          if (analysis.sentiment === 'positive') report.positive++;
          else if (analysis.sentiment === 'negative') report.negative++;
          else report.neutral++;

          if (activity.opp_id && analysis.suggestedStatus) {
            await db.opportunities.update(activity.opp_id, { status: analysis.suggestedStatus });
          }

          report.actions.push({
            contact: activity.contact_name || content.name,
            sentiment: analysis.sentiment,
            action: analysis.suggestedAction,
            channel: 'linkedin',
          });
        }

        // Mark as analyzed
        await db.query(
          `INSERT INTO prospect_activities (user_id, lead_email, type, content, source, created_at)
           VALUES ($1, $2, 'linkedin_analyzed', $3, 'response_agent', now())`,
          [userId, activity.lead_email, JSON.stringify({ activityId: activity.id, type: activity.type })]
        );
      } catch (err) {
        logger.warn('response-agent', `LinkedIn analysis failed for activity ${activity.id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.warn('response-agent', `LinkedIn response analysis failed: ${err.message}`);
  }

  // 8. If enough data, create memory pattern
  if (report.analyzed >= 5) {
    await createMemoryPattern(userId, report);
  }

  logger.info('response-agent', `User ${userId}: ${report.analyzed} analyzed, ${report.positive} positive, ${report.negative} negative`);
  return report;
}

/**
 * Ask Claude to analyze a reply in context of the email we sent.
 */
async function analyzeWithClaude(email, activityTexts) {
  const prompt = `Analyse cette r\u00E9ponse \u00E0 un email de relance B2B.

Email envoy\u00E9 :
- Objet : ${email.subject}
- Contenu : ${email.body?.slice(0, 300)}
- Contact : ${email.contact_name} (${email.company || ''})
- Trigger : ${email.trigger_name || email.trigger_type || 'manuel'}

R\u00E9ponse(s) d\u00E9tect\u00E9e(s) dans le CRM :
${activityTexts.join('\n')}

Analyse et retourne un JSON :
{
  "sentiment": "positive" | "negative" | "neutral",
  "intent": "interested" | "not_now" | "not_interested" | "unsubscribe" | "question" | "meeting_request",
  "confidence": 0.0-1.0,
  "suggestedAction": "description courte de l'action \u00E0 prendre",
  "suggestedStatus": "interested" | "meeting" | "won" | "lost" | null,
  "summary": "r\u00E9sum\u00E9 en 1 phrase"
}`;

  try {
    const result = await claude.callClaude(
      'Analyse des r\u00E9ponses email B2B. Retourne uniquement du JSON valide.',
      prompt,
      400
    );

    if (result.parsed) return result.parsed;

    const match = (result.content || '').match(/\{[\s\S]*"sentiment"[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fallback below */ }

  return {
    sentiment: 'neutral',
    intent: 'question',
    confidence: 0.3,
    suggestedAction: 'V\u00E9rifier manuellement',
    suggestedStatus: null,
    summary: 'Analyse automatique non disponible',
  };
}

/**
 * Score patterns that were used to generate an email, based on response sentiment.
 * Positive → increment confirmations. Negative after enough data → lower confidence.
 */
async function scorePatterns(patternIds, sentiment) {
  if (!patternIds || patternIds.length === 0) return;

  for (const patternId of patternIds) {
    try {
      const row = await db.query('SELECT id, confirmations, confidence, data FROM memory_patterns WHERE id = $1', [patternId]);
      if (!row.rows[0]) continue;
      const p = row.rows[0];
      const stats = (typeof p.data === 'string' ? JSON.parse(p.data) : p.data) || {};
      const effectiveness = stats._effectiveness || { positive: 0, negative: 0, total: 0 };

      if (sentiment === 'positive') {
        effectiveness.positive++;
        effectiveness.total++;
        // Boost confirmations + update last_confirmed_at
        await db.query(
          `UPDATE memory_patterns SET confirmations = COALESCE(confirmations, 0) + 1, last_confirmed_at = now(), data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(effectiveness), patternId]
        );
      } else if (sentiment === 'negative') {
        effectiveness.negative++;
        effectiveness.total++;
        await db.query(
          `UPDATE memory_patterns SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(effectiveness), patternId]
        );
        // After enough negative signal, downgrade confidence
        if (effectiveness.total >= 10 && effectiveness.negative / effectiveness.total >= 0.7) {
          const newConfidence = p.confidence === 'Haute' ? 'Moyenne' : 'Faible';
          if (newConfidence !== p.confidence) {
            await db.query('UPDATE memory_patterns SET confidence = $1 WHERE id = $2', [newConfidence, patternId]);
            logger.info('response-agent', `Pattern ${patternId} downgraded to ${newConfidence} (${effectiveness.negative}/${effectiveness.total} negative)`);
          }
        }
      } else {
        effectiveness.total++;
        await db.query(
          `UPDATE memory_patterns SET data = jsonb_set(COALESCE(data, '{}')::jsonb, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(effectiveness), patternId]
        );
      }
    } catch (err) {
      logger.warn('response-agent', `Pattern scoring failed for ${patternId}: ${err.message}`);
    }
  }
}

/**
 * Track trigger effectiveness over time.
 */
async function scoreTrigger(triggerId, outcome) {
  try {
    // Get current trigger stats
    const trigger = await db.query('SELECT conditions FROM nurture_triggers WHERE id = $1', [triggerId]);
    if (!trigger.rows[0]) return;

    const conditions = trigger.rows[0].conditions || {};
    const stats = conditions._effectiveness || { positive: 0, negative: 0, neutral: 0, total: 0 };

    stats[outcome] = (stats[outcome] || 0) + 1;
    stats.total = (stats.total || 0) + 1;
    stats.successRate = stats.total > 0 ? Math.round((stats.positive / stats.total) * 100) : 0;
    stats.lastUpdated = new Date().toISOString();

    await db.query(
      `UPDATE nurture_triggers SET conditions = jsonb_set(conditions, '{_effectiveness}', $1::jsonb) WHERE id = $2`,
      [JSON.stringify(stats), triggerId]
    );
  } catch (err) {
    logger.warn('response-agent', `Trigger scoring failed: ${err.message}`);
  }
}

/**
 * Create a memory pattern from accumulated response data.
 */
async function createMemoryPattern(userId, report) {
  if (report.analyzed < 5) return;

  const successRate = report.analyzed > 0
    ? Math.round((report.positive / report.analyzed) * 100)
    : 0;

  // Split actions by channel
  const emailActions = (report.actions || []).filter(a => !a.channel || a.channel === 'email');
  const linkedinActions = (report.actions || []).filter(a => a.channel === 'linkedin');

  // Email pattern
  if (emailActions.length >= 3) {
    const emailPositive = emailActions.filter(a => a.sentiment === 'positive').length;
    const emailRate = Math.round((emailPositive / emailActions.length) * 100);
    const emailPattern = emailRate >= 50
      ? `Les emails d'activation g\u00E9n\u00E8rent ${emailRate}% de r\u00E9ponses positives (${emailPositive}/${emailActions.length})`
      : `Les emails d'activation ont un taux de r\u00E9ponse positive de ${emailRate}% \u2014 envisager d'ajuster le ton ou le timing`;
    try {
      await db.memoryPatterns.replaceOrCreate(userId, {
        pattern: emailPattern,
        category: 'Corps',
        source: 'response_analysis_email',
        data: JSON.stringify({ source: 'response_analysis', channel: 'email', analyzed: emailActions.length, positive: emailPositive }),
        confidence: emailActions.length >= 15 ? 'Haute' : emailActions.length >= 8 ? 'Moyenne' : 'Faible',
      });
    } catch (err) {
      logger.warn('response-agent', `Email memory pattern failed: ${err.message}`);
    }
  }

  // LinkedIn pattern
  if (linkedinActions.length >= 3) {
    const liPositive = linkedinActions.filter(a => a.sentiment === 'positive').length;
    const liRate = Math.round((liPositive / linkedinActions.length) * 100);
    const connectAccepted = linkedinActions.filter(a => a.action?.includes('accepted')).length;
    const liPattern = liRate >= 50
      ? `LinkedIn : ${liRate}% de r\u00E9ponses positives (${liPositive}/${linkedinActions.length}). ${connectAccepted} connexions accept\u00E9es.`
      : `LinkedIn : taux de r\u00E9ponse positive ${liRate}%. ${connectAccepted} connexions accept\u00E9es sur ${linkedinActions.length} actions.`;
    try {
      await db.memoryPatterns.replaceOrCreate(userId, {
        pattern: liPattern,
        category: 'Canal',
        source: 'response_analysis_linkedin',
        data: JSON.stringify({ source: 'response_analysis', channel: 'linkedin', analyzed: linkedinActions.length, positive: liPositive, connectsAccepted: connectAccepted }),
        confidence: linkedinActions.length >= 15 ? 'Haute' : linkedinActions.length >= 8 ? 'Moyenne' : 'Faible',
      });
    } catch (err) {
      logger.warn('response-agent', `LinkedIn memory pattern failed: ${err.message}`);
    }
  }

  // Global pattern (backward compat)
  const pattern = successRate >= 50
    ? `Activation : ${successRate}% de r\u00E9ponses positives (${report.positive}/${report.analyzed}) — email + LinkedIn`
    : `Activation : taux de r\u00E9ponse positive de ${successRate}% (${report.positive}/${report.analyzed})`;
  try {
    await db.memoryPatterns.replaceOrCreate(userId, {
      pattern,
      category: 'Corps',
      source: 'response_analysis_global',
      data: JSON.stringify({ source: 'response_analysis', channel: 'all', analyzed: report.analyzed, positive: report.positive, negative: report.negative, neutral: report.neutral }),
      confidence: report.analyzed >= 20 ? 'Haute' : report.analyzed >= 10 ? 'Moyenne' : 'Faible',
    });
  } catch (err) {
    logger.warn('response-agent', `Global memory pattern failed: ${err.message}`);
  }
}

module.exports = { analyzeResponses };
