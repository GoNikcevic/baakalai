const { Router } = require('express');
const claude = require('../api/claude');
const lemlist = require('../api/lemlist');
const db = require('../db');
const notionSync = require('../api/notion-sync');
const dryRun = require('../api/dry-run');
const regenerateJob = require('../orchestrator/jobs/regenerate');
const logger = require('../lib/logger');

const router = Router();

function isDryRun(req) {
  return req.query.dry_run === 'true' || req.query.dry_run === '1';
}

// Enrich params with user profile defaults and document context
async function enrichWithProfile(params, userId) {
  // Load profile and docs in parallel
  const [profile, docs] = await Promise.all([
    db.profiles.get(userId),
    db.documents.getParsedTextByUser(userId, 5),
  ]);

  if (profile) {
    if (!params.companyName && profile.company) params.companyName = profile.company;
    if (!params.sector && profile.sector) params.sector = profile.sector;
    if (!params.valueProp && profile.value_prop) params.valueProp = profile.value_prop;
    if (!params.painPoints && profile.pain_points) params.painPoints = profile.pain_points;
    if (!params.socialProof && profile.social_proof) params.socialProof = profile.social_proof;
    if (!params.tone && profile.default_tone) params.tone = profile.default_tone;
    if (!params.formality && profile.default_formality) params.formality = profile.default_formality;
    if (!params.zone && profile.target_zones) params.zone = profile.target_zones;
    if (!params.position && profile.persona_primary) params.position = profile.persona_primary;
    if (!params.size && profile.target_size) params.size = profile.target_size;
    if (profile.avoid_words) params.avoidWords = profile.avoid_words;
    if (profile.signature_phrases) params.signaturePhrases = profile.signature_phrases;
    if (profile.objections) params.objections = profile.objections;
  }

  if (docs && docs.length > 0) {
    const docText = docs
      .map(d => `[${d.original_name}] ${(d.parsed_text || '').slice(0, 1500)}`)
      .join('\n\n');
    params.documentContext = docText.slice(0, 6000);
  }

  return params;
}

/**
 * Save a tree of touchpoints recursively.
 * Each node may have .children[] which are also saved with parent_step_id set.
 */
async function saveTouchpointTree(campaignId, nodes, parentId = null, startSort = 0) {
  let sortOrder = startSort;
  for (const node of nodes) {
    const saved = await db.touchpoints.create(campaignId, {
      step: node.step,
      type: node.type,
      label: node.label || '',
      subType: node.subType || '',
      timing: node.timing || '',
      subject: node.subject || null,
      body: node.body || '',
      maxChars: node.type === 'linkedin' && node.step?.startsWith('L') ? 300 : null,
      sortOrder,
      parentStepId: parentId,
      conditionType: node.conditionType || null,
      conditionValue: node.conditionValue || null,
      branchLabel: node.branchLabel || null,
      isRoot: !parentId,
    });
    sortOrder++;
    if (node.children && node.children.length > 0) {
      sortOrder = await saveTouchpointTree(campaignId, node.children, saved.id, sortOrder);
    }
  }
  return sortOrder;
}

// POST /api/ai/generate-sequence
router.post('/generate-sequence', async (req, res, next) => {
  try {
    const params = await enrichWithProfile(req.body, req.user.id);

    if (!params.sector && !params.position) {
      return res.status(400).json({ error: 'Au moins sector ou position requis' });
    }

    const result = isDryRun(req)
      ? dryRun.generateSequence(params)
      : await claude.generateSequence(params);

    if (params.campaignId && result.parsed?.sequence) {
      await db.touchpoints.deleteByCampaign(params.campaignId);
      // Check if any node has children (conditional branches)
      const hasTree = result.parsed.sequence.some(tp => tp.children && tp.children.length > 0);
      if (hasTree) {
        await saveTouchpointTree(params.campaignId, result.parsed.sequence);
      } else {
        for (let i = 0; i < result.parsed.sequence.length; i++) {
          const tp = result.parsed.sequence[i];
          await db.touchpoints.create(params.campaignId, {
            step: tp.step,
            type: tp.type,
            label: tp.label,
            subType: tp.subType,
            timing: tp.timing,
            subject: tp.subject,
            body: tp.body,
            maxChars: tp.maxChars || (tp.step.startsWith('L') && tp.step.includes('1') ? 300 : null),
            sortOrder: i,
          });
        }
      }
    }

    res.json({
      sequence: result.parsed?.sequence || [],
      strategy: result.parsed?.strategy || '',
      hypotheses: result.parsed?.hypotheses || [],
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/generate-touchpoint
router.post('/generate-touchpoint', async (req, res, next) => {
  try {
    const { type, ...rawParams } = req.body;
    const params = await enrichWithProfile(rawParams, req.user.id);

    if (!type) {
      return res.status(400).json({
        error: 'Type de touchpoint requis',
        validTypes: ['emailInitial', 'emailValue', 'emailRelance', 'emailBreakup', 'linkedinConnection', 'linkedinMessage', 'subjectLines'],
      });
    }

    const result = isDryRun(req)
      ? dryRun.generateTouchpoint(type, params)
      : await claude.generateTouchpoint(type, params);

    res.json({
      touchpoint: result.parsed || {},
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/analyze
router.post('/analyze', async (req, res, next) => {
  try {
    const { campaignId } = req.body;
    const campaign = await db.campaigns.get(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const sequence = await db.touchpoints.listByCampaign(campaignId);

    const result = isDryRun(req)
      ? dryRun.analyzeCampaign({ ...campaign, sequence })
      : await claude.analyzeCampaign({ ...campaign, sequence });

    const priorities = result.parsed?.priorities?.map(p => p.step)
      || extractPriorities(result.diagnostic);

    const diag = await db.diagnostics.create(campaignId, {
      diagnostic: result.diagnostic,
      priorities,
      nbToOptimize: priorities.length,
    });

    notionSync.syncDiagnostic(diag.id, campaignId).catch(console.error);

    res.json({
      id: diag.id,
      diagnostic: result.diagnostic,
      parsed: result.parsed || null,
      priorities,
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/regenerate — bounded memory loading
router.post('/regenerate', async (req, res, next) => {
  try {
    const { campaignId, diagnostic, originalMessages, clientParams, regenerationInstructions } = req.body;

    // Bounded: only load relevant patterns (limit 30)
    const memory = await db.memoryPatterns.list({ limit: 30 });

    const result = isDryRun(req)
      ? dryRun.regenerateSequence({ diagnostic, originalMessages, memory, clientParams })
      : await claude.regenerateSequence({ diagnostic, originalMessages, memory, clientParams, regenerationInstructions });

    if (campaignId) {
      const existing = await db.versions.listByCampaign(campaignId);
      const nextVersion = (existing[0]?.version || 0) + 1;

      const version = await db.versions.create(campaignId, {
        version: nextVersion,
        messagesModified: result.parsed?.messages?.map((m) => m.step) || [],
        hypotheses: result.parsed?.summary || result.parsed?.hypotheses?.join('; ') || '',
        result: 'testing',
      });

      notionSync.syncVersion(version.id, campaignId).catch(console.error);
    }

    res.json({
      messages: result.parsed?.messages || [],
      summary: result.parsed?.summary || result.raw,
      hypotheses: result.parsed?.hypotheses || [],
      expectedImpact: result.parsed?.expectedImpact || null,
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/run-refinement
router.post('/run-refinement', async (req, res, next) => {
  try {
    const { campaignId } = req.body;
    const campaign = await db.campaigns.get(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const [sequence, memory] = await Promise.all([
      db.touchpoints.listByCampaign(campaignId),
      db.memoryPatterns.list({ limit: 30 }),
    ]);

    const originalMessages = sequence.map(tp => ({
      step: tp.step, subject: tp.subject, body: tp.body,
    }));

    const result = isDryRun(req)
      ? dryRun.runRefinementLoop({ ...campaign, sequence }, originalMessages, memory)
      : await claude.runRefinementLoop({ ...campaign, sequence }, originalMessages, memory);

    const diagPriorities = result.analysis.parsed?.priorities?.map(p => p.step)
      || extractPriorities(result.analysis.diagnostic);

    const diag = await db.diagnostics.create(campaignId, {
      diagnostic: result.analysis.diagnostic,
      priorities: diagPriorities,
      nbToOptimize: diagPriorities.length,
    });

    notionSync.syncDiagnostic(diag.id, campaignId).catch(console.error);

    let versionId = null;
    if (result.regeneration) {
      const existing = await db.versions.listByCampaign(campaignId);
      const nextVersion = (existing[0]?.version || 0) + 1;

      const version = await db.versions.create(campaignId, {
        version: nextVersion,
        messagesModified: result.stepsRegenerated,
        hypotheses: result.regeneration.parsed?.summary || result.regeneration.parsed?.hypotheses?.join('; ') || '',
        result: 'testing',
      });
      versionId = version.id;

      notionSync.syncVersion(version.id, campaignId).catch(console.error);
    }

    await db.campaigns.update(campaignId, { status: 'optimizing' });

    res.json({
      diagnosticId: diag.id,
      versionId,
      analysis: {
        summary: result.analysis.parsed?.summary || result.analysis.diagnostic,
        priorities: result.analysis.parsed?.priorities || [],
        overallScore: result.analysis.parsed?.overallScore || null,
      },
      regeneration: result.regeneration ? {
        messages: result.regeneration.parsed?.messages || [],
        summary: result.regeneration.parsed?.summary || '',
        hypotheses: result.regeneration.parsed?.hypotheses || [],
        expectedImpact: result.regeneration.parsed?.expectedImpact || null,
      } : null,
      stepsRegenerated: result.stepsRegenerated,
      totalUsage: result.totalUsage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/generate-variables
router.post('/generate-variables', async (req, res, next) => {
  try {
    const params = req.body;
    if (!params.sector) {
      return res.status(400).json({ error: 'Secteur requis pour la génération de variables' });
    }

    const result = isDryRun(req)
      ? dryRun.generateVariables(params)
      : await claude.generateVariables(params);

    res.json({
      reasoning: result.parsed?.reasoning || '',
      chain: result.parsed?.chain || [],
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/consolidate-memory — bounded loading with JOINs
router.post('/consolidate-memory', async (req, res, next) => {
  try {
    // Use JOIN to load diagnostics with campaign info in a single query
    const allDiagnostics = await db.diagnostics.listByUserCampaigns(req.user.id, 100);
    const existingMemory = await db.memoryPatterns.list({ limit: 200 });

    const result = isDryRun(req)
      ? dryRun.consolidateMemory(allDiagnostics, existingMemory)
      : await claude.consolidateMemory(allDiagnostics, existingMemory);

    const saved = [];
    if (result.parsed?.patterns) {
      for (const pattern of result.parsed.patterns) {
        const created = await db.memoryPatterns.create({
          pattern: pattern.pattern,
          category: pattern.categorie,
          data: pattern.donnees,
          confidence: pattern.confiance,
          sectors: pattern.secteurs || [],
          targets: pattern.cibles || [],
        });
        saved.push(created.id);
        notionSync.syncMemoryPattern(created.id).catch(console.error);
      }
    }

    if (result.parsed?.updatedPatterns) {
      for (const update of result.parsed.updatedPatterns) {
        if (update.existingId && update.newConfidence) {
          await db.memoryPatterns.update(update.existingId, { confidence: update.newConfidence });
        }
      }
    }

    res.json({
      patternsCreated: saved.length,
      patternsUpdated: result.parsed?.updatedPatterns?.length || 0,
      contradictions: result.parsed?.contradictions || [],
      summary: result.parsed?.summary || result.raw,
      usage: result.usage,
      dryRun: isDryRun(req),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/memory — paginated
router.get('/memory', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const [patterns, count] = await Promise.all([
      db.memoryPatterns.list({ limit, offset }),
      db.memoryPatterns.count(),
    ]);
    res.json({ patterns, count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/diagnostics/:campaignId
router.get('/diagnostics/:campaignId', async (req, res, next) => {
  try {
    const diagnostics = await db.diagnostics.listByCampaign(req.params.campaignId);
    res.json({ diagnostics });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/versions/:campaignId
router.get('/versions/:campaignId', async (req, res, next) => {
  try {
    const versions = await db.versions.listByCampaign(req.params.campaignId);
    res.json({ versions });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/deploy-to-lemlist
// Now deploys as A/B variant B (regenerate.deployToLemlist saves B fields in DB automatically)
router.post('/deploy-to-lemlist', async (req, res, next) => {
  try {
    const { campaignId, messages } = req.body;
    const campaign = await db.campaigns.get(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (!campaign.lemlist_id) {
      return res.status(400).json({ error: 'Campaign has no Lemlist ID. Link it in campaign settings first.' });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to deploy' });
    }

    const sequence = await db.touchpoints.listByCampaign(campaignId);
    const deployed = await regenerateJob.deployToLemlist(campaign.lemlist_id, messages, sequence);

    // deployToLemlist now saves B variant fields in DB, no need to overwrite A here

    res.json({
      deployed,
      stepsDeployed: messages.map(m => m.step),
      abTest: true,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/ab-select-winner — manually select A/B test winner
router.post('/ab-select-winner', async (req, res, next) => {
  try {
    const { campaignId, winner } = req.body;

    if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });
    if (!winner || !['A', 'B'].includes(winner)) {
      return res.status(400).json({ error: 'winner must be "A" or "B"' });
    }

    const { forceSelectWinner } = require('../lib/ab-testing');
    const result = await forceSelectWinner(campaignId, req.user.id, winner);

    res.json({ ...result, status: 'applied' });
  } catch (err) {
    if (err.message.includes('No active A/B test')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/ai/ab-status/:campaignId — get current A/B test status
router.get('/ab-status/:campaignId', async (req, res, next) => {
  try {
    const campaignId = req.params.campaignId;
    const versions = await db.versions.listByCampaign(campaignId);
    const activeTest = versions.find(v => v.result === 'testing');

    if (!activeTest) return res.json({ active: false });

    const touchpoints = await db.touchpoints.listByCampaign(campaignId);
    const variants = touchpoints
      .filter(tp => tp.subject_b || tp.body_b)
      .map(tp => ({
        step: tp.step,
        subjectA: tp.subject,
        subjectB: tp.subject_b,
        openRateA: tp.open_rate,
        openRateB: tp.open_rate_b,
        replyRateA: tp.reply_rate,
        replyRateB: tp.reply_rate_b,
      }));

    const createdAt = new Date(activeTest.created_at || activeTest.date);
    const daysSinceStart = ((Date.now() - createdAt.getTime()) / 86400000).toFixed(1);

    res.json({
      active: true,
      versionId: activeTest.id,
      version: activeTest.version,
      daysSinceStart: parseFloat(daysSinceStart),
      hypotheses: activeTest.hypotheses,
      variants,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/score-leads
router.post('/score-leads', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { scoreOpportunities } = require('../lib/lead-scoring');

    const [opps, profile] = await Promise.all([
      db.opportunities.listByUser(userId, 100, 0),
      db.profiles.get(userId),
    ]);

    if (!opps || !opps.length) {
      return res.json({ scored: [], count: 0 });
    }

    // Load linked campaigns
    const campaignIds = [...new Set(opps.filter(o => o.campaign_id).map(o => o.campaign_id))];
    const campaignMap = {};
    for (const cid of campaignIds) {
      try { campaignMap[cid] = await db.campaigns.get(cid); } catch {}
    }

    const scored = scoreOpportunities(opps, profile, campaignMap);

    // Persist scores
    for (const opp of scored) {
      await db.opportunities.updateScore(opp.id, opp.score, opp.scoreBreakdown);
    }

    res.json({ scored, count: scored.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/export-scores-crm
router.post('/export-scores-crm', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { exportScoresToHubSpot } = require('../lib/crm-export');
    const opps = await db.opportunities.listByUser(userId, 100, 0);
    const result = await exportScoresToHubSpot(userId, opps);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/export-scores-csv
router.get('/export-scores-csv', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { exportScoresToCSV } = require('../lib/crm-export');
    const opps = await db.opportunities.listByUser(userId, 100, 0);
    const csv = await exportScoresToCSV(opps);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bakal-scores.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/rollback/:versionId
router.post('/rollback/:versionId', async (req, res, next) => {
  try {
    const version = await db.versions.get(req.params.versionId);
    if (!version) return res.status(404).json({ error: 'Version not found' });

    if (!version.rollback_data) {
      return res.status(400).json({ error: 'No rollback data available for this version' });
    }

    let rollbackTouchpoints;
    try {
      rollbackTouchpoints = JSON.parse(version.rollback_data);
    } catch {
      return res.status(500).json({ error: 'Corrupt rollback data' });
    }

    // Restore touchpoints in DB
    for (const tp of rollbackTouchpoints) {
      if (tp.id) {
        await db.touchpoints.update(tp.id, {
          subject: tp.subject,
          body: tp.body,
        });
      }
    }

    // Optionally restore in Lemlist if campaign has lemlist_id
    const campaign = await db.campaigns.get(version.campaign_id);
    if (campaign && campaign.lemlist_id) {
      try {
        const lemlistSequences = await lemlist.getSequences(campaign.lemlist_id);
        if (lemlistSequences && Array.isArray(lemlistSequences)) {
          for (const tp of rollbackTouchpoints) {
            const stepIndex = parseInt((tp.step || '').replace(/[^\d]/g, ''), 10) - 1;
            const lemlistStep = lemlistSequences[stepIndex];
            if (lemlistStep && lemlistStep._id) {
              const updateData = {};
              if (tp.subject) updateData.subject = tp.subject;
              if (tp.body) updateData.text = tp.body;
              if (Object.keys(updateData).length > 0) {
                await lemlist.updateSequenceStep(campaign.lemlist_id, lemlistStep._id, updateData);
              }
            }
          }
        }
      } catch (err) {
        logger.warn('rollback', 'Lemlist rollback failed, DB restored', { error: err.message });
      }
    }

    // Mark version as rolled back
    await db.versions.update(version.id, { result: 'rolled_back' });

    res.json({ ok: true, restoredSteps: rollbackTouchpoints.length });
  } catch (err) {
    next(err);
  }
});

// --- Helpers ---

function extractPriorities(diagnostic) {
  if (!diagnostic) return [];
  const priorities = [];
  const lines = diagnostic.split('\n');
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes('priorité') || lower.includes('optimiser') || lower.includes('améliorer') || lower.includes('régénér')) {
      const steps = line.match(/[EL]\d/g);
      if (steps) priorities.push(...steps);
    }
  }
  return [...new Set(priorities)];
}

module.exports = router;
