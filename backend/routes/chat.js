const { Router } = require('express');
const db = require('../db');
const claude = require('../api/claude');
const { emitToThread, notifyUser } = require('../socket');
const { sanitizeText } = require('../lib/sanitize');

const router = Router();

// Max context sizes to bound Claude payloads
const MAX_CAMPAIGNS_IN_CONTEXT = 20;
const MAX_PATTERNS_IN_CONTEXT = 10;
const MAX_DIAGNOSTICS_IN_CONTEXT = 3;
const MAX_VERSIONS_IN_CONTEXT = 5;
const MAX_DOC_CHARS = 6000;
const MAX_HISTORY_MESSAGES = 50;

// GET /api/chat/threads
router.get('/threads', async (req, res, next) => {
  try {
    const threads = await db.chatThreads.list(req.user.id);
    res.json({ threads });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads
router.post('/threads', async (req, res, next) => {
  try {
    const thread = await db.chatThreads.create(req.body.title, req.user.id);
    res.status(201).json(thread);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/threads/:id
router.delete('/threads/:id', async (req, res, next) => {
  try {
    const thread = await db.chatThreads.get(req.params.id);
    if (thread && thread.user_id && thread.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }
    await db.chatMessages.deleteByThread(req.params.id);
    await db.chatThreads.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/threads/:id/messages
router.get('/threads/:id/messages', async (req, res, next) => {
  try {
    const thread = await db.chatThreads.get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    if (thread.user_id && thread.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await db.chatMessages.listByThread(thread.id);
    res.json({ thread, messages });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/messages — bounded context building
router.post('/threads/:id/messages', async (req, res, next) => {
  try {
    const thread = await db.chatThreads.get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const message = sanitizeText(req.body.message);
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Limit message size (prevent abuse)
    const trimmedMessage = message.trim().slice(0, 10000);

    await db.chatMessages.create(thread.id, 'user', trimmedMessage);

    // Load history with limit
    const history = await db.chatMessages.listByThread(thread.id, MAX_HISTORY_MESSAGES);
    const claudeMessages = history.map(m => ({ role: m.role, content: m.content }));

    // Build bounded context — all queries in parallel
    const { listUserSources } = require('../lib/prospect-sources');
    const [profile, docs, campaigns, patterns, prospectSources] = await Promise.all([
      db.profiles.get(req.user.id),
      db.documents.getParsedTextByUser(req.user.id, 5),
      db.campaigns.list({ userId: req.user.id, limit: MAX_CAMPAIGNS_IN_CONTEXT }),
      db.memoryPatterns.list({ limit: MAX_PATTERNS_IN_CONTEXT }),
      listUserSources(req.user.id),
    ]);

    const contextParts = [];

    // Profile context
    if (profile) {
      const profileLines = [];
      if (profile.company) profileLines.push(`Entreprise: ${profile.company}`);
      if (profile.sector) profileLines.push(`Secteur: ${profile.sector}`);
      if (profile.description) profileLines.push(`Description: ${profile.description}`);
      if (profile.value_prop) profileLines.push(`Proposition de valeur: ${profile.value_prop}`);
      if (profile.social_proof) profileLines.push(`Preuves sociales: ${profile.social_proof}`);
      if (profile.pain_points) profileLines.push(`Pain points clients: ${profile.pain_points}`);
      if (profile.persona_primary) profileLines.push(`Persona principal: ${profile.persona_primary}`);
      if (profile.persona_secondary) profileLines.push(`Persona secondaire: ${profile.persona_secondary}`);
      if (profile.target_sectors) profileLines.push(`Secteurs cibles: ${profile.target_sectors}`);
      if (profile.target_size) profileLines.push(`Taille cible: ${profile.target_size}`);
      if (profile.target_zones) profileLines.push(`Zones géographiques: ${profile.target_zones}`);
      if (profile.default_tone) profileLines.push(`Ton: ${profile.default_tone}`);
      if (profile.default_formality) profileLines.push(`Formalité: ${profile.default_formality}`);
      if (profile.avoid_words) profileLines.push(`Mots à éviter: ${profile.avoid_words}`);
      if (profile.signature_phrases) profileLines.push(`Expressions signatures: ${profile.signature_phrases}`);
      if (profile.objections) profileLines.push(`Objections fréquentes: ${profile.objections}`);
      if (profileLines.length > 0) {
        contextParts.push(`PROFIL ENTREPRISE:\n${profileLines.join('\n')}`);
      }
    }

    // Documents context (bounded)
    if (docs && docs.length > 0) {
      const docContext = docs
        .map(d => `--- ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 1500)}`)
        .join('\n\n');
      if (docContext.length > 0) {
        contextParts.push(`DOCUMENTS BUSINESS (extraits):\n${docContext.slice(0, MAX_DOC_CHARS)}`);
      }
    }

    // Campaigns context (bounded, no extra queries)
    if (campaigns.length > 0) {
      const campaignLines = campaigns.map(c => {
        const parts = [`"${c.name}" (${c.status}, ${c.channel})`];
        if (c.nb_prospects) parts.push(`${c.nb_prospects} prospects`);
        if (c.open_rate != null) parts.push(`ouverture: ${c.open_rate}%`);
        if (c.reply_rate != null) parts.push(`réponse: ${c.reply_rate}%`);
        if (c.accept_rate_lk != null) parts.push(`acceptation LK: ${c.accept_rate_lk}%`);
        if (c.interested) parts.push(`${c.interested} intéressés`);
        if (c.meetings) parts.push(`${c.meetings} RDV`);
        if (c.iteration > 1) parts.push(`iteration ${c.iteration}`);
        if (c.sector) parts.push(`secteur: ${c.sector}`);
        if (c.position) parts.push(`cible: ${c.position}`);
        return `- ${parts.join(' · ')}`;
      });
      contextParts.push(`CAMPAGNES (${campaigns.length}):\n${campaignLines.join('\n')}`);
    } else {
      contextParts.push('Aucune campagne créée pour le moment.');
    }

    // Outreach / prospect sources configured by user
    if (prospectSources && prospectSources.length > 0) {
      const lines = prospectSources.map(s =>
        `- ${s.name} (${s.provider}) — ${s.canSearch ? '✅ peut générer des listes de prospects' : '❌ ne peut pas générer de listes (exécution seule)'}`
      );
      contextParts.push(`OUTILS OUTREACH CONFIGURÉS:\n${lines.join('\n')}`);
    } else {
      contextParts.push("OUTILS OUTREACH CONFIGURÉS: Aucun outil configuré pour l'instant.");
    }

    // Memory patterns (already bounded by limit in query)
    if (patterns.length > 0) {
      const patternLines = patterns.map(p =>
        `- [${p.confidence}] ${p.pattern} (catégorie: ${p.category})`
      );
      contextParts.push(`MEMORY PATTERNS (ce que l'IA a appris):\n${patternLines.join('\n')}`);
    }

    // Recent diagnostics — single query with JOIN (no N+1)
    const recentDiags = await db.diagnostics.listByUserCampaigns(req.user.id, MAX_DIAGNOSTICS_IN_CONTEXT);
    if (recentDiags.length > 0) {
      const diagLines = recentDiags.map(d => {
        const priorities = d.priorities && d.priorities.length > 0
          ? ` | Priorités: ${d.priorities.join('; ')}`
          : '';
        return `- ${d.campaign_name || 'Campagne'} (${d.date_analyse}): ${(d.diagnostic || '').slice(0, 200)}...${priorities}`;
      });
      contextParts.push(`DIAGNOSTICS RÉCENTS:\n${diagLines.join('\n')}`);
    }

    // Recent optimization history — batch load (no N+1)
    if (campaigns.length > 0) {
      const campIds = campaigns.slice(0, MAX_VERSIONS_IN_CONTEXT).map(c => c.id);
      const latestVersions = await db.versions.latestForCampaigns(campIds);
      const versionLines = [];
      for (const camp of campaigns.slice(0, MAX_VERSIONS_IN_CONTEXT)) {
        const latest = latestVersions[camp.id];
        if (latest) {
          versionLines.push(
            `- "${camp.name}" v${latest.version}: ${latest.hypotheses || 'N/A'} → ${latest.result}`
          );
        }
      }
      if (versionLines.length > 0) {
        contextParts.push(`OPTIMISATIONS RÉCENTES:\n${versionLines.join('\n')}`);
      }
    }

    const context = contextParts.join('\n\n');
    const userId = req.user.id;
    const threadId = thread.id;

    // Stream Claude response via Socket.io
    const aiResponse = await claude.chatStream(claudeMessages, context, (chunk) => {
      notifyUser(userId, 'chat:stream', { threadId, chunk });
    });

    let metadata = null;
    const jsonMatch = aiResponse.content.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { metadata = JSON.parse(jsonMatch[1]); } catch { /* ignore */ }
    }

    const saved = await db.chatMessages.create(thread.id, 'assistant', aiResponse.content, metadata);

    // Notify stream end with full content so frontend can add the message
    notifyUser(userId, 'chat:stream-end', {
      threadId,
      fullContent: aiResponse.content,
      metadata,
      messageId: saved.id || Date.now(),
    });

    if (history.length <= 1) {
      const title = trimmedMessage.slice(0, 60) + (trimmedMessage.length > 60 ? '...' : '');
      await db.chatThreads.updateTitle(thread.id, title);
    }

    const responseMsg = {
      id: saved.id,
      role: 'assistant',
      content: aiResponse.content,
      metadata,
      created_at: new Date().toISOString(),
    };

    emitToThread(thread.id, 'chat:message', responseMsg);

    res.json({ message: responseMsg, usage: aiResponse.usage });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/create-campaign
router.post('/threads/:id/create-campaign', async (req, res, next) => {
  try {
    const thread = await db.chatThreads.get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const { campaign: data } = req.body;
    if (!data || !data.name) {
      return res.status(400).json({ error: 'Campaign data required' });
    }

    const campaign = await db.campaigns.create({
      name: data.name,
      client: data.client || 'Mon entreprise',
      status: 'prep',
      channel: data.channel || 'email',
      sector: data.sector || null,
      position: data.position || null,
      size: data.size || null,
      angle: data.angle || null,
      zone: data.zone || null,
      tone: data.tone || 'Pro décontracté',
      formality: 'Vous',
      length: 'Standard',
      cta: data.cta || null,
      startDate: new Date().toISOString().split('T')[0],
      planned: data.planned || 100,
      userId: req.user.id,
    });

    if (Array.isArray(data.sequence)) {
      for (let i = 0; i < data.sequence.length; i++) {
        const tp = data.sequence[i];
        await db.touchpoints.create(campaign.id, {
          step: tp.step,
          type: tp.type,
          label: tp.label || '',
          subType: tp.subType || '',
          timing: tp.timing || '',
          subject: tp.subject || null,
          body: tp.body || '',
          maxChars: tp.type === 'linkedin' && tp.step?.startsWith('L') ? 300 : null,
          sortOrder: i,
        });
      }
    }

    res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
