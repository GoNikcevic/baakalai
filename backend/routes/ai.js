const { Router } = require('express');
const claude = require('../api/claude');
const db = require('../db');
const notionSync = require('../api/notion-sync');
const dryRun = require('../api/dry-run');

const router = Router();

function isDryRun(req) {
  return req.query.dry_run === 'true' || req.query.dry_run === '1';
}

// Enrich params with user profile defaults and document context
async function enrichWithProfile(params, userId) {
  const profile = await db.profiles.get(userId);
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

  const docs = await db.documents.getParsedTextByUser(userId);
  if (docs && docs.length > 0) {
    const docText = docs
      .map(d => `[${d.original_name}] ${(d.parsed_text || '').slice(0, 1500)}`)
      .join('\n\n');
    params.documentContext = docText.slice(0, 6000);
  }

  return params;
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

// POST /api/ai/regenerate
router.post('/regenerate', async (req, res, next) => {
  try {
    const { campaignId, diagnostic, originalMessages, clientParams, regenerationInstructions } = req.body;

    const memory = await db.memoryPatterns.list({});

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

    const sequence = await db.touchpoints.listByCampaign(campaignId);
    const memory = await db.memoryPatterns.list({});

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

// POST /api/ai/consolidate-memory
router.post('/consolidate-memory', async (req, res, next) => {
  try {
    const campaigns = await db.campaigns.list({});
    const allDiagnostics = [];
    for (const campaign of campaigns) {
      const diags = await db.diagnostics.listByCampaign(campaign.id);
      allDiagnostics.push(
        ...diags.map((d) => ({ ...d, campaign: campaign.name, sector: campaign.sector }))
      );
    }

    const existingMemory = await db.memoryPatterns.list({});

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

// GET /api/ai/memory
router.get('/memory', async (_req, res, next) => {
  try {
    const patterns = await db.memoryPatterns.list({});
    res.json({ patterns, count: patterns.length });
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
