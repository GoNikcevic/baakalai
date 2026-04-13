const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const claude = require('../api/claude');
const { decrypt } = require('../config/crypto');

const router = Router();

// Concurrency limiter for Lemlist API calls
const LEMLIST_CONCURRENCY = 3;
const LEMLIST_DELAY_MS = 500; // Delay between batches to respect rate limits

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.status === 429) {
      // Rate limited — exponential backoff
      const backoff = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[stats] Lemlist rate limited, backing off ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    return resp;
  }
  return null;
}

// POST /api/stats/collect — with rate limiting and concurrency control
router.post('/collect', async (req, res, next) => {
  try {
    const keyRow = await db.userIntegrations.get(req.user.id, 'lemlist');
    if (!keyRow) return res.status(400).json({ error: 'Lemlist API key not configured' });

    let apiKey;
    try { apiKey = decrypt(keyRow.access_token); }
    catch { return res.status(500).json({ error: 'Could not decrypt Lemlist key' }); }

    const basic = Buffer.from(':' + apiKey).toString('base64');
    const headers = { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' };

    const campaignsResp = await fetchWithRetry('https://api.lemlist.com/api/campaigns', { headers });
    if (!campaignsResp || !campaignsResp.ok) {
      return res.status(502).json({ error: `Lemlist API error: ${campaignsResp?.status || 'timeout'}` });
    }

    const lemlistCampaigns = await campaignsResp.json();
    const results = [];

    // Process campaigns in batches to control concurrency
    for (let batch = 0; batch < lemlistCampaigns.length; batch += LEMLIST_CONCURRENCY) {
      const batchCampaigns = lemlistCampaigns.slice(batch, batch + LEMLIST_CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batchCampaigns.map(async (lc) => {
          const statsResp = await fetchWithRetry(
            `https://api.lemlist.com/api/campaigns/${lc._id}/export`,
            { headers }
          );

          if (!statsResp || !statsResp.ok) return null;

          const rawStats = await statsResp.json();
          const stats = lemlist.transformCampaignStats(rawStats);

          let campaign = await db.campaigns.getByLemlistId(lc._id);
          if (!campaign) {
            campaign = await db.campaigns.create({
              name: lc.name,
              client: 'Lemlist Import',
              status: 'active',
              channel: 'email',
              lemlistId: lc._id,
              nbProspects: stats.contacts,
              userId: req.user.id,
            });
          } else {
            // Preserve archived status — don't un-archive on sync
            const updates = {
              nb_prospects: stats.contacts,
              open_rate: stats.openRate,
              reply_rate: stats.replyRate,
              accept_rate_lk: stats.acceptRate,
              interested: stats.interested,
              meetings: stats.meetings,
            };
            if (campaign.status !== 'archived') {
              updates.status = 'active';
            }
            await db.campaigns.update(campaign.id, updates);
          }

          const isEligible = stats.contacts > 50;
          let diagnostic = null;

          if (isEligible) {
            try {
              const stepStats = {};
              for (let i = 0; i < 6; i++) {
                const ss = lemlist.transformStepStats(rawStats, i);
                if (ss) stepStats[`E${i + 1}`] = ss;
              }

              const analysisResult = await claude.analyzeCampaign({
                campaignName: campaign.name,
                stats,
                stepStats,
                sector: campaign.sector || '',
                position: campaign.position || '',
              });

              diagnostic = analysisResult.parsed || analysisResult.content;

              await db.diagnostics.create(campaign.id, {
                diagnostic: typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic),
                priorities: analysisResult.parsed?.priorities || [],
              });
            } catch (err) {
              diagnostic = { error: err.message };
            }
          }

          return {
            campaign: campaign.name,
            lemlistId: lc._id,
            stats,
            eligible: isEligible,
            analyzed: !!diagnostic,
          };
        })
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
        }
      }

      // Delay between batches to respect Lemlist rate limits
      if (batch + LEMLIST_CONCURRENCY < lemlistCampaigns.length) {
        await sleep(LEMLIST_DELAY_MS);
      }
    }

    res.json({
      collected: results.length,
      analyzed: results.filter(r => r.analyzed).length,
      campaigns: results,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/latest
router.get('/latest', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const campaigns = await db.campaigns.list({ userId: req.user.id, limit });
    const result = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      channel: c.channel,
      kpis: {
        contacts: c.nb_prospects,
        openRate: c.open_rate,
        replyRate: c.reply_rate,
        acceptRate: c.accept_rate_lk,
        interested: c.interested,
        meetings: c.meetings,
      },
    }));
    res.json({ campaigns: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/diagnostics/:campaignId
router.get('/diagnostics/:campaignId', async (req, res, next) => {
  try {
    const diagnostics = await db.diagnostics.listByCampaign(req.params.campaignId);
    res.json({ diagnostics });
  } catch (err) {
    next(err);
  }
});

// POST /api/stats/run-orchestrator
router.post('/run-orchestrator', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const orchestrator = require('../orchestrator');
    const { job } = req.body;

    if (job === 'collect-stats') {
      const result = await orchestrator.collectStats.run();
      return res.json({ job, result });
    }
    if (job === 'consolidate') {
      const result = await orchestrator.consolidate.run();
      return res.json({ job, result });
    }
    if (job === 'batch-orchestrator') {
      const result = await orchestrator.runBatchOrchestrator();
      return res.json({ job, result });
    }

    res.status(400).json({ error: 'Invalid job. Use: collect-stats, consolidate, batch-orchestrator' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
