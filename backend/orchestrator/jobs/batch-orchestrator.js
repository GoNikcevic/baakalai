/**
 * Batch Orchestrator Agent
 *
 * Runs periodically (every 12h via the orchestrator cron in index.js).
 * For each campaign in batch_mode:
 * 1. Check if current batch has enough data (uses Claude to reason, not rigid thresholds)
 * 2. If yes: resolve A/B test (pick winner)
 * 3. Generate new variant for next batch (via Claude regenerateSequence)
 * 4. Assign next batch of prospects
 * 5. Launch next batch to Lemlist (reuse existing launch flow)
 * 6. Notify user via chat message or socket notification
 * 7. If anomaly detected (high bounce, 0 opens) → pause and alert
 */

const db = require('../../db');
const claude = require('../../api/claude');
const lemlist = require('../../api/lemlist');
const { resolveActiveABTest } = require('../../lib/ab-testing');
const regenerateJob = require('./regenerate');
const { getUserKey } = require('../../config');
const { notifyUser } = require('../../socket');
const logger = require('../../lib/logger');

/**
 * Main entry point — iterate all campaigns in batch_mode that still have
 * batches remaining and decide what to do for each one.
 */
async function runBatchOrchestrator() {
  logger.info('batch-orchestrator', 'Starting batch orchestrator run...');

  let campaigns;
  try {
    const result = await db.query(
      `SELECT * FROM campaigns
       WHERE batch_mode = true
         AND status = 'active'
         AND current_batch < total_batches`,
      []
    );
    campaigns = result.rows;
  } catch (err) {
    logger.error('batch-orchestrator', 'Failed to fetch batch campaigns', { error: err.message });
    return { processed: 0, errors: [err.message] };
  }

  if (!campaigns || campaigns.length === 0) {
    logger.info('batch-orchestrator', 'No active batch campaigns found.');
    return { processed: 0, advanced: 0, paused: 0, errors: [] };
  }

  logger.info('batch-orchestrator', `Found ${campaigns.length} active batch campaign(s)`);

  const results = { processed: 0, advanced: 0, paused: 0, errors: [] };

  for (const campaign of campaigns) {
    try {
      await processCampaignBatch(campaign, results);
      results.processed++;
    } catch (err) {
      logger.error('batch-orchestrator', `Error processing campaign ${campaign.name}`, { error: err.message });
      results.errors.push({ campaign: campaign.name, error: err.message });
    }
  }

  logger.info('batch-orchestrator', 'Batch orchestrator run complete', results);
  return results;
}

/**
 * Process a single campaign: gather stats, check anomalies, evaluate batch,
 * resolve A/B, generate new variant, assign next batch, launch.
 */
async function processCampaignBatch(campaign, results) {
  const campaignId = campaign.id;
  const userId = campaign.user_id;
  const currentBatch = campaign.current_batch || 0;

  logger.info('batch-orchestrator', `Processing campaign "${campaign.name}" — batch ${currentBatch}/${campaign.total_batches}`);

  // 1. Gather stats for the current batch
  const batchStats = await gatherBatchStats(campaignId, currentBatch);

  // 2. Check for anomalies first — if something is very wrong, pause immediately
  const anomaly = detectAnomalies(batchStats, campaign);
  if (anomaly) {
    logger.warn('batch-orchestrator', `Anomaly detected for "${campaign.name}": ${anomaly.reason}`);
    await db.campaigns.update(campaignId, { status: 'paused' });
    await notifyUserMessage(userId, campaign,
      `Campagne "${campaign.name}" mise en pause automatiquement.\n` +
      `Anomalie détectée sur le batch ${currentBatch}: ${anomaly.reason}\n` +
      `Vérifiez les paramètres de la campagne et relancez manuellement.`
    );
    results.paused++;
    return;
  }

  // 3. Ask Claude if there is enough data to evaluate this batch
  const evaluation = await evaluateBatch(campaign, batchStats);
  if (!evaluation.ready) {
    logger.info('batch-orchestrator', `Batch ${currentBatch} of "${campaign.name}" not ready: ${evaluation.reason}`);
    return;
  }

  // 4. Resolve the current A/B test (pick winner)
  let abResult = null;
  try {
    abResult = await resolveActiveABTest(campaignId, userId, { force: true });
    if (abResult.resolved) {
      logger.info('batch-orchestrator', `A/B resolved for "${campaign.name}": winner=${abResult.winner}, improvement=${abResult.improvement}%`);
    }
  } catch (err) {
    logger.warn('batch-orchestrator', `A/B resolution skipped for "${campaign.name}": ${err.message}`);
  }

  // 5. Generate a new variant for the next batch via regeneration
  let regenResult = null;
  try {
    const metrics = {
      totalProspects: batchStats.totalSent,
      openRate: batchStats.openRate,
      replyRate: batchStats.replyRate,
      acceptRate: 0,
      interested: batchStats.interested || 0,
      meetings: 0,
      stops: batchStats.bounceRate,
    };
    regenResult = await regenerateJob.run({ campaignId, metrics });
    if (regenResult.success) {
      logger.info('batch-orchestrator', `New variant generated for "${campaign.name}" — version ${regenResult.version}`);
    }
  } catch (err) {
    logger.warn('batch-orchestrator', `Regeneration failed for "${campaign.name}": ${err.message}`);
    // Non-fatal: we still advance the batch with the existing sequence
  }

  // 6. Assign the next batch of prospects
  const nextBatch = currentBatch + 1;
  const batchSize = campaign.batch_size || 100;
  const assignResult = await assignNextBatch(campaignId, nextBatch, batchSize);

  if (assignResult.assigned === 0) {
    logger.info('batch-orchestrator', `No more unassigned prospects for "${campaign.name}" — completing.`);
    await db.campaigns.update(campaignId, { current_batch: nextBatch });
    await notifyUserMessage(userId, campaign,
      `Campagne "${campaign.name}" : tous les prospects ont été envoyés.\n` +
      `${campaign.total_batches} batch(es) complétés. La campagne est terminée.`
    );
    return;
  }

  // 7. Launch the next batch to Lemlist
  let launchSuccess = false;
  try {
    launchSuccess = await launchBatchToLemlist(campaign, assignResult.prospects, userId);
  } catch (err) {
    logger.error('batch-orchestrator', `Lemlist launch failed for "${campaign.name}" batch ${nextBatch}`, { error: err.message });
  }

  // 8. Update campaign tracking
  await db.campaigns.update(campaignId, {
    current_batch: nextBatch,
  });

  results.advanced++;

  // 9. Notify user
  const winnerInfo = abResult?.resolved
    ? `\nA/B test résolu : variante ${abResult.winner} gagnante (${abResult.improvement}% d'amélioration).`
    : '';
  const regenInfo = regenResult?.success
    ? `\nNouvelle variante (v${regenResult.version}) générée pour le prochain batch.`
    : '';

  await notifyUserMessage(userId, campaign,
    `Campagne "${campaign.name}" — Batch ${nextBatch}/${campaign.total_batches} lancé.\n` +
    `${assignResult.assigned} prospects ajoutés.` +
    winnerInfo + regenInfo +
    (launchSuccess ? '\nEnvoi Lemlist : OK.' : '\nEnvoi Lemlist : échec — vérifiez la configuration.')
  );
}

// ── Helper: Gather stats for a specific batch ──

async function gatherBatchStats(campaignId, batchNumber) {
  // Get prospects for this batch
  const result = await db.query(
    `SELECT * FROM opportunities WHERE campaign_id = $1 AND batch_number = $2`,
    [campaignId, batchNumber]
  );
  const prospects = result.rows;

  // Get the campaign-level stats (from Lemlist sync) and touchpoints
  const campaign = await db.campaigns.get(campaignId);
  const touchpoints = await db.touchpoints.listByCampaign(campaignId);

  const totalSent = prospects.length;
  const daysSinceBatchStart = campaign.last_collected
    ? (Date.now() - new Date(campaign.last_collected).getTime()) / 86400000
    : 0;

  // Use campaign-level rates as proxy (Lemlist does not expose per-batch stats directly)
  const openRate = campaign.open_rate || 0;
  const replyRate = campaign.reply_rate || 0;
  const bounceRate = campaign.stops || 0;
  const interested = campaign.interested || 0;

  // Count replies from opportunity statuses in this batch
  const replied = prospects.filter(p => p.status === 'replied' || p.status === 'interested').length;
  const batchReplyRate = totalSent > 0 ? (replied / totalSent) * 100 : 0;

  return {
    batchNumber,
    totalSent,
    totalProspects: totalSent,
    openRate: Number(openRate),
    replyRate: Math.max(Number(replyRate), batchReplyRate),
    bounceRate: Number(bounceRate),
    interested: Number(interested),
    replied,
    daysSinceBatchStart,
    touchpointCount: touchpoints.length,
    hasVariantB: touchpoints.some(tp => tp.subject_b || tp.body_b),
    // Per-touchpoint open/reply for A vs B
    touchpoints: touchpoints.map(tp => ({
      step: tp.step,
      openRate: tp.open_rate || 0,
      replyRate: tp.reply_rate || 0,
      openRateB: tp.open_rate_b || 0,
      replyRateB: tp.reply_rate_b || 0,
    })),
  };
}

// ── Helper: Claude-powered batch evaluation ──

async function evaluateBatch(campaign, batchStats) {
  const prompt = `You are a data analyst for B2B outreach campaigns.

Here are the stats for batch ${batchStats.batchNumber} of campaign "${campaign.name}":
- Total sent: ${batchStats.totalSent}
- Open rate: ${batchStats.openRate}%
- Reply rate: ${batchStats.replyRate}%
- Bounce rate: ${batchStats.bounceRate}%
- Days since batch start: ${batchStats.daysSinceBatchStart.toFixed(1)}
- Has A/B variant: ${batchStats.hasVariantB}
- Touchpoint stats: ${JSON.stringify(batchStats.touchpoints)}

Is there enough data to determine a winner and advance to the next batch?

Consider:
- Minimum ~50 sends for any statistical significance
- At least 5 days of data for emails to be opened
- If there's an A/B test, reply rate difference should be > 2% between variants to be meaningful
- If bounce rate > 10%, this is an anomaly, not ready to evaluate

Respond with ONLY this JSON (no markdown, no explanation):
{"ready": true/false, "reason": "brief explanation", "winner": "A" or "B" or null}`;

  try {
    const result = await claude.callClaude(
      'You are a concise B2B outreach data analyst. Respond with JSON only.',
      prompt,
      500,
      'evaluateBatch'
    );

    if (result.parsed) {
      return {
        ready: !!result.parsed.ready,
        reason: result.parsed.reason || 'No reason provided',
        winner: result.parsed.winner || null,
      };
    }

    // Fallback: try to parse raw text
    try {
      const json = JSON.parse(result.raw);
      return {
        ready: !!json.ready,
        reason: json.reason || 'No reason provided',
        winner: json.winner || null,
      };
    } catch {
      // If Claude can't parse it, fall back to simple heuristics
      logger.warn('batch-orchestrator', 'Could not parse Claude evaluation response, using fallback heuristics');
      return evaluateBatchFallback(batchStats);
    }
  } catch (err) {
    logger.warn('batch-orchestrator', `Claude evaluation failed, using fallback: ${err.message}`);
    return evaluateBatchFallback(batchStats);
  }
}

/**
 * Fallback heuristic evaluation when Claude is unavailable.
 */
function evaluateBatchFallback(batchStats) {
  if (batchStats.totalSent < 50) {
    return { ready: false, reason: `Only ${batchStats.totalSent} sent, need at least 50`, winner: null };
  }
  if (batchStats.daysSinceBatchStart < 5) {
    return { ready: false, reason: `Only ${batchStats.daysSinceBatchStart.toFixed(1)} days, need at least 5`, winner: null };
  }
  // Enough data — determine winner from touchpoint A vs B performance
  let aScore = 0;
  let bScore = 0;
  for (const tp of batchStats.touchpoints) {
    aScore += tp.openRate + (tp.replyRate * 3);
    bScore += tp.openRateB + (tp.replyRateB * 3);
  }
  const winner = bScore > aScore * 1.05 ? 'B' : 'A';
  return { ready: true, reason: 'Heuristic: enough data and time elapsed', winner };
}

// ── Helper: Anomaly detection ──

function detectAnomalies(batchStats, campaign) {
  // High bounce rate
  if (batchStats.bounceRate > 10 && batchStats.totalSent >= 30) {
    return {
      type: 'high_bounce',
      reason: `Taux de bounce élevé : ${batchStats.bounceRate}% (seuil : 10%). Vérifiez la qualité de la liste.`,
    };
  }

  // Zero opens after significant sends and enough time
  if (batchStats.openRate < 1 && batchStats.totalSent >= 100 && batchStats.daysSinceBatchStart >= 3) {
    return {
      type: 'zero_opens',
      reason: `Taux d'ouverture quasi nul (${batchStats.openRate}%) après ${batchStats.totalSent} envois sur ${batchStats.daysSinceBatchStart.toFixed(0)} jours. Problème de délivrabilité probable.`,
    };
  }

  // Zero replies after 100+ sends and enough time
  if (batchStats.replied === 0 && batchStats.totalSent >= 100 && batchStats.daysSinceBatchStart >= 7) {
    return {
      type: 'zero_replies',
      reason: `Aucune réponse après ${batchStats.totalSent} envois sur ${batchStats.daysSinceBatchStart.toFixed(0)} jours. Revoyez le copy ou le ciblage.`,
    };
  }

  return null;
}

// ── Helper: Assign next batch of prospects ──

async function assignNextBatch(campaignId, nextBatch, batchSize) {
  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE campaign_id = $1 AND (batch_number IS NULL OR batch_number = 0)
     ORDER BY created_at ASC
     LIMIT $2`,
    [campaignId, batchSize]
  );
  const prospects = result.rows;

  for (const p of prospects) {
    await db.opportunities.update(p.id, { batch_number: nextBatch });
  }

  return { assigned: prospects.length, prospects };
}

// ── Helper: Launch batch prospects to Lemlist ──

async function launchBatchToLemlist(campaign, prospects, userId) {
  if (!campaign.lemlist_id) {
    logger.warn('batch-orchestrator', `Campaign "${campaign.name}" has no lemlist_id — skipping Lemlist launch`);
    return false;
  }

  const apiKey = userId ? await getUserKey(userId, 'lemlist') : null;
  if (!apiKey) {
    logger.warn('batch-orchestrator', `No Lemlist API key for user ${userId}`);
    return false;
  }

  let addedCount = 0;
  for (const prospect of prospects) {
    if (!prospect.email) continue;
    try {
      await lemlist.addLead(campaign.lemlist_id, {
        email: prospect.email,
        firstName: prospect.name?.split(' ')[0] || '',
        lastName: prospect.name?.split(' ').slice(1).join(' ') || '',
        companyName: prospect.company || '',
        jobTitle: prospect.title || '',
      }, apiKey);
      addedCount++;
    } catch (err) {
      // Don't fail the whole batch for a single prospect error (e.g. duplicate)
      logger.debug('batch-orchestrator', `Failed to add prospect ${prospect.email}: ${err.message}`);
    }
  }

  logger.info('batch-orchestrator', `Added ${addedCount}/${prospects.length} prospects to Lemlist campaign "${campaign.name}"`);
  return addedCount > 0;
}

// ── Helper: Notify user via chat message + socket ──

async function notifyUserMessage(userId, campaign, message) {
  if (!userId) return;

  // 1. Real-time socket notification
  notifyUser(userId, 'batch:update', {
    campaignId: campaign.id,
    campaignName: campaign.name,
    message,
    timestamp: new Date().toISOString(),
  });

  // 2. Persist as a chat message in the user's most recent thread
  try {
    const threads = await db.chatThreads.list(userId, 1);
    let threadId;
    if (threads.length > 0) {
      threadId = threads[0].id;
    } else {
      const newThread = await db.chatThreads.create('Notifications Baakalai', userId);
      threadId = newThread.id;
    }

    await db.chatMessages.create(threadId, 'assistant', message, {
      type: 'batch_orchestrator',
      campaignId: campaign.id,
      automated: true,
    });
  } catch (err) {
    logger.warn('batch-orchestrator', `Failed to persist notification for user ${userId}: ${err.message}`);
  }
}

module.exports = { runBatchOrchestrator };
