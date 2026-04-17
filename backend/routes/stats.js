const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const apollo = require('../api/apollo');
const claude = require('../api/claude');
const { decrypt } = require('../config/crypto');

const { statsLimiter } = require('../middleware/rate-limit');

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
router.post('/collect', statsLimiter, async (req, res, next) => {
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

// POST /api/stats/sync-activities — Sync activities from Lemlist + Apollo
router.post('/sync-activities', async (req, res, next) => {
  try {
    const campaigns = await db.campaigns.list({ userId: req.user.id });
    let totalInserted = 0;
    const errors = [];

    // --- Lemlist sync ---
    const lemlistKey = await db.userIntegrations.get(req.user.id, 'lemlist');
    if (lemlistKey) {
      let apiKey;
      try { apiKey = decrypt(lemlistKey.access_token); } catch { apiKey = null; }

      if (apiKey) {
        const linked = campaigns.filter(c => c.lemlist_id);
        const types = ['emailsReplied', 'emailsOpened', 'emailsClicked', 'emailsBounced'];

        for (const campaign of linked) {
          for (const type of types) {
            try {
              const activities = await lemlist.getAllActivities(campaign.lemlist_id, apiKey, type);
              if (!activities || activities.length === 0) continue;

              const mapped = activities.map(a => ({
                userId: req.user.id,
                campaignId: campaign.id,
                lemlistActivityId: a._id || `${campaign.lemlist_id}_${type}_${a.leadEmail || a.leadId}_${a.createdAt || Date.now()}`,
                type,
                leadEmail: a.leadEmail || a.leadId || null,
                leadFirstName: a.leadFirstName || null,
                leadLastName: a.leadLastName || null,
                companyName: a.companyName || null,
                sequenceStep: a.sequenceStep ?? a.sequenceStepNumber ?? null,
                happenedAt: a.createdAt || a.happenedAt || new Date(),
                content: a.extractedText || a.text || a.replyText || a.body || null,
                source: 'lemlist',
              }));

              const inserted = await db.prospectActivities.bulkUpsert(mapped);
              totalInserted += inserted;
            } catch (err) {
              errors.push({ source: 'lemlist', campaign: campaign.name, type, error: err.message });
            }
          }
          if (linked.length > 1) await sleep(300);
        }
      }
    }

    // --- Apollo sync ---
    const apolloKey = await db.userIntegrations.get(req.user.id, 'apollo');
    if (apolloKey) {
      let apiKey;
      try { apiKey = decrypt(apolloKey.access_token); } catch { apiKey = null; }

      if (apiKey) {
        try {
          const apolloCampaigns = await apollo.listCampaigns(apiKey);
          const campaignList = apolloCampaigns.emailer_campaigns || apolloCampaigns || [];

          for (const ac of campaignList) {
            const acId = ac.id || ac._id;
            // Try to find matching Baakalai campaign, or skip (activities still stored with null campaign_id)
            const bkCampaign = campaigns.find(c => c.lemlist_id === acId || c.name === ac.name);

            try {
              const activities = await apollo.getAllActivities(apiKey, acId);
              if (!activities || activities.length === 0) continue;

              const mapped = activities.map(a => ({
                userId: req.user.id,
                campaignId: bkCampaign?.id || null,
                lemlistActivityId: a._id,
                type: a.type,
                leadEmail: a.leadEmail || null,
                leadFirstName: a.leadFirstName || null,
                leadLastName: a.leadLastName || null,
                companyName: a.companyName || null,
                sequenceStep: a.sequenceStep ?? null,
                happenedAt: a.createdAt || new Date(),
                content: a.extractedText || null,
                source: 'apollo',
              }));

              const inserted = await db.prospectActivities.bulkUpsert(mapped);
              totalInserted += inserted;
            } catch (err) {
              errors.push({ source: 'apollo', campaign: ac.name, error: err.message });
            }

            await sleep(300);
          }
        } catch (err) {
          errors.push({ source: 'apollo', error: err.message });
        }
      }
    }

    res.json({
      synced: totalInserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/activities/:campaignId — Get activities for a campaign
router.get('/activities/:campaignId', async (req, res, next) => {
  try {
    const { type, limit, offset } = req.query;
    const activities = await db.prospectActivities.listByCampaign(
      req.params.campaignId,
      { type, limit: parseInt(limit, 10) || 50, offset: parseInt(offset, 10) || 0 }
    );
    const replyCount = await db.prospectActivities.countByCampaign(req.params.campaignId, 'emailsReplied');
    res.json({ activities, replyCount });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/replies — Get all replies across user's campaigns
router.get('/replies', async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    const replies = await db.prospectActivities.listByUser(
      req.user.id,
      { type: 'emailsReplied', limit: parseInt(limit, 10) || 50, offset: parseInt(offset, 10) || 0 }
    );
    res.json({ replies });
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
