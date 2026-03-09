/**
 * Job: Collect Stats (Workflow 1 replacement)
 *
 * Flow: Lemlist API → compute metrics → Notion "Résultats" → trigger analysis if needed
 *
 * Trigger conditions for analysis:
 *   - Campaign has >50 prospects
 *   - Campaign is >7 days old
 */

const lemlist = require('../../api/lemlist');
const notion = require('../../api/notion');
// const claude = require('../../api/claude');
// const regenerate = require('./regenerate');

const MIN_PROSPECTS = 50;
const MIN_AGE_DAYS = 7;

async function run() {
  console.log('[collect-stats] Starting daily stats collection...');

  // Step 1: Fetch active campaigns from Lemlist
  // const campaigns = await lemlist.listCampaigns();

  // Step 2: For each campaign, fetch detailed stats
  // for (const campaign of campaigns) {
  //   const stats = await lemlist.getCampaignStats(campaign._id);
  //   const metrics = computeMetrics(stats);
  //
  //   // Step 3: Upsert results in Notion
  //   await notion.createResultat({
  //     name: campaign.name,
  //     client: campaign.client || '',
  //     nbProspects: metrics.totalProspects,
  //     openRate: metrics.openRate,
  //     replyRate: metrics.replyRate,
  //     statut: 'Active',
  //   });
  //
  //   // Step 4: Check if analysis should be triggered
  //   if (shouldAnalyze(campaign, metrics)) {
  //     await regenerate.run({ campaignId: campaign._id, metrics });
  //   }
  // }

  console.log('[collect-stats] Done.');
}

function computeMetrics(stats) {
  // TODO: Extract per-touchpoint open/reply/click rates from Lemlist export
  return {
    totalProspects: 0,
    openRate: 0,
    replyRate: 0,
    clickRate: 0,
    acceptRate: 0,
  };
}

function shouldAnalyze(campaign, metrics) {
  const ageMs = Date.now() - new Date(campaign.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return metrics.totalProspects >= MIN_PROSPECTS && ageDays >= MIN_AGE_DAYS;
}

module.exports = { run, computeMetrics, shouldAnalyze };
