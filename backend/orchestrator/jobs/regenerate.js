/**
 * Job: Regenerate & Deploy (Workflow 2 replacement)
 *
 * Flow: PostgreSQL (original messages + memory) → Claude (analysis + regen) → PostgreSQL + Notion sync
 *
 * Triggered by collect-stats when a campaign needs optimization,
 * or manually via the orchestrator queue.
 */

const claude = require('../../api/claude');
const lemlist = require('../../api/lemlist');
const notionSync = require('../../api/notion-sync');
const db = require('../../db');

async function run({ campaignId, metrics, diagnostic } = {}) {
  console.log(`[regenerate] Starting for campaign ${campaignId}...`);

  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) {
    console.error(`[regenerate] Campaign ${campaignId} not found.`);
    return { success: false, error: 'Campaign not found' };
  }

  try {
    const sequence = await db.touchpoints.listByCampaign(campaignId);
    const originalMessages = sequence.map((tp) => ({
      step: tp.step, subject: tp.subject, body: tp.body,
    }));

    const memory = await db.memoryPatterns.list({});

    let analysisResult = diagnostic;
    if (!analysisResult) {
      analysisResult = await claude.analyzeCampaign({
        campaignName: campaign.name,
        stats: metrics,
        sector: campaign.sector || '',
        position: campaign.position || '',
        sequence,
      });

      const diag = await db.diagnostics.create(campaignId, {
        diagnostic: analysisResult.diagnostic,
        priorities: analysisResult.parsed?.priorities?.map((p) => p.step) || [],
        nbToOptimize: analysisResult.parsed?.priorities?.length || 0,
      });

      notionSync.syncDiagnostic(diag.id, campaignId).catch(console.error);
    }

    const regenerationResult = await claude.regenerateSequence({
      diagnostic: analysisResult.diagnostic,
      originalMessages,
      memory,
      clientParams: {
        tone: campaign.tone,
        formality: campaign.formality,
        sector: campaign.sector,
      },
      regenerationInstructions: analysisResult.parsed?.regenerationInstructions || null,
    });

    const existingVersions = await db.versions.listByCampaign(campaignId);
    const nextVersion = (existingVersions[0]?.version || 0) + 1;

    const version = await db.versions.create(campaignId, {
      version: nextVersion,
      messagesModified: regenerationResult.parsed?.messages?.map((m) => m.step) || [],
      hypotheses: regenerationResult.parsed?.summary || regenerationResult.parsed?.hypotheses?.join('; ') || '',
      result: 'testing',
    });

    notionSync.syncVersion(version.id, campaignId).catch(console.error);
    await db.campaigns.update(campaignId, { status: 'optimizing' });

    // Deploy A/B variants to Lemlist if campaign has a Lemlist ID
    let lemlistDeployed = false;
    if (campaign.lemlist_id && regenerationResult.parsed?.messages?.length > 0) {
      try {
        lemlistDeployed = await deployToLemlist(
          campaign.lemlist_id,
          regenerationResult.parsed.messages,
          sequence
        );
      } catch (err) {
        console.error(`[regenerate] Lemlist deployment failed for ${campaign.name}:`, err.message);
      }
    }

    console.log(`[regenerate] Done for campaign ${campaignId}. Version ${nextVersion} created.${lemlistDeployed ? ' Deployed to Lemlist.' : ''}`);
    return {
      success: true,
      versionId: version.id,
      version: nextVersion,
      messagesRegenerated: regenerationResult.parsed?.messages?.length || 0,
      lemlistDeployed,
    };
  } catch (err) {
    console.error(`[regenerate] Failed for campaign ${campaignId}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Deploy regenerated A/B variants to Lemlist sequences.
 * Maps each regenerated message to its Lemlist step and updates via PATCH.
 */
async function deployToLemlist(lemlistCampaignId, regeneratedMessages, existingSequence) {
  // Get current Lemlist sequences to find step IDs
  let lemlistSequences;
  try {
    lemlistSequences = await lemlist.getSequences(lemlistCampaignId);
  } catch (err) {
    console.error('[regenerate] Could not fetch Lemlist sequences:', err.message);
    return false;
  }

  if (!lemlistSequences || !Array.isArray(lemlistSequences)) {
    console.warn('[regenerate] No Lemlist sequences found for campaign');
    return false;
  }

  let deployedCount = 0;

  for (const msg of regeneratedMessages) {
    const step = msg.step; // e.g. "E1", "E2", "L1"
    const variant = msg.variantA || msg; // Primary variant

    if (!variant.body && !variant.subject) continue;

    // Find matching Lemlist step by index (E1=0, E2=1, etc.)
    const stepIndex = parseInt(step.replace(/[^\d]/g, ''), 10) - 1;
    const lemlistStep = lemlistSequences[stepIndex];

    if (!lemlistStep || !lemlistStep._id) {
      console.warn(`[regenerate] No Lemlist step found for ${step}`);
      continue;
    }

    // Build update payload
    const updateData = {};
    if (variant.subject) updateData.subject = variant.subject;
    if (variant.body) updateData.text = variant.body;

    try {
      await lemlist.updateSequenceStep(lemlistCampaignId, lemlistStep._id, updateData);
      deployedCount++;
      console.log(`[regenerate] Deployed ${step} to Lemlist step ${lemlistStep._id}`);
    } catch (err) {
      console.error(`[regenerate] Failed to deploy ${step} to Lemlist:`, err.message);
    }
  }

  return deployedCount > 0;
}

module.exports = { run, deployToLemlist };
