const { Router } = require('express');
const db = require('../db');
const lemlist = require('../api/lemlist');
const notionSync = require('../api/notion-sync');
const { notifyCampaignUpdate, notifyUser } = require('../socket');
const { sanitizeObject } = require('../lib/sanitize');
const { getUserKey } = require('../config');
const logger = require('../lib/logger');

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

// GET /api/campaigns — with batch touchpoint loading (no N+1)
router.get('/', async (req, res, next) => {
  try {
    const { status, channel, limit, offset, includeArchived } = req.query;
    const campaigns = await db.campaigns.listWithTouchpoints({
      status,
      channel,
      userId: req.user.id,
      includeArchived: includeArchived === 'true' || status === 'archived',
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });

    res.json({ campaigns });
  } catch (err) {
    next(err);
  }
});

// GET /api/campaigns/:id — batch load all relations (no N+1)
router.get('/:id', async (req, res, next) => {
  try {
    const data = await db.campaigns.getWithRelations(req.params.id);
    if (!data) return res.status(404).json({ error: 'Campaign not found' });
    if (data.campaign.user_id && data.campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns
router.post('/', async (req, res, next) => {
  try {
    const sanitized = sanitizeObject(req.body, ['name', 'client', 'sector', 'position', 'angle', 'zone', 'cta']);
    const campaign = await db.campaigns.create({ ...sanitized, userId: req.user.id });

    if (Array.isArray(req.body.sequence)) {
      let sortCounter = 0;
      const createNode = async (tp, parentBackendId = null, isRoot = true) => {
        const created = await db.touchpoints.create(campaign.id, {
          ...tp,
          sortOrder: sortCounter++,
          parentStepId: parentBackendId,
          isRoot,
        });
        if (Array.isArray(tp.children) && tp.children.length > 0) {
          for (const child of tp.children) {
            await createNode(child, created.id, false);
          }
        }
      };
      for (const tp of req.body.sequence) {
        await createNode(tp, null, true);
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
    let sortCounter = 0;
    const createNode = async (tp, parentBackendId = null, isRoot = true) => {
      const created = await db.touchpoints.create(campaign.id, {
        ...tp,
        sortOrder: sortCounter++,
        parentStepId: parentBackendId,
        isRoot,
      });
      sequence.push({ ...tp, id: created.id, parentStepId: parentBackendId });
      if (Array.isArray(tp.children) && tp.children.length > 0) {
        for (const child of tp.children) {
          await createNode(child, created.id, false);
        }
      }
    };
    for (const tp of tps) {
      await createNode(tp, null, true);
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

// GET /api/campaigns/:id/prospects — list opportunities linked to a campaign
router.get('/:id/prospects', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const prospects = await db.opportunities.listByCampaign(req.params.id);
    res.json({ prospects });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/prospects — bulk add prospects to a campaign
// body: { contacts: [{ name, firstName, lastName, email, title, company, ... }] }
router.post('/:id/prospects', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
    if (contacts.length === 0) return res.status(400).json({ error: 'No contacts provided' });

    const created = [];
    for (const c of contacts) {
      try {
        const opp = await db.opportunities.create({
          userId: req.user.id,
          campaignId: campaign.id,
          name: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unknown',
          title: c.title || null,
          company: c.company || null,
          companySize: c.companySize ? String(c.companySize) : null,
          email: c.email || null,
          status: 'new',
        });
        created.push(opp);
      } catch (err) {
        logger.warn('campaigns', `Failed to create prospect: ${err.message}`);
      }
    }

    // Update campaign nb_prospects
    await db.campaigns.update(campaign.id, { nb_prospects: (campaign.nb_prospects || 0) + created.length });

    res.status(201).json({ created: created.length, prospects: created });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/launch-lemlist
// Creates the Lemlist campaign, deploys sequences, pushes prospects, flips status to active
router.post('/:id/launch-lemlist', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const apiKey = await getUserKey(req.user.id, 'lemlist');
    if (!apiKey) return res.status(400).json({ error: 'Lemlist non configuré. Ajoutez votre clé API dans Intégrations.' });

    // Load sequence + prospects
    const [touchpoints, prospects] = await Promise.all([
      db.touchpoints.listByCampaign(campaign.id),
      db.opportunities.listByCampaign(campaign.id),
    ]);

    if (touchpoints.length === 0) {
      return res.status(400).json({ error: 'Aucune séquence générée. Générez les messages avant de lancer.' });
    }

    const eligibleProspects = prospects.filter(p => p.email);
    if (eligibleProspects.length === 0) {
      return res.status(400).json({ error: 'Aucun prospect avec email. Ajoutez des prospects avant de lancer.' });
    }

    let lemlistCampaignId = campaign.lemlist_id;

    // 1) Create Lemlist campaign if not already linked
    if (!lemlistCampaignId) {
      const created = await lemlist.createCampaign(campaign.name, apiKey);
      lemlistCampaignId = created._id || created.id;
      if (!lemlistCampaignId) {
        return res.status(500).json({ error: 'Lemlist did not return a campaign id' });
      }
      await db.campaigns.update(campaign.id, { lemlist_id: lemlistCampaignId });
    }

    // 2) Push sequence steps
    const sequenceResults = [];
    for (const tp of touchpoints) {
      try {
        const step = {
          type: tp.type,
          subject: tp.subject,
          body: tp.body,
          timing: tp.timing,
        };
        const r = await lemlist.addSequenceStep(lemlistCampaignId, step, apiKey);
        sequenceResults.push({ step: tp.step, ok: true, id: r._id || r.id });
      } catch (err) {
        sequenceResults.push({ step: tp.step, ok: false, error: err.message });
        logger.warn('launch-lemlist', `Sequence step failed: ${err.message}`);
      }
    }

    // 3) Push leads
    const leadResults = { pushed: 0, skipped: 0, errors: [] };
    for (const p of eligibleProspects) {
      try {
        const [firstName, ...rest] = (p.name || '').split(' ');
        await lemlist.addLead(lemlistCampaignId, {
          email: p.email,
          firstName: firstName || '',
          lastName: rest.join(' ') || '',
          company: p.company || '',
          title: p.title || '',
        }, apiKey);
        leadResults.pushed++;
      } catch (err) {
        leadResults.skipped++;
        leadResults.errors.push({ email: p.email, error: err.message });
      }
    }

    // 4) Flip campaign to active
    await db.campaigns.update(campaign.id, {
      status: 'active',
      start_date: new Date().toISOString().split('T')[0],
      nb_prospects: eligibleProspects.length,
      planned: eligibleProspects.length,
    });

    const updated = await db.campaigns.get(campaign.id);
    notifyCampaignUpdate(req.user.id, updated);

    res.json({
      success: true,
      lemlistCampaignId,
      sequenceSteps: sequenceResults,
      leads: leadResults,
      campaign: updated,
    });
  } catch (err) {
    logger.error('launch-lemlist', `Fatal: ${err.message}`);
    next(err);
  }
});

// DELETE /api/campaigns/:id — batch delete related data (no N+1)
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Batch delete related data (no N+1 loops)
    await Promise.all([
      db.touchpoints.deleteByCampaign(campaign.id),
      db.diagnostics.deleteByCampaign(campaign.id),
      db.versions.deleteByCampaign(campaign.id),
    ]);
    await db.campaigns.delete(campaign.id);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
