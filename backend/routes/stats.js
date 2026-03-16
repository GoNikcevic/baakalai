const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const claude = require('../api/claude');
const { decrypt } = require('../config/crypto');

const router = Router();

// POST /api/stats/collect
router.post('/collect', async (req, res, next) => {
  try {
    const keyRow = await db.settings.get('lemlist_api_key');
    if (!keyRow) return res.status(400).json({ error: 'Lemlist API key not configured' });

    let apiKey;
    try { apiKey = decrypt(keyRow.value); }
    catch { return res.status(500).json({ error: 'Could not decrypt Lemlist key' }); }

    const basic = Buffer.from(':' + apiKey).toString('base64');
    const campaignsResp = await fetch('https://api.lemlist.com/api/campaigns', {
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    });

    if (!campaignsResp.ok) {
      return res.status(502).json({ error: `Lemlist API error: ${campaignsResp.status}` });
    }

    const lemlistCampaigns = await campaignsResp.json();
    const results = [];

    for (const lc of lemlistCampaigns) {
      const statsResp = await fetch(`https://api.lemlist.com/api/campaigns/${lc._id}/export`, {
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      });

      if (!statsResp.ok) continue;

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
        await db.campaigns.update(campaign.id, {
          nb_prospects: stats.contacts,
          open_rate: stats.openRate,
          reply_rate: stats.replyRate,
          accept_rate_lk: stats.acceptRate,
          interested: stats.interested,
          meetings: stats.meetings,
          status: 'active',
        });
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

      results.push({
        campaign: campaign.name,
        lemlistId: lc._id,
        stats,
        eligible: isEligible,
        analyzed: !!diagnostic,
      });
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
    const campaigns = await db.campaigns.list({ userId: req.user.id });
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

// POST /api/stats/run-orchestrator — Manual trigger for orchestrator jobs
router.post('/run-orchestrator', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const orchestrator = require('../orchestrator');
    const { job } = req.body; // 'collect-stats' | 'consolidate'

    if (job === 'collect-stats') {
      const result = await orchestrator.collectStats.run();
      return res.json({ job, result });
    }
    if (job === 'consolidate') {
      const result = await orchestrator.consolidate.run();
      return res.json({ job, result });
    }

    res.status(400).json({ error: 'Invalid job. Use: collect-stats, consolidate' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
