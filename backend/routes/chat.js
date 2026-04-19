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
// Generous limit so Claude can read full Excel/CSV tables with 50-100 rows.
// At 15k chars, a typical tabular file with ~100 rows × 150 chars/row fits.
// Token cost: ~4k extra tokens per message → ~$0.012 at Sonnet pricing.
// With prompt caching on the system rules, the additional cost is minimal.
const MAX_DOC_CHARS = 15000;
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
    const [profile, docs, campaigns, patterns, prospectSources, userIntegrations] = await Promise.all([
      db.profiles.get(req.user.id),
      db.documents.getParsedTextByUser(req.user.id, 5),
      db.campaigns.list({ userId: req.user.id, limit: MAX_CAMPAIGNS_IN_CONTEXT }),
      db.memoryPatterns.list({ limit: MAX_PATTERNS_IN_CONTEXT }),
      listUserSources(req.user.id),
      db.userIntegrations.listByUser(req.user.id),
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
        .map(d => `--- ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 8000)}`)
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
      const patternLines = patterns.map(p => {
        const conf = p.confidence === 'Haute' ? '✅ HAUTE' : p.confidence === 'Moyenne' ? '🟡 MOYENNE' : '⚪ FAIBLE';
        const improvement = p.improvement_pct ? ` (+${p.improvement_pct}% ${p.ab_category ? 'sur '+p.ab_category : ''})` : '';
        const confirmations = p.confirmations > 1 ? ` [confirmé ${p.confirmations}x]` : '';
        return `- [${conf}] ${p.pattern}${improvement}${confirmations}`;
      });
      contextParts.push(`MEMORY PATTERNS APPRIS (à appliquer pour les recommandations A/B) :\n${patternLines.join('\n')}\n\nUtilise les patterns HAUTE confiance comme baseline automatique. Pour les MOYENNE, propose-les comme test A/B. Pour les FAIBLE, ignore ou teste avec prudence.`);
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

    // ── Onboarding detection ──
    // Detect if the user is new and inject onboarding context dynamically.
    // A user is considered "new" if they have no campaigns AND an incomplete profile.
    const profileFilled = !!(profile && profile.company && profile.sector);
    const hasCampaigns = campaigns.length > 0;
    const lemlistConnected = userIntegrations.some(i => i.provider === 'lemlist' && i.access_token);
    const apolloConnected = userIntegrations.some(i => i.provider === 'apollo' && i.access_token);
    const hasDocuments = docs && docs.length > 0;
    const hasActiveCampaign = campaigns.some(c => c.status === 'active');

    if (!profileFilled || !hasCampaigns) {
      const onboardingLines = [
        'ONBOARDING STATUS: This user is NEW.',
        `- Profile: ${profileFilled ? 'FILLED' : 'NOT filled (no company, no sector, no targets)'}`,
        `- Campaigns: ${campaigns.length} created`,
        `- Integrations: Lemlist ${lemlistConnected ? 'CONNECTED' : 'NOT connected'} / Apollo ${apolloConnected ? 'CONNECTED' : 'NOT connected'}`,
        `- Documents: ${docs ? docs.length : 0} uploaded`,
        '',
        'ONBOARDING INSTRUCTIONS: Guide this user step by step. Be warm and helpful.',
        'Start by asking about their company and what they do, then help them:',
        '1. Fill their company profile (propose to do it conversationally)',
        '2. Connect Lemlist (explain where to find the API key)',
        '3. Create their first campaign',
        '4. Search for prospects',
        '5. Launch',
        '',
        'Use quick_replies buttons at each step to make it easy.',
        "Don't overwhelm — one step at a time.",
      ];
      contextParts.push(onboardingLines.join('\n'));
    }

    // Detect user language for Claude response language
    // Language is stored in the users table but not in the JWT, so fetch it
    let userLang = 'fr';
    try {
      const userRow = await db.query('SELECT language FROM users WHERE id = $1', [req.user.id]);
      userLang = userRow.rows?.[0]?.language || 'fr';
    } catch { /* default to fr */ }
    if (userLang === 'en') {
      contextParts.push('LANGUAGE: The user speaks English. Reply in English. Generate all campaign copy, sequences, and suggestions in English.');
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

    // Notify stream end with full content so frontend can add the message.
    // This is the ONLY socket event that adds the assistant message to the UI.
    // We intentionally do NOT also emit 'chat:message' here — that caused
    // duplicate messages because the frontend was receiving both events.
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

    // NOTE: emitToThread('chat:message') removed here — it was sending the same
    // message a second time. stream-end already delivered the full content.
    // If multi-user threading is needed later, add dedup by message ID.

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

    // Idempotency guard: prevent creating an exact duplicate within the last 60s
    // (handles double-click + re-fire during streaming)
    const recent = await db.campaigns.list({ userId: req.user.id, limit: 5 });
    const sixtyAgo = Date.now() - 60_000;
    const dupe = recent.find(c =>
      c.name === data.name &&
      new Date(c.created_at).getTime() > sixtyAgo
    );
    if (dupe) {
      console.warn(`[chat] Skipping duplicate campaign creation: "${data.name}"`);
      return res.status(200).json({ campaign: dupe, duplicate: true });
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
      planned: data.planned || 0,
      userId: req.user.id,
    });

    // Persist A/B config if Claude proposed one
    if (data.ab_config) {
      try {
        await db.campaigns.update(campaign.id, {
          ab_config: typeof data.ab_config === 'string' ? data.ab_config : JSON.stringify(data.ab_config),
        });
        // Create a versions entry marking the test as active
        await db.versions.create(campaign.id, {
          version: 1,
          hypotheses: data.ab_config.hypothesis || 'Test A/B initial',
          result: 'testing',
          messagesModified: data.ab_config.tested_steps || [],
          testedSteps: data.ab_config.tested_steps || [],
          abCategories: data.ab_config.categories_tested || [],
        });
      } catch (err) {
        console.warn('[chat] Failed to persist ab_config:', err.message);
      }
    }

    if (Array.isArray(data.sequence)) {
      // Recursively create touchpoints with parent/child links from Claude's nested JSON
      let sortCounter = 0;
      const createNode = async (tp, parentBackendId = null, isRoot = true) => {
        const created = await db.touchpoints.create(campaign.id, {
          step: tp.step,
          type: tp.type,
          label: tp.label || '',
          subType: tp.subType || '',
          timing: tp.timing || '',
          subject: tp.subject || null,
          body: tp.body || '',
          subjectB: tp.subjectB || null,
          bodyB: tp.bodyB || null,
          sortOrder: sortCounter++,
          parentStepId: parentBackendId,
          conditionType: tp.conditionType || null,
          branchLabel: tp.branchLabel || null,
          isRoot,
        });
        if (Array.isArray(tp.children) && tp.children.length > 0) {
          for (const child of tp.children) {
            await createNode(child, created.id, false);
          }
        }
      };
      for (const tp of data.sequence) {
        await createNode(tp, null, true);
      }
    }

    res.status(201).json({ campaign });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════
//  CRM / Activation actions from chat
// ═══════════════════════════════════════════════════

// POST /api/chat/threads/:id/send-email — Send personal email from chat
router.post('/threads/:id/send-email', async (req, res, next) => {
  try {
    const { sendNurtureEmail } = require('../lib/email-outbound');
    const { to, toName, subject, body } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body required' });

    // Find matching opportunity
    const opp = await db.opportunities.findByEmail(req.user.id, to);

    const result = await sendNurtureEmail(req.user.id, {
      to, toName, subject, body,
      opportunityId: opp?.id || null,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/scan-crm — Trigger CRM health scan
router.post('/threads/:id/scan-crm', async (req, res, next) => {
  try {
    const { runAgent } = require('../lib/crm-agent');
    const report = await runAgent(req.user.id, { trigger: 'chat' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/run-nurture — Run nurture via CRM agent
router.post('/threads/:id/run-nurture', async (req, res, next) => {
  try {
    const { runAgent } = require('../lib/crm-agent');
    const report = await runAgent(req.user.id, { trigger: 'chat' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/import-crm — Import contacts from CRM
router.post('/threads/:id/import-crm', async (req, res, next) => {
  try {
    const { getUserKey } = require('../config');
    const pipedrive = require('../api/pipedrive');
    const { provider } = req.body;

    if (provider !== 'pipedrive') return res.status(400).json({ error: `Import not supported for ${provider}` });

    const token = await getUserKey(req.user.id, provider);
    if (!token) return res.status(400).json({ error: `${provider} not connected` });

    const persons = await pipedrive.listAllPersons(token);
    let imported = 0, skipped = 0;

    for (const raw of (persons || [])) {
      const email = Array.isArray(raw.email)
        ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
        : (raw.email || null);
      if (!email) { skipped++; continue; }
      const existing = await db.opportunities.findByEmail(req.user.id, email);
      if (existing) { skipped++; continue; }
      await db.opportunities.create({
        userId: req.user.id,
        name: raw.name || 'Unknown',
        email,
        title: raw.job_title || null,
        company: raw.org_name || raw.org_id?.name || null,
        status: 'imported',
        crmProvider: 'pipedrive',
        crmContactId: String(raw.id),
      });
      imported++;
    }

    res.json({ imported, skipped });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/list-clients — List clients with filter
router.post('/threads/:id/list-clients', async (req, res, next) => {
  try {
    const { filter, days } = req.body;
    const opps = await db.opportunities.listByUser(req.user.id, 100, 0);

    let filtered = opps;
    if (filter === 'won') {
      filtered = opps.filter(o => o.status === 'won');
    } else if (filter === 'stagnant') {
      const threshold = Date.now() - (days || 30) * 86400000;
      filtered = opps.filter(o => new Date(o.updated_at || o.created_at).getTime() < threshold);
    } else if (filter === 'inactive') {
      const threshold = Date.now() - (days || 60) * 86400000;
      filtered = opps.filter(o => new Date(o.updated_at || o.created_at).getTime() < threshold);
    }

    res.json({
      clients: filtered.map(o => ({
        id: o.id, name: o.name, email: o.email, company: o.company,
        title: o.title, status: o.status, score: o.score,
        lastUpdate: o.updated_at || o.created_at,
      })),
      total: filtered.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
