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

// --- Campaign optimization (manual trigger from Active campaign detail) ---

const OPTIMIZE_MIN_SENT_HARD = 20;   // below this: button blocked
const OPTIMIZE_MIN_SENT_SOFT = 50;   // below this: warning + no memory pattern
const OPTIMIZE_COOLDOWN_DAYS = 7;    // rate limit between optimizations

// Sector benchmarks for diagnostic comparisons
const BENCHMARKS = {
  open_rate: 52,    // average open rate
  reply_rate: 6,    // average reply rate
  accept_rate: 32,  // LinkedIn connection acceptance
};

function scoreTouchpoint(tp) {
  // Compute how far below benchmark each metric is
  const type = tp.type || 'email';
  const isLinkedinInvite = type === 'linkedin_invite' || type === 'linkedin';
  const open = tp.open_rate != null ? Number(tp.open_rate) : null;
  const reply = tp.reply_rate != null ? Number(tp.reply_rate) : null;
  const accept = tp.accept_rate != null ? Number(tp.accept_rate) : null;

  const signals = [];
  let weakness = 0;

  if (isLinkedinInvite) {
    if (accept != null && accept < BENCHMARKS.accept_rate) {
      const delta = BENCHMARKS.accept_rate - accept;
      signals.push(`Acceptation ${accept}% (bench ${BENCHMARKS.accept_rate}%, ${delta}pt en dessous)`);
      weakness += delta * 3;
    }
  } else if (type === 'email') {
    if (open != null && open < BENCHMARKS.open_rate) {
      const delta = BENCHMARKS.open_rate - open;
      signals.push(`Ouverture ${open}% (bench ${BENCHMARKS.open_rate}%, ${delta}pt en dessous)`);
      weakness += delta;
    }
    if (reply != null && reply < BENCHMARKS.reply_rate) {
      const delta = BENCHMARKS.reply_rate - reply;
      signals.push(`Réponse ${reply}% (bench ${BENCHMARKS.reply_rate}%, ${delta}pt en dessous)`);
      weakness += delta * 3;
    }
  }

  return { weakness, signals };
}

// POST /api/campaigns/:id/diagnose — analyze stats and propose optimization
router.post('/:id/diagnose', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const sent = campaign.sent || 0;
    const lastOpt = campaign.last_optimized_at ? new Date(campaign.last_optimized_at) : null;
    const daysSinceLastOpt = lastOpt ? (Date.now() - lastOpt.getTime()) / 86400000 : null;

    // Guard: minimum volume
    if (sent < OPTIMIZE_MIN_SENT_HARD) {
      return res.json({
        guards: {
          canOptimize: false,
          blockedReason: `Au moins ${OPTIMIZE_MIN_SENT_HARD} prospects contactés nécessaires pour optimiser (actuellement : ${sent})`,
        },
        stats: { sent },
      });
    }

    // Check existing A/B test status
    const { resolveActiveABTest } = require('../lib/ab-testing');
    const abStatus = await resolveActiveABTest(campaign.id, req.user.id, { force: false });
    // Dry-run: we don't actually resolve yet, but we check what would happen
    // resolveActiveABTest auto-resolves if significant. If not significant we get { canForce: true }
    // The real resolution happens in /optimize; here we just report the status.

    // Fetch touchpoints to compute diagnostic
    const touchpoints = await db.touchpoints.listByCampaign(campaign.id);

    // Score each touchpoint (skip linkedin_visit since they have no message)
    const scored = touchpoints
      .filter(tp => tp.type !== 'linkedin_visit')
      .map(tp => {
        const { weakness, signals } = scoreTouchpoint(tp);
        return {
          step: tp.step,
          type: tp.type,
          label: tp.label,
          stats: {
            open: tp.open_rate,
            reply: tp.reply_rate,
            accept: tp.accept_rate,
          },
          weakness,
          signals,
        };
      })
      .sort((a, b) => b.weakness - a.weakness);

    // Recommendation: the weakest touchpoint with real signals
    const recommendations = scored
      .filter(s => s.signals.length > 0)
      .slice(0, 1)
      .map(s => ({
        step: s.step,
        severity: s.weakness > 20 ? 'high' : s.weakness > 10 ? 'medium' : 'low',
        reason: s.signals.join(' · '),
      }));

    const warningReason = sent < OPTIMIZE_MIN_SENT_SOFT
      ? `Données limitées (${sent} prospects). Les recommandations seront indicatives. Cette optimisation ne sera pas ajoutée à la mémoire collective.`
      : null;

    const cooldownActive = daysSinceLastOpt !== null && daysSinceLastOpt < OPTIMIZE_COOLDOWN_DAYS;
    const cooldownWarning = cooldownActive
      ? `Dernière optimisation il y a ${Math.round(daysSinceLastOpt)} jours. Il est recommandé d'attendre ${OPTIMIZE_COOLDOWN_DAYS} jours entre deux optimisations pour générer de la data fiable.`
      : null;

    res.json({
      guards: {
        canOptimize: true,
        warningReason,
        cooldownActive,
        cooldownWarning,
      },
      stats: {
        sent,
        touchpoints: scored,
      },
      recommendations,
      abTest: abStatus.hadTest
        ? {
            hadTest: true,
            resolved: abStatus.resolved,
            canForce: abStatus.canForce,
            leader: abStatus.leader,
            improvement: abStatus.improvement,
            daysSinceStart: abStatus.daysSinceStart,
            audience: abStatus.audience,
          }
        : { hadTest: false },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/campaigns/:id/optimize — run the optimization
// Body: { touchpointSteps: ['E2'], hypothesis: '...', forceResolveExisting: bool }
router.post('/:id/optimize', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { touchpointSteps = [], hypothesis = '', forceResolveExisting = false } = req.body;
    if (!Array.isArray(touchpointSteps) || touchpointSteps.length === 0) {
      return res.status(400).json({ error: 'touchpointSteps required' });
    }
    if (touchpointSteps.length > 2) {
      return res.status(400).json({ error: 'Maximum 2 touchpoints per optimization' });
    }

    const sent = campaign.sent || 0;
    if (sent < OPTIMIZE_MIN_SENT_HARD) {
      return res.status(400).json({ error: `Au moins ${OPTIMIZE_MIN_SENT_HARD} prospects contactés requis` });
    }

    // Step 1: Resolve any active A/B test
    const { resolveActiveABTest } = require('../lib/ab-testing');
    const abResult = await resolveActiveABTest(campaign.id, req.user.id, { force: forceResolveExisting });
    if (abResult.hadTest && !abResult.resolved && !forceResolveExisting) {
      return res.status(409).json({
        error: 'Active A/B test not significant yet',
        code: 'ACTIVE_TEST',
        abResult,
      });
    }

    // Step 2: Fetch touchpoints to optimize
    const touchpoints = await db.touchpoints.listByCampaign(campaign.id);
    const targetTps = touchpoints.filter(tp => touchpointSteps.includes(tp.step));
    if (targetTps.length === 0) {
      return res.status(400).json({ error: 'No matching touchpoints found' });
    }

    // Step 3: Regenerate via Claude
    const claude = require('../api/claude');
    const originalMessages = targetTps.map(tp => ({
      step: tp.step,
      type: tp.type,
      subject: tp.subject,
      body: tp.body,
      openRate: tp.open_rate,
      replyRate: tp.reply_rate,
      acceptRate: tp.accept_rate,
    }));

    const regenResult = await claude.regenerateSequence({
      sector: campaign.sector || '',
      position: campaign.position || '',
      size: campaign.size || '',
      angle: campaign.angle || '',
      tone: campaign.tone || 'Pro décontracté',
      formality: campaign.formality || 'Vous',
      valueProp: '',
      painPoints: '',
      originalMessages,
      diagnostic: hypothesis || 'Optimisation manuelle déclenchée par l\'utilisateur',
      memory: [],
      touchpointsToRegenerate: touchpointSteps,
    });

    // Step 4: Parse regen result and update touchpoints with variant B
    const regenMessages = regenResult.parsed?.messages || [];
    const updatedVariants = [];

    for (const tp of targetTps) {
      const msg = regenMessages.find(m => m.step === tp.step);
      if (!msg || !msg.variantB) continue;

      const variantB = msg.variantB;
      const subjectB = variantB.subject || null;
      const bodyB = variantB.body || '';

      await db.touchpoints.update(tp.id, {
        subject_b: tp.type === 'email' ? subjectB : null,
        body_b: bodyB,
      });

      updatedVariants.push({
        step: tp.step,
        a: { subject: tp.subject, body: tp.body },
        b: { subject: tp.type === 'email' ? subjectB : null, body: bodyB },
        hypothesis: variantB.hypothesis || hypothesis,
      });

      // Push variant B to Lemlist if the campaign is linked
      if (campaign.lemlist_id) {
        try {
          const apiKey = await getUserKey(req.user.id, 'lemlist');
          if (apiKey) {
            const lemlistSequences = await lemlist.getSequences(campaign.lemlist_id);
            const stepIndex = parseInt((tp.step || '').replace(/[^\d]/g, ''), 10) - 1;
            const lemlistStep = Array.isArray(lemlistSequences) ? lemlistSequences[stepIndex] : null;
            if (lemlistStep && lemlistStep._id) {
              await lemlist.updateSequenceStep(campaign.lemlist_id, lemlistStep._id, {
                subjectB: tp.type === 'email' ? (subjectB || '') : '',
                textB: bodyB,
                messageB: bodyB,
              });
            }
          }
        } catch (err) {
          logger.warn('optimize', `Lemlist variant B push failed for ${tp.step}: ${err.message}`);
        }
      }
    }

    if (updatedVariants.length === 0) {
      return res.status(500).json({ error: 'Claude did not generate any valid variants' });
    }

    // Step 5: Create a new versions entry
    const existing = await db.versions.listByCampaign(campaign.id);
    const nextVersion = (existing[0]?.version || 0) + 1;
    const version = await db.versions.create(campaign.id, {
      version: nextVersion,
      hypotheses: hypothesis || updatedVariants.map(v => v.hypothesis).filter(Boolean).join(' · '),
      result: 'testing',
      messagesModified: touchpointSteps,
      testedSteps: touchpointSteps,
    });

    // Step 6: Update last_optimized_at
    await db.campaigns.update(campaign.id, {
      last_optimized_at: new Date().toISOString(),
    });

    notifyUser(req.user.id, 'campaign:optimized', {
      campaignId: campaign.id,
      steps: touchpointSteps,
      versionId: version.id,
    });

    res.json({
      success: true,
      variants: updatedVariants,
      version,
      abResolved: abResult.resolved ? { winner: abResult.winner, improvement: abResult.improvement, auto: abResult.auto, forced: abResult.forced } : null,
    });
  } catch (err) {
    logger.error('optimize', `Failed for campaign ${req.params.id}: ${err.message}`);
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
          linkedinUrl: c.linkedinUrl || null,
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

// DELETE /api/campaigns/:id/prospects/:prospectId — remove a single prospect from a campaign
router.delete('/:id/prospects/:prospectId', async (req, res, next) => {
  try {
    const opp = await db.opportunities.get(req.params.prospectId);
    if (!opp) return res.status(404).json({ error: 'Prospect not found' });
    if (opp.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (opp.campaign_id !== req.params.id) {
      return res.status(400).json({ error: 'Prospect does not belong to this campaign' });
    }
    await db.opportunities.delete(opp.id);
    // Decrement campaign nb_prospects
    const campaign = await db.campaigns.get(req.params.id);
    if (campaign && campaign.nb_prospects > 0) {
      await db.campaigns.update(campaign.id, { nb_prospects: campaign.nb_prospects - 1 });
    }
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/campaigns/:id/prospects — remove ALL prospects from a campaign (bulk clear)
router.delete('/:id/prospects', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await db.query(
      'DELETE FROM opportunities WHERE campaign_id = $1 AND user_id = $2',
      [campaign.id, req.user.id]
    );
    await db.campaigns.update(campaign.id, { nb_prospects: 0 });
    res.json({ deleted: result.rowCount || 0 });
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

    const allEligible = prospects.filter(p => p.email);
    if (allEligible.length === 0) {
      return res.status(400).json({ error: 'Aucun prospect avec email. Ajoutez des prospects avant de lancer.' });
    }

    // Batch mode: if request asks for batches OR campaign already has batch_mode,
    // only push a subset of prospects (the current batch).
    const wantBatch = req.body.batchMode === true || campaign.batch_mode;
    const batchSize = req.body.batchSize || campaign.batch_size || 100;
    let eligibleProspects = allEligible;
    let batchInfo = null;

    if (wantBatch && allEligible.length > batchSize) {
      const nextBatch = (campaign.current_batch || 0) + 1;
      const totalBatches = Math.ceil(allEligible.length / batchSize);

      // Assign batch numbers to unassigned prospects
      const unassigned = allEligible.filter(p => !p.batch_number || p.batch_number === 0);
      const thisBatchProspects = unassigned.slice(0, batchSize);

      // Mark these prospects with their batch number in DB
      for (const p of thisBatchProspects) {
        await db.opportunities.update(p.id, { batch_number: nextBatch });
      }

      // Update campaign batch tracking
      await db.campaigns.update(campaign.id, {
        batch_mode: true,
        batch_size: batchSize,
        current_batch: nextBatch,
        total_batches: totalBatches,
      });

      eligibleProspects = thisBatchProspects;
      batchInfo = {
        batch: nextBatch,
        totalBatches,
        batchSize: thisBatchProspects.length,
        remaining: allEligible.length - (nextBatch * batchSize),
      };

      logger.info('launch-lemlist', `Batch mode: launching batch ${nextBatch}/${totalBatches} (${thisBatchProspects.length} prospects)`);
    }

    let lemlistCampaignId = campaign.lemlist_id;

    // 1) Create Lemlist campaign if not already linked
    if (!lemlistCampaignId) {
      const created = await lemlist.createCampaign(campaign.name, apiKey);
      lemlistCampaignId = created._id || created.id;
      if (!lemlistCampaignId) {
        return res.status(500).json({ error: 'Lemlist n\'a pas retourné d\'ID de campagne. Vérifiez votre plan Lemlist et votre clé API.' });
      }
      await db.campaigns.update(campaign.id, { lemlist_id: lemlistCampaignId });
    }

    // 2) Resolve the sequenceId once (Lemlist auto-creates one sequence per
    //    campaign). Previously we were calling the wrong endpoint per step
    //    and silently 404ing, leaving campaigns empty in Lemlist.
    let sequenceId;
    try {
      sequenceId = await lemlist.resolveSequenceId(lemlistCampaignId, apiKey);
    } catch (err) {
      logger.error('launch-lemlist', `sequenceId resolution failed: ${err.message}`);
      return res.status(502).json({
        error: `Impossible de récupérer la séquence Lemlist de la campagne (${err.message}). Vérifie que la campagne existe dans ton compte Lemlist.`,
      });
    }

    // 3) Push sequence steps (all to the same sequenceId, no N+1)
    const sequenceResults = [];
    for (const tp of touchpoints) {
      try {
        const step = {
          type: tp.type,
          subject: tp.subject,
          body: tp.body,
          timing: tp.timing,
          sequenceId, // pre-resolved, saves a round-trip per step
        };
        const r = await lemlist.addSequenceStep(lemlistCampaignId, step, apiKey);
        sequenceResults.push({ step: tp.step, ok: true, id: r._id || r.id });
      } catch (err) {
        sequenceResults.push({ step: tp.step, ok: false, error: err.message });
        logger.warn('launch-lemlist', `Sequence step ${tp.step} failed: ${err.message}`);
      }
    }

    // 4) Push leads
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

    // 5) Start the Lemlist campaign (idempotent — no-op if already running)
    //    We only start if at least one sequence step and one lead were pushed,
    //    otherwise Lemlist would start an empty campaign with nothing to send.
    let started = false;
    let startError = null;
    const someStepsPushed = sequenceResults.some(r => r.ok);
    if (someStepsPushed && leadResults.pushed > 0) {
      try {
        await lemlist.startCampaign(lemlistCampaignId, apiKey);
        started = true;
      } catch (err) {
        startError = err.message;
        logger.warn('launch-lemlist', `Auto-start failed (campaign stays in draft): ${err.message}`);
      }
    }

    // 6) Flip Baakalai campaign to active
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
      started,
      startError,
      campaign: updated,
      batch: batchInfo,
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
