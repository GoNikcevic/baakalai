/**
 * Timing Agent
 *
 * Analyzes temporal patterns to optimize email send windows:
 * - Best day of week (from open/reply rates)
 * - Best time of day
 * - Seasonality by sector
 * - Optimal follow-up delays
 *
 * Outputs: memory patterns + recommended send window updates
 */

const db = require('../../db');
const logger = require('../logger');

async function run(userId) {
  const report = { insights: 0, recommendations: [], errors: [] };

  try {
    // Load sent emails with timestamps and outcomes
    const emails = await db.query(`
      SELECT
        ne.sent_at, ne.status, ne.sentiment,
        EXTRACT(DOW FROM ne.sent_at) AS day_of_week,
        EXTRACT(HOUR FROM ne.sent_at) AS hour_of_day,
        ne.replied_at,
        o.status AS contact_status, o.company
      FROM nurture_emails ne
      LEFT JOIN opportunities o ON o.id = ne.opportunity_id
      WHERE ne.user_id = $1 AND ne.status = 'sent' AND ne.sent_at IS NOT NULL
      ORDER BY ne.sent_at DESC LIMIT 500
    `, [userId]);

    const rows = emails.rows;
    if (rows.length < 20) {
      report.recommendations.push('Not enough data yet (need 20+ sent emails)');
      return report;
    }

    // Analyze by day of week
    const byDay = {};
    const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    for (const r of rows) {
      const day = parseInt(r.day_of_week);
      if (!byDay[day]) byDay[day] = { sent: 0, replied: 0 };
      byDay[day].sent++;
      if (r.replied_at || r.sentiment === 'positive') byDay[day].replied++;
    }

    // Find best day
    let bestDay = null, bestRate = 0;
    for (const [day, stats] of Object.entries(byDay)) {
      if (stats.sent < 3) continue;
      const rate = stats.replied / stats.sent;
      if (rate > bestRate) { bestRate = rate; bestDay = parseInt(day); }
    }

    if (bestDay !== null) {
      const insight = `Meilleur jour d'envoi : ${dayNames[bestDay]} (${Math.round(bestRate * 100)}% de r\u00e9ponses vs moyenne)`;
      report.recommendations.push(insight);

      await db.memoryPatterns.replaceOrCreate({
        pattern: insight,
        category: 'S\u00e9quence',
        data: JSON.stringify({ byDay, bestDay: dayNames[bestDay], bestRate: Math.round(bestRate * 100) }),
        confidence: rows.length >= 100 ? 'Haute' : 'Moyenne',
        sectors: [], targets: [],
      });
      report.insights++;
    }

    // Analyze by hour
    const byHour = {};
    for (const r of rows) {
      const hour = parseInt(r.hour_of_day);
      if (!byHour[hour]) byHour[hour] = { sent: 0, replied: 0 };
      byHour[hour].sent++;
      if (r.replied_at || r.sentiment === 'positive') byHour[hour].replied++;
    }

    let bestHour = null, bestHourRate = 0;
    for (const [hour, stats] of Object.entries(byHour)) {
      if (stats.sent < 3) continue;
      const rate = stats.replied / stats.sent;
      if (rate > bestHourRate) { bestHourRate = rate; bestHour = parseInt(hour); }
    }

    if (bestHour !== null) {
      const insight = `Meilleure heure d'envoi : ${bestHour}h (${Math.round(bestHourRate * 100)}% de r\u00e9ponses)`;
      report.recommendations.push(insight);
      report.insights++;
    }

    // Analyze optimal follow-up delay
    const withReply = rows.filter(r => r.replied_at);
    if (withReply.length >= 5) {
      const delays = withReply.map(r => {
        const sent = new Date(r.sent_at).getTime();
        const replied = new Date(r.replied_at).getTime();
        return Math.round((replied - sent) / 86400000); // days
      }).filter(d => d >= 0 && d <= 30);

      if (delays.length > 0) {
        const avgDelay = Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
        const insight = `D\u00e9lai moyen de r\u00e9ponse : ${avgDelay} jour(s) — adapter le timing des relances en cons\u00e9quence`;
        report.recommendations.push(insight);
        report.insights++;
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('timing-agent', err.message);
  }

  // ── LinkedIn timing analysis ──
  try {
    const liData = await db.query(`
      SELECT pa.created_at AS sent_at,
             EXTRACT(DOW FROM pa.created_at) AS day_of_week,
             EXTRACT(HOUR FROM pa.created_at) AS hour_of_day,
             (SELECT pa2.created_at FROM prospect_activities pa2
              WHERE pa2.user_id = pa.user_id AND pa2.lead_email = pa.lead_email
                AND pa2.type IN ('linkedin_connect_accepted', 'linkedin_reply')
                AND pa2.created_at > pa.created_at
              ORDER BY pa2.created_at LIMIT 1) AS response_at
      FROM prospect_activities pa
      WHERE pa.user_id = $1 AND pa.type IN ('linkedin_connect_sent', 'linkedin_message_sent')
        AND pa.created_at > now() - interval '60 days'
      ORDER BY pa.created_at DESC LIMIT 200
    `, [userId]);

    const liRows = liData.rows;
    if (liRows.length >= 10) {
      const withResponse = liRows.filter(r => r.response_at);
      const noResponse = liRows.filter(r => !r.response_at);

      // Best day of week for LinkedIn
      if (withResponse.length >= 5) {
        const dayBuckets = {};
        for (const r of withResponse) {
          const d = parseInt(r.day_of_week, 10);
          dayBuckets[d] = (dayBuckets[d] || 0) + 1;
        }
        const bestDay = Object.entries(dayBuckets).sort((a, b) => b[1] - a[1])[0];
        const dayNames = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

        if (bestDay) {
          const dayInsight = `LinkedIn : meilleur jour = ${dayNames[bestDay[0]]} (${bestDay[1]}/${withResponse.length} r\u00e9ponses)`;
          report.recommendations.push(dayInsight);

          await db.memoryPatterns.replaceOrCreate({
            pattern: dayInsight,
            category: 'S\u00e9quence',
            source: 'timing_agent_linkedin',
            data: JSON.stringify({ channel: 'linkedin', dayBuckets, sampleSize: liRows.length, responseRate: Math.round((withResponse.length / liRows.length) * 100) }),
            confidence: withResponse.length >= 15 ? 'Haute' : 'Moyenne',
          });
          report.insights++;
        }

        // Response delay for LinkedIn
        const delays = withResponse.map(r => {
          const sent = new Date(r.sent_at).getTime();
          const resp = new Date(r.response_at).getTime();
          return Math.round((resp - sent) / 86400000);
        }).filter(d => d >= 0 && d <= 30);

        if (delays.length > 0) {
          const avgDelay = Math.round(delays.reduce((a, b) => a + b, 0) / delays.length);
          report.recommendations.push(`LinkedIn : d\u00e9lai moyen de r\u00e9ponse = ${avgDelay} jour(s)`);
        }
      }
    }
  } catch (err) {
    logger.warn('timing-agent', `LinkedIn timing analysis failed: ${err.message}`);
  }

  return report;
}

module.exports = { run };
