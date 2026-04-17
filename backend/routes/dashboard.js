const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const { kpiCache } = require('../lib/cache');
const { getUserKey } = require('../config');
const hubspotSync = require('../orchestrator/jobs/hubspot-sync');

const router = Router();

// GET /api/dashboard — Aggregated KPIs + active campaigns (cached 5 min)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cacheKey = `kpis:${userId}`;
    const cached = kpiCache.get(cacheKey);

    if (cached) {
      return res.json(cached);
    }

    const [kpis, campaigns] = await Promise.all([
      db.dashboardKpis(userId),
      db.campaigns.list({ status: 'active', userId, limit: 50 }),
    ]);

    // Auto-sync stats from Lemlist if campaigns have null open_rate
    // (means stats were never collected with the working v2 endpoint)
    const stale = campaigns.some(c => c.lemlist_id && c.open_rate == null);
    if (stale) {
      // Fire-and-forget: sync in background, don't block dashboard load
      syncStatsBackground(userId).catch(() => {});
    }

    const result = { kpis, campaigns };
    kpiCache.set(cacheKey, result, 5 * 60 * 1000); // 5 min TTL
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * Background stats sync — pulls fresh stats from Lemlist for all
 * user campaigns and updates the DB. Called automatically when the
 * dashboard detects stale data (open_rate == null).
 */
async function syncStatsBackground(userId) {
  try {
    const apiKey = await getUserKey(userId, 'lemlist');
    if (!apiKey) return;

    const campaigns = await db.campaigns.list({ userId });
    const linked = campaigns.filter(c => c.lemlist_id);

    for (const campaign of linked) {
      try {
        const rawStats = await lemlist.getCampaignStats(campaign.lemlist_id, apiKey);
        const stats = lemlist.transformCampaignStats(rawStats);
        await db.campaigns.update(campaign.id, {
          nb_prospects: stats.contacts,
          open_rate: stats.openRate,
          reply_rate: stats.replyRate,
          accept_rate_lk: stats.acceptRate,
          interested: stats.interested,
          meetings: stats.meetings,
          stops: stats.stops,
          last_collected: new Date().toISOString().split('T')[0],
        });
      } catch (err) {
        console.warn(`[dashboard] Stats sync failed for ${campaign.name}:`, err.message);
      }
    }

    // Invalidate KPI cache so next load shows fresh data
    kpiCache.invalidate(`kpis:${userId}`);
  } catch (err) {
    console.warn('[dashboard] Background stats sync failed:', err.message);
  }
}

// POST /api/dashboard/refresh-stats — Manual refresh of Lemlist stats
router.post('/refresh-stats', async (req, res, next) => {
  try {
    const apiKey = await getUserKey(req.user.id, 'lemlist');
    if (!apiKey) return res.json({ ok: false, error: 'No Lemlist API key' });

    const campaigns = await db.campaigns.list({ userId: req.user.id });
    const linked = campaigns.filter(c => c.lemlist_id);
    const results = [];

    for (const campaign of linked) {
      try {
        const rawStats = await lemlist.getCampaignStats(campaign.lemlist_id, apiKey);
        const stats = lemlist.transformCampaignStats(rawStats);
        await db.campaigns.update(campaign.id, {
          nb_prospects: stats.contacts,
          open_rate: stats.openRate,
          reply_rate: stats.replyRate,
          accept_rate_lk: stats.acceptRate,
          interested: stats.interested,
          meetings: stats.meetings,
          stops: stats.stops,
          last_collected: new Date().toISOString().split('T')[0],
        });
        results.push({ campaign: campaign.name, stats, raw: rawStats ? Object.keys(rawStats) : null });
      } catch (err) {
        results.push({ campaign: campaign.name, error: err.message });
      }
    }

    kpiCache.invalidate(`kpis:${req.user.id}`);
    const kpis = await db.dashboardKpis(req.user.id);
    res.json({ ok: true, kpis, results });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/memory — Cross-campaign patterns (paginated)
router.get('/memory', async (req, res, next) => {
  try {
    const { category, confidence } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const patterns = await db.memoryPatterns.list({ category, confidence, limit, offset });

    res.json({ patterns });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/opportunities (paginated)
router.get('/opportunities', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const opportunities = await db.opportunities.listByUser(req.user.id, limit, offset);
    res.json({ opportunities });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/reports (paginated)
router.get('/reports', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const reports = await db.reports.listByUser(req.user.id, limit, offset);
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/chart-data
router.get('/chart-data', async (req, res, next) => {
  try {
    const data = await db.chartData.listByUser(req.user.id);
    res.json({ chartData: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/dashboard/opportunities — Create opportunity (invalidates KPI cache)
router.post('/opportunities', async (req, res, next) => {
  try {
    const opportunity = await db.opportunities.create({ ...req.body, userId: req.user.id });

    // Invalidate KPI cache for this user
    kpiCache.invalidate(`kpis:${req.user.id}`);

    hubspotSync.onStatusChange({
      opportunityId: opportunity.id,
      newStatus: opportunity.status,
    }).catch(console.error);

    res.status(201).json(opportunity);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/dashboard/opportunities/:id
router.patch('/opportunities/:id', async (req, res, next) => {
  try {
    const existing = await db.opportunities.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Opportunity not found' });
    if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await db.opportunities.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'No changes' });

    const newStatus = req.body.status;
    if (newStatus && newStatus !== existing.status) {
      hubspotSync.onStatusChange({
        opportunityId: updated.id,
        newStatus,
      }).catch(console.error);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/dashboard/recommendation-feedback
router.post('/recommendation-feedback', async (req, res, next) => {
  try {
    const { patternId, patternText, feedback } = req.body;
    if (!feedback || !['useful', 'not_useful'].includes(feedback)) {
      return res.status(400).json({ error: 'Invalid feedback' });
    }
    const result = await db.recoFeedback.create(req.user.id, patternId || null, patternText, feedback);

    // If not_useful, lower confidence of the pattern
    if (feedback === 'not_useful' && patternId) {
      const pattern = await db.memoryPatterns.get(patternId);
      if (pattern && pattern.confidence === 'Haute') {
        await db.memoryPatterns.update(patternId, { confidence: 'Moyenne' });
      } else if (pattern && pattern.confidence === 'Moyenne') {
        await db.memoryPatterns.update(patternId, { confidence: 'Faible' });
      }
    }

    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
