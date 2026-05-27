/**
 * Copy Optimizer Agent
 *
 * Analyzes sent emails vs response rates to identify:
 * - Subject lines that work (high open/reply) vs don't
 * - Email length sweet spot
 * - Tone/formality that resonates
 * - Words/phrases that correlate with positive responses
 *
 * Outputs: memory patterns + refined prompt guidelines
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');

async function run(userId) {
  const report = { insights: 0, optimizations: [], errors: [] };

  try {
    // Load sent emails with outcomes
    const emails = await db.query(`
      SELECT subject, body, sentiment, status, replied_at,
             LENGTH(body) as body_length
      FROM nurture_emails
      WHERE user_id = $1 AND status = 'sent' AND sent_at IS NOT NULL
      ORDER BY sent_at DESC LIMIT 300
    `, [userId]);

    const rows = emails.rows;
    if (rows.length < 15) {
      report.optimizations.push('Need 15+ sent emails for copy analysis');
      return report;
    }

    const replied = rows.filter(r => r.replied_at || r.sentiment === 'positive');
    const ignored = rows.filter(r => !r.replied_at && r.sentiment !== 'positive');

    // Analyze email length
    const repliedLengths = replied.map(r => r.body_length);
    const ignoredLengths = ignored.map(r => r.body_length);
    const avgRepliedLen = repliedLengths.length > 0 ? Math.round(repliedLengths.reduce((a, b) => a + b, 0) / repliedLengths.length) : 0;
    const avgIgnoredLen = ignoredLengths.length > 0 ? Math.round(ignoredLengths.reduce((a, b) => a + b, 0) / ignoredLengths.length) : 0;

    if (avgRepliedLen > 0 && avgIgnoredLen > 0) {
      const lenInsight = avgRepliedLen < avgIgnoredLen
        ? `Les emails courts performent mieux (${avgRepliedLen} car. vs ${avgIgnoredLen} car. pour les ignor\u00e9s)`
        : `Les emails d\u00e9taill\u00e9s performent mieux (${avgRepliedLen} car. vs ${avgIgnoredLen} car.)`;
      report.optimizations.push(lenInsight);

      await db.memoryPatterns.replaceOrCreate({
        pattern: `Copy: longueur optimale ~${avgRepliedLen} caract\u00e8res (emails avec r\u00e9ponse)`,
        category: 'S\u00e9quence',
        data: JSON.stringify({ avgRepliedLen, avgIgnoredLen, sampleSize: rows.length }),
        confidence: rows.length >= 50 ? 'Haute' : 'Moyenne',
        sectors: [], targets: [],
      });
      report.insights++;
    }

    // Ask Claude to analyze subject lines and copy patterns
    const sampleReplied = replied.slice(0, 10).map(r => `[REPLIED] Subject: "${r.subject}" | Body (${r.body_length} chars): "${(r.body || '').slice(0, 100)}..."`);
    const sampleIgnored = ignored.slice(0, 10).map(r => `[IGNORED] Subject: "${r.subject}" | Body (${r.body_length} chars): "${(r.body || '').slice(0, 100)}..."`);

    const prompt = `Analyze these B2B outreach emails. Some got replies, others were ignored.

EMAILS THAT GOT REPLIES:
${sampleReplied.join('\n')}

EMAILS THAT WERE IGNORED:
${sampleIgnored.join('\n')}

Identify:
1. What makes subject lines work (patterns in successful ones)
2. Opening line patterns that drive replies
3. Tone differences between replied vs ignored
4. Any words or phrases that appear more in successful emails

Return JSON:
{
  "subjectPatterns": ["pattern1", "pattern2"],
  "openingPatterns": ["pattern1", "pattern2"],
  "toneInsight": "...",
  "wordsToUse": ["word1", "word2"],
  "wordsToAvoid": ["word1", "word2"],
  "summary": "1-sentence optimization guideline"
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 800, 'copy_optimizer');
    let analysis = result.parsed;
    if (!analysis) {
      const m = (result.content || '').match(/\{[\s\S]*"subjectPatterns"[\s\S]*\}/);
      if (m) analysis = JSON.parse(m[0]);
    }

    if (analysis) {
      if (analysis.subjectPatterns?.length > 0) {
        await db.memoryPatterns.replaceOrCreate({
          pattern: `Sujets efficaces : ${analysis.subjectPatterns.join(' | ')}`,
          category: 'S\u00e9quence',
          data: JSON.stringify(analysis),
          confidence: replied.length >= 10 ? 'Haute' : 'Moyenne',
          sectors: [], targets: [],
        });
        report.insights++;
      }

      if (analysis.wordsToAvoid?.length > 0) {
        report.optimizations.push(`Mots \u00e0 \u00e9viter : ${analysis.wordsToAvoid.join(', ')}`);
      }
      if (analysis.summary) {
        report.optimizations.push(analysis.summary);
      }

      logger.info('copy-optimizer', `${report.insights} insights from ${rows.length} emails`);
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('copy-optimizer', err.message);
  }

  // ── LinkedIn copy analysis ──
  try {
    const liActions = await db.query(`
      SELECT pa.content, pa.type, pa.created_at,
             (SELECT pa2.type FROM prospect_activities pa2
              WHERE pa2.user_id = pa.user_id AND pa2.lead_email = pa.lead_email
                AND pa2.type IN ('linkedin_connect_accepted', 'linkedin_reply')
                AND pa2.created_at > pa.created_at
              LIMIT 1) as outcome
      FROM prospect_activities pa
      WHERE pa.user_id = $1 AND pa.type IN ('linkedin_connect_sent', 'linkedin_message_sent')
        AND pa.created_at > now() - interval '60 days'
      ORDER BY pa.created_at DESC LIMIT 100
    `, [userId]);

    const liRows = liActions.rows;
    if (liRows.length >= 10) {
      const accepted = liRows.filter(r => r.outcome === 'linkedin_connect_accepted' || r.outcome === 'linkedin_reply');
      const ignored = liRows.filter(r => !r.outcome);
      const acceptRate = Math.round((accepted.length / liRows.length) * 100);

      // Analyze LinkedIn message lengths
      const acceptedLens = accepted.map(r => {
        try { const c = typeof r.content === 'string' ? JSON.parse(r.content) : r.content; return (c.note || c.message || '').length; } catch { return 0; }
      }).filter(l => l > 0);
      const ignoredLens = ignored.map(r => {
        try { const c = typeof r.content === 'string' ? JSON.parse(r.content) : r.content; return (c.note || c.message || '').length; } catch { return 0; }
      }).filter(l => l > 0);

      if (acceptedLens.length > 0 && ignoredLens.length > 0) {
        const avgAccepted = Math.round(acceptedLens.reduce((a, b) => a + b, 0) / acceptedLens.length);
        const avgIgnored = Math.round(ignoredLens.reduce((a, b) => a + b, 0) / ignoredLens.length);

        await db.memoryPatterns.replaceOrCreate(userId, {
          pattern: `LinkedIn : taux d'acceptation ${acceptRate}%. Longueur optimale ~${avgAccepted} car. (accept\u00e9s) vs ${avgIgnored} car. (ignor\u00e9s)`,
          category: 'Canal',
          source: 'copy_optimizer_linkedin',
          data: JSON.stringify({ acceptRate, avgAcceptedLen: avgAccepted, avgIgnoredLen: avgIgnored, sampleSize: liRows.length }),
          confidence: liRows.length >= 30 ? 'Haute' : 'Moyenne',
        });
        report.insights++;
        report.optimizations.push(`LinkedIn : longueur optimale ~${avgAccepted} car. (${acceptRate}% taux d'acceptation)`);
      }
    }
  } catch (err) {
    logger.warn('copy-optimizer', `LinkedIn analysis failed: ${err.message}`);
  }

  return report;
}

module.exports = { run };
