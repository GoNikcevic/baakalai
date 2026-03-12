/**
 * Job: Regenerate & Deploy (Workflow 2 replacement)
 *
 * Flow: PostgreSQL (original messages + memory) → Claude (analysis + regen) → PostgreSQL + Notion sync
 *
 * Triggered by collect-stats when a campaign needs optimization,
 * or manually via the orchestrator queue.
 */

const claude = require('../../api/claude');
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

    console.log(`[regenerate] Done for campaign ${campaignId}. Version ${nextVersion} created.`);
    return {
      success: true,
      versionId: version.id,
      version: nextVersion,
      messagesRegenerated: regenerationResult.parsed?.messages?.length || 0,
    };
  } catch (err) {
    console.error(`[regenerate] Failed for campaign ${campaignId}:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
