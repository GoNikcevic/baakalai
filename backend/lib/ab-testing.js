const db = require('../db');
const lemlist = require('../api/lemlist');
const { getUserKey } = require('../config');
const logger = require('./logger');

const MIN_TEST_DAYS = 7;
const MIN_PROSPECTS = 100;
const B_WIN_THRESHOLD = 1.05; // B needs 5% improvement to win

/**
 * Check A/B test results and auto-select winner.
 * Called after stats collection for campaigns with active tests.
 *
 * @param {string} campaignId - Internal campaign UUID
 * @param {string} userId - Owner user UUID (for API key lookup)
 * @returns {object|null} { winner, aScore, bScore, improvement } or null if not ready
 */
async function evaluateABTests(campaignId, userId) {
  // Get active test versions (result = 'testing')
  const versions = await db.versions.listByCampaign(campaignId);
  const activeTest = versions.find(v => v.result === 'testing');
  if (!activeTest) return null;

  // Check if test has enough data (min 7 days)
  const createdAt = new Date(activeTest.created_at || activeTest.date);
  const daysSinceStart = (Date.now() - createdAt.getTime()) / 86400000;
  if (daysSinceStart < MIN_TEST_DAYS) {
    logger.debug('ab-test', `Campaign ${campaignId}: only ${daysSinceStart.toFixed(1)} days, need ${MIN_TEST_DAYS}`);
    return null;
  }

  // Check minimum prospect volume
  const campaign = await db.campaigns.get(campaignId);
  if (!campaign || (campaign.nb_prospects || 0) < MIN_PROSPECTS) {
    logger.debug('ab-test', `Campaign ${campaignId}: ${campaign?.nb_prospects || 0} prospects, need ${MIN_PROSPECTS}`);
    return null;
  }

  // Compare A vs B performance across touchpoints
  const touchpoints = await db.touchpoints.listByCampaign(campaignId);

  let aScore = 0;
  let bScore = 0;
  let hasVariantData = false;

  for (const tp of touchpoints) {
    const aOpen = tp.open_rate || 0;
    const bOpen = tp.open_rate_b || 0;
    const aReply = tp.reply_rate || 0;
    const bReply = tp.reply_rate_b || 0;

    if (bOpen > 0 || bReply > 0) hasVariantData = true;

    // Weighted score: reply rate counts 3x more than open rate
    aScore += aOpen + (aReply * 3);
    bScore += bOpen + (bReply * 3);
  }

  if (!hasVariantData) {
    logger.debug('ab-test', `Campaign ${campaignId}: no variant B data yet`);
    return null;
  }

  const winner = bScore > aScore * B_WIN_THRESHOLD ? 'B' : 'A';
  const improvement = aScore > 0 ? ((bScore - aScore) / aScore * 100).toFixed(1) : '0';

  logger.info('ab-test', `Campaign ${campaignId}: Winner=${winner}, A=${aScore.toFixed(1)}, B=${bScore.toFixed(1)}, Improvement=${improvement}%`);

  if (winner === 'B') {
    await promoteVariantB(campaignId, campaign, touchpoints, userId);
    await db.versions.update(activeTest.id, { result: 'improved' });
  } else {
    await clearVariantB(campaignId, campaign, touchpoints, userId);
    await db.versions.update(activeTest.id, { result: 'neutral' });
  }

  return { winner, aScore, bScore, improvement };
}

/**
 * Promote variant B to A: overwrite A content with B, clear B fields.
 */
async function promoteVariantB(campaignId, campaign, touchpoints, userId) {
  const apiKey = userId ? await getUserKey(userId, 'lemlist') : null;

  let lemlistSequences = null;
  if (apiKey && campaign.lemlist_id) {
    try {
      lemlistSequences = await lemlist.getSequences(campaign.lemlist_id);
    } catch (err) {
      logger.error('ab-test', `Failed to fetch Lemlist sequences for campaign ${campaignId}`, { error: err.message });
    }
  }

  for (const tp of touchpoints) {
    if (!tp.subject_b && !tp.body_b) continue;

    // Update DB: A gets B's content, B fields cleared
    await db.touchpoints.update(tp.id, {
      subject: tp.subject_b || tp.subject,
      body: tp.body_b || tp.body,
      subject_b: null,
      body_b: null,
      open_rate_b: null,
      reply_rate_b: null,
      accept_rate_b: null,
    });

    // Update Lemlist: promote B to A, clear B
    if (lemlistSequences && Array.isArray(lemlistSequences)) {
      const stepIndex = parseInt((tp.step || '').replace(/[^\d]/g, ''), 10) - 1;
      const lemlistStep = lemlistSequences[stepIndex];
      if (lemlistStep && lemlistStep._id) {
        try {
          await lemlist.updateSequenceStep(campaign.lemlist_id, lemlistStep._id, {
            subject: tp.subject_b || tp.subject,
            text: tp.body_b || tp.body,
            subjectB: '',
            textB: '',
          });
        } catch (err) {
          logger.error('ab-test', `Failed to promote B for step ${tp.step}`, { error: err.message });
        }
      }
    }
  }

  logger.info('ab-test', `Campaign ${campaignId}: Variant B promoted to A`);
}

/**
 * Clear variant B: A wins, remove B content from DB and Lemlist.
 */
async function clearVariantB(campaignId, campaign, touchpoints, userId) {
  // Clear B fields in DB
  for (const tp of touchpoints) {
    if (tp.subject_b || tp.body_b) {
      await db.touchpoints.update(tp.id, {
        subject_b: null,
        body_b: null,
        open_rate_b: null,
        reply_rate_b: null,
        accept_rate_b: null,
      });
    }
  }

  // Clear B in Lemlist
  const apiKey = userId ? await getUserKey(userId, 'lemlist') : null;
  if (apiKey && campaign.lemlist_id) {
    try {
      const lemlistSequences = await lemlist.getSequences(campaign.lemlist_id);
      if (lemlistSequences && Array.isArray(lemlistSequences)) {
        for (const seq of lemlistSequences) {
          await lemlist.updateSequenceStep(campaign.lemlist_id, seq._id, {
            subjectB: '',
            textB: '',
          });
        }
      }
    } catch (err) {
      logger.error('ab-test', `Failed to clear B for campaign ${campaignId}`, { error: err.message });
    }
  }

  logger.info('ab-test', `Campaign ${campaignId}: Variant A kept, B cleared`);
}

/**
 * Force-select a winner for a campaign's active A/B test.
 * @param {string} campaignId
 * @param {string} userId
 * @param {'A'|'B'} winner
 */
async function forceSelectWinner(campaignId, userId, winner) {
  const versions = await db.versions.listByCampaign(campaignId);
  const activeTest = versions.find(v => v.result === 'testing');
  if (!activeTest) {
    throw new Error('No active A/B test found for this campaign');
  }

  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const touchpoints = await db.touchpoints.listByCampaign(campaignId);

  if (winner === 'B') {
    await promoteVariantB(campaignId, campaign, touchpoints, userId);
    await db.versions.update(activeTest.id, { result: 'improved' });
  } else {
    await clearVariantB(campaignId, campaign, touchpoints, userId);
    await db.versions.update(activeTest.id, { result: 'neutral' });
  }

  logger.info('ab-test', `Campaign ${campaignId}: Winner ${winner} force-selected by user`);
  return { winner, versionId: activeTest.id };
}

module.exports = { evaluateABTests, forceSelectWinner };
