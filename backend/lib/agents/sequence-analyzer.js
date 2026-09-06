/**
 * Sequence Analyzer Agent
 *
 * Analyzes complete prospect journeys to identify:
 * - Drop-off points: which step loses the most prospects
 * - Winning sequence patterns: which step chains lead to replies
 * - Optimal sequence length by sector
 *
 * Pure SQL analytics — no Claude API calls.
 */

const db = require('../../db');
const logger = require('../logger');

async function run(userId) {
  const report = { insights: 0, recommendations: [], errors: [] };

  // Tenant des patterns (audit 02/09) : l'équipe si l'utilisateur en a une,
  // sinon l'utilisateur — jamais les deux (règle DAO, migration 089).
  // Résolu une seule fois par run, réutilisé pour chaque écriture.
  let tenant = { userId };
  try {
    const team = await db.teams.getByUser(userId);
    if (team) tenant = { teamId: team.id };
  } catch { /* résolution d'équipe indisponible : le pattern reste scopé user */ }

  try {
    // ── 1. Drop-off analysis per step ──
    // For each campaign, compare activity counts at each step
    const stepStats = await db.query(`
      SELECT c.id AS campaign_id, c.name AS campaign_name, c.sector,
        pa.sequence_step, pa.type,
        COUNT(*) AS event_count
      FROM prospect_activities pa
      JOIN campaigns c ON c.id = pa.campaign_id
      WHERE pa.user_id = $1 AND pa.sequence_step IS NOT NULL
      GROUP BY c.id, c.name, c.sector, pa.sequence_step, pa.type
      ORDER BY c.id, pa.sequence_step
    `, [userId]);

    if (stepStats.rows.length < 10) {
      report.recommendations.push('Pas assez de données de séquence (besoin de 10+ événements avec steps)');
      return report;
    }

    // Group by campaign
    const campaigns = {};
    for (const row of stepStats.rows) {
      if (!campaigns[row.campaign_id]) {
        campaigns[row.campaign_id] = { name: row.campaign_name, sector: row.sector, steps: {} };
      }
      if (!campaigns[row.campaign_id].steps[row.sequence_step]) {
        campaigns[row.campaign_id].steps[row.sequence_step] = {};
      }
      campaigns[row.campaign_id].steps[row.sequence_step][row.type] = parseInt(row.event_count);
    }

    // Find worst drop-off step across all campaigns
    let worstDropoff = null;
    let worstDropoffRate = 0;
    let totalCampaigns = 0;

    for (const [, campaign] of Object.entries(campaigns)) {
      const stepNumbers = Object.keys(campaign.steps).map(Number).sort((a, b) => a - b);
      if (stepNumbers.length < 2) continue;
      totalCampaigns++;

      for (let i = 1; i < stepNumbers.length; i++) {
        const prev = campaign.steps[stepNumbers[i - 1]];
        const curr = campaign.steps[stepNumbers[i]];
        const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
        const currTotal = Object.values(curr).reduce((a, b) => a + b, 0);

        if (prevTotal > 0) {
          const dropoff = 1 - (currTotal / prevTotal);
          if (dropoff > worstDropoffRate && prevTotal >= 5) {
            worstDropoffRate = dropoff;
            worstDropoff = { step: stepNumbers[i], prevStep: stepNumbers[i - 1], rate: dropoff, campaign: campaign.name };
          }
        }
      }
    }

    if (worstDropoff && worstDropoffRate > 0.5) {
      const pct = Math.round(worstDropoffRate * 100);
      const insight = `Drop-off critique : ${pct}% des prospects décrochent entre le step ${worstDropoff.prevStep} et ${worstDropoff.step} — revoir le contenu ou le timing de ce step`;
      report.recommendations.push(insight);

      await db.memoryPatterns.replaceOrCreate({
        ...tenant,
        pattern: insight,
        category: 'Séquence',
        data: JSON.stringify({ type: 'dropoff', ...worstDropoff }),
        confidence: totalCampaigns >= 3 ? 'Moyenne' : 'Faible',
        sectors: [], targets: [],
      });
      report.insights++;
    }

    // ── 2. Winning sequence length ──
    // Which step number generates the most replies?
    const replyByStep = await db.query(`
      SELECT sequence_step, COUNT(*) AS replies
      FROM prospect_activities
      WHERE user_id = $1 AND type IN ('emailsReplied', 'replied') AND sequence_step IS NOT NULL
      GROUP BY sequence_step
      ORDER BY COUNT(*) DESC
    `, [userId]);

    if (replyByStep.rows.length > 0) {
      const bestStep = replyByStep.rows[0];
      const totalReplies = replyByStep.rows.reduce((a, r) => a + parseInt(r.replies), 0);
      const pct = Math.round((parseInt(bestStep.replies) / totalReplies) * 100);

      const insight = `Le step ${bestStep.sequence_step} génère le plus de réponses (${pct}% des replies) — concentrer l'effort de personnalisation sur ce step`;
      report.recommendations.push(insight);

      await db.memoryPatterns.replaceOrCreate({
        ...tenant,
        pattern: insight,
        category: 'Séquence',
        data: JSON.stringify({ type: 'best_reply_step', step: bestStep.sequence_step, pct, totalReplies }),
        confidence: totalReplies >= 20 ? 'Haute' : totalReplies >= 10 ? 'Moyenne' : 'Faible',
        sectors: [], targets: [],
      });
      report.insights++;
    }

    // ── 3. Optimal sequence length ──
    // Compare reply rate for campaigns with different step counts
    const seqLength = await db.query(`
      SELECT c.id, c.name, c.sector, c.reply_rate,
        COUNT(DISTINCT t.step) AS step_count
      FROM campaigns c
      JOIN touchpoints t ON t.campaign_id = c.id
      WHERE c.user_id = $1 AND c.nb_prospects > 20 AND c.reply_rate IS NOT NULL
      GROUP BY c.id, c.name, c.sector, c.reply_rate
      ORDER BY c.reply_rate DESC
    `, [userId]);

    if (seqLength.rows.length >= 3) {
      // Group by step count bucket: short (1-3), medium (4-6), long (7+)
      const buckets = { short: [], medium: [], long: [] };
      for (const r of seqLength.rows) {
        const count = parseInt(r.step_count);
        const rate = parseFloat(r.reply_rate);
        if (count <= 3) buckets.short.push(rate);
        else if (count <= 6) buckets.medium.push(rate);
        else buckets.long.push(rate);
      }

      const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const avgShort = avg(buckets.short);
      const avgMedium = avg(buckets.medium);
      const avgLong = avg(buckets.long);

      // Find best bucket
      const best = [
        { name: 'courtes (1-3 steps)', avg: avgShort, count: buckets.short.length },
        { name: 'moyennes (4-6 steps)', avg: avgMedium, count: buckets.medium.length },
        { name: 'longues (7+ steps)', avg: avgLong, count: buckets.long.length },
      ].filter(b => b.count >= 2).sort((a, b) => b.avg - a.avg);

      if (best.length > 0 && best[0].avg > 0) {
        const insight = `Les séquences ${best[0].name} performent mieux (${best[0].avg.toFixed(1)}% reply rate vs ${(best.slice(1).map(b => `${b.avg.toFixed(1)}%`).join(', ') || 'N/A')})`;
        report.recommendations.push(insight);

        await db.memoryPatterns.replaceOrCreate({
          ...tenant,
          pattern: insight,
          category: 'Séquence',
          data: JSON.stringify({ type: 'optimal_length', buckets: { short: avgShort, medium: avgMedium, long: avgLong } }),
          confidence: seqLength.rows.length >= 10 ? 'Haute' : 'Moyenne',
          sectors: [], targets: [],
        });
        report.insights++;
      }
    }

    // ── 4. Channel mix analysis ──
    // Does adding LinkedIn steps improve reply rate?
    const channelMix = await db.query(`
      SELECT c.id, c.reply_rate,
        bool_or(t.type = 'linkedin') AS has_linkedin,
        bool_or(t.type = 'email') AS has_email
      FROM campaigns c
      JOIN touchpoints t ON t.campaign_id = c.id
      WHERE c.user_id = $1 AND c.nb_prospects > 20 AND c.reply_rate IS NOT NULL
      GROUP BY c.id, c.reply_rate
    `, [userId]);

    if (channelMix.rows.length >= 4) {
      const emailOnly = channelMix.rows.filter(r => r.has_email && !r.has_linkedin).map(r => parseFloat(r.reply_rate));
      const multiChannel = channelMix.rows.filter(r => r.has_email && r.has_linkedin).map(r => parseFloat(r.reply_rate));

      if (emailOnly.length >= 2 && multiChannel.length >= 2) {
        const avgEmail = emailOnly.reduce((a, b) => a + b, 0) / emailOnly.length;
        const avgMulti = multiChannel.reduce((a, b) => a + b, 0) / multiChannel.length;
        const diff = avgMulti - avgEmail;

        if (Math.abs(diff) > 1) {
          const better = diff > 0 ? 'multi-canal (email + LinkedIn)' : 'email seul';
          const insight = `Les séquences ${better} ont un meilleur reply rate (${diff > 0 ? '+' : ''}${diff.toFixed(1)} points)`;
          report.recommendations.push(insight);

          await db.memoryPatterns.replaceOrCreate({
            ...tenant,
            pattern: insight,
            category: 'Séquence',
            data: JSON.stringify({ type: 'channel_mix', avgEmail, avgMulti, diff }),
            confidence: channelMix.rows.length >= 10 ? 'Haute' : 'Moyenne',
            sectors: [], targets: [],
          });
          report.insights++;
        }
      }
    }

  } catch (err) {
    report.errors.push(err.message);
    logger.error('sequence-analyzer', err.message);
  }

  return report;
}

module.exports = { run };
