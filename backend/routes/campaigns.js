const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const notionSync = require('../api/notion-sync');
const { notifyCampaignUpdate, notifyUser } = require('../socket');

const router = Router();

// GET /api/campaigns/lemlist/list
router.get('/lemlist/list', async (_req, res, next) => {
  try {
    const campaigns = await lemlist.listCampaigns();
    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns
router.get('/', async (req, res, next) => {
  try {
    const { status, channel } = req.query;
    const campaigns = await db.campaigns.list({ status, channel, userId: req.user.id });

    const result = [];
    for (const c of campaigns) {
      const sequence = await db.touchpoints.listByCampaign(c.id);
      result.push({ ...c, sequence });
    }

    res.json({ campaigns: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id
router.get('/:id', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      campaign,
      sequence: await db.touchpoints.listByCampaign(campaign.id),
      diagnostics: await db.diagnostics.listByCampaign(campaign.id),
      history: await db.versions.listByCampaign(campaign.id),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns
router.post('/', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.create({ ...req.body, userId: req.user.id });

    if (Array.isArray(req.body.sequence)) {
      for (let i = 0; i < req.body.sequence.length; i++) {
        await db.touchpoints.create(campaign.id, { ...req.body.sequence[i], sortOrder: i });
      }
    }

    notionSync.syncCampaign(campaign.id).catch(console.error);
    notifyCampaignUpdate(req.user.id, campaign);
    res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/campaigns/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await db.campaigns.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Campaign not found' });
    if (existing.user_id && existing.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updated = await db.campaigns.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'No changes' });

    notionSync.syncCampaign(updated.id).catch(console.error);
    notifyCampaignUpdate(req.user.id, updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/campaigns/:id/sequence
router.put('/:id/sequence', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.touchpoints.deleteByCampaign(campaign.id);
    const sequence = [];
    const tps = req.body.sequence || [];
    for (let i = 0; i < tps.length; i++) {
      const created = await db.touchpoints.create(campaign.id, { ...tps[i], sortOrder: i });
      sequence.push({ ...tps[i], id: created.id });
    }

    res.json({ sequence });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/sync-stats
router.post('/:id/sync-stats', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!campaign.lemlist_id) {
      return res.status(400).json({ error: 'No Lemlist ID linked to this campaign' });
    }

    const rawStats = await lemlist.getCampaignStats(campaign.lemlist_id);
    const stats = lemlist.transformCampaignStats(rawStats);

    await db.campaigns.update(campaign.id, {
      nb_prospects: stats.contacts,
      open_rate: stats.openRate,
      reply_rate: stats.replyRate,
      accept_rate_lk: stats.acceptRate,
      interested: stats.interested,
      last_collected: new Date().toISOString().split('T')[0],
    });

    notionSync.syncCampaign(campaign.id).catch(console.error);
    notifyUser(req.user.id, 'stats:refreshed', { campaignId: campaign.id, stats });
    res.json({ stats, synced: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/versions
router.post('/:id/versions', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const existing = await db.versions.listByCampaign(campaign.id);
    const nextVersion = (existing[0]?.version || 0) + 1;

    const version = await db.versions.create(campaign.id, {
      version: nextVersion,
      ...req.body,
    });

    notionSync.syncVersion(version.id, campaign.id).catch(console.error);
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete related data first
    await db.touchpoints.deleteByCampaign(campaign.id);
    const diagnostics = await db.diagnostics.listByCampaign(campaign.id);
    for (const d of diagnostics) {
      await db.diagnostics.delete(d.id);
    }
    const versions = await db.versions.listByCampaign(campaign.id);
    for (const v of versions) {
      await db.versions.delete(v.id);
    }
    await db.campaigns.delete(campaign.id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
