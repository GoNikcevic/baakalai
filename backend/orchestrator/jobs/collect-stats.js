/**
 * Job: Collect Stats (Workflow 1 replacement)
 *
 * Flow: Lemlist API → compute metrics → PostgreSQL + Notion sync → trigger analysis if needed
 *
 * Trigger conditions for analysis:
 *   - Campaign has >50 prospects
 *   - Campaign is >7 days old
 */

const lemlist = require('../../api/lemlist');
const notionSync = require('../../api/notion-sync');
const claude = require('../../api/claude');
const db = require('../../db');
const regenerate = require('./regenerate');

const MIN_PROSPECTS = 50;
const MIN_AGE_DAYS = 7;

async function run() {
  console.log('[collect-stats] Starting daily stats collection...');

  let campaigns;
  try {
    campaigns = await lemlist.listCampaigns();
  } catch (err) {
    console.error('[collect-stats] Failed to fetch campaigns from Lemlist:', err.message);
    return { collected: 0, analyzed: 0, errors: [err.message] };
  }

  const results = [];
  const errors = [];

  for (const lc of campaigns) {
    try {
      const rawStats = await lemlist.getCampaignStats(lc._id);
      const metrics = computeMetrics(rawStats);

      let campaign = await db.campaigns.getByLemlistId(lc._id);
      if (!campaign) {
        campaign = await db.campaigns.create({
          name: lc.name,
          client: lc.client || 'Lemlist Import',
          status: 'active',
          channel: 'email',
          lemlistId: lc._id,
          nbProspects: metrics.totalProspects,
        });
      } else {
        await db.campaigns.update(campaign.id, {
          nb_prospects: metrics.totalProspects,
          open_rate: metrics.openRate,
          reply_rate: metrics.replyRate,
          accept_rate_lk: metrics.acceptRate,
          interested: metrics.interested,
          stops: metrics.stops,
          last_collected: new Date().toISOString().split('T')[0],
        });
        campaign = await db.campaigns.get(campaign.id);
      }

      notionSync.syncCampaign(campaign.id).catch((err) =>
        console.warn(`[collect-stats] Notion sync failed for ${campaign.name}:`, err.message)
      );

      let analyzed = false;
      if (shouldAnalyze(lc, metrics)) {
        try {
          const sequence = await db.touchpoints.listByCampaign(campaign.id);
          const stepStats = computeStepStats(rawStats);

          const analysisResult = await claude.analyzeCampaign({
            campaignName: campaign.name,
            stats: metrics,
            stepStats,
            sector: campaign.sector || '',
            position: campaign.position || '',
            sequence,
          });

          const diag = await db.diagnostics.create(campaign.id, {
            diagnostic: analysisResult.diagnostic,
            priorities: analysisResult.parsed?.priorities?.map((p) => p.step) || [],
            nbToOptimize: analysisResult.parsed?.priorities?.length || 0,
          });

          notionSync.syncDiagnostic(diag.id, campaign.id).catch(console.error);

          const stepsToRegenerate = analysisResult.parsed?.regenerationInstructions?.stepsToRegenerate || [];
          if (stepsToRegenerate.length > 0) {
            await regenerate.run({ campaignId: campaign.id, metrics, diagnostic: analysisResult });
          }

          analyzed = true;
        } catch (err) {
          console.error(`[collect-stats] Analysis failed for ${campaign.name}:`, err.message);
          errors.push({ campaign: campaign.name, error: err.message });
        }
      }

      results.push({
        campaign: campaign.name,
        lemlistId: lc._id,
        contacts: metrics.totalProspects,
        openRate: metrics.openRate,
        replyRate: metrics.replyRate,
        eligible: shouldAnalyze(lc, metrics),
        analyzed,
      });
    } catch (err) {
      console.error(`[collect-stats] Failed for campaign ${lc.name}:`, err.message);
      errors.push({ campaign: lc.name, error: err.message });
    }
  }

  console.log(`[collect-stats] Done. Collected: ${results.length}, Analyzed: ${results.filter((r) => r.analyzed).length}, Errors: ${errors.length}`);
  return { collected: results.length, analyzed: results.filter((r) => r.analyzed).length, campaigns: results, errors };
}

function computeMetrics(rawStats) {
  const base = lemlist.transformCampaignStats(rawStats);
  return {
    totalProspects: base.contacts,
    openRate: base.openRate,
    replyRate: base.replyRate,
    acceptRate: base.acceptRate,
    interested: base.interested,
    meetings: base.meetings,
    stops: base.stops,
  };
}

function computeStepStats(rawStats) {
  const stepStats = {};
  for (let i = 0; i < 6; i++) {
    const ss = lemlist.transformStepStats(rawStats, i);
    if (ss) stepStats[`E${i + 1}`] = ss;
  }
  return stepStats;
}

function shouldAnalyze(campaign, metrics) {
  const createdAt = campaign.createdAt || campaign.created_at;
  if (!createdAt) return metrics.totalProspects >= MIN_PROSPECTS;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return metrics.totalProspects >= MIN_PROSPECTS && ageDays >= MIN_AGE_DAYS;
}

module.exports = { run, computeMetrics, computeStepStats, shouldAnalyze };
