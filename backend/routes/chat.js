const { Router } = require('express');
const db = require('../db');
const claude = require('../api/claude');
const { emitToThread, notifyUser } = require('../socket');
const { sanitizeText } = require('../lib/sanitize');
const { rateLimit } = require('../lib/rate-limit');
const { getValidatedIntegrations } = require('../config');
const emailLimit = rateLimit({ windowMs: 60000, max: 10 }); // 10 emails per minute
const cleanLimit = rateLimit({ windowMs: 60000, max: 5 });

const ASSISTANT_TYPES = ['general', 'campaign'];

/**
 * Lean context for the general assistant (first sidebar tab) — language + whether a CRM is
 * genuinely connected, nothing else. Deliberately skips documents/campaigns/patterns/
 * diagnostics/versions, all irrelevant to a non-campaign-creating assistant. Uses
 * getValidatedIntegrations (decrypts to confirm a real, usable connection) rather than the
 * plain access_token-exists check the campaign assistant's context still uses below — see this
 * session's earlier fix for why a stale/placeholder token must not count as "connected."
 */
async function buildGeneralContext(userId) {
  const CRM_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];
  const [userRow, connectedCrms] = await Promise.all([
    db.query('SELECT language FROM users WHERE id = $1', [userId]),
    getValidatedIntegrations(userId, CRM_PROVIDERS),
  ]);
  const userLang = userRow.rows?.[0]?.language || 'fr';

  const contextParts = [];
  contextParts.push(userLang === 'en'
    ? 'CRITICAL LANGUAGE RULE: You MUST reply in ENGLISH. The user speaks English.'
    : 'LANGUE: Réponds en français.');

  if (connectedCrms.length > 0) {
    const crmLines = connectedCrms.map(p => `- ${p.charAt(0).toUpperCase() + p.slice(1)}`);
    contextParts.push(`CRM CONNECTÉS:\n${crmLines.join('\n')}`);
  } else {
    contextParts.push("CRM: Aucun CRM connecté. Si l'utilisateur demande des infos sur un client, dis-lui de connecter un CRM dans Paramètres d'abord.");
  }

  return contextParts.join('\n\n');
}

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

// GET /api/chat/threads?assistantType=general|campaign
router.get('/threads', async (req, res, next) => {
  try {
    const assistantType = ASSISTANT_TYPES.includes(req.query.assistantType) ? req.query.assistantType : undefined;
    const threads = await db.chatThreads.list(req.user.id, { assistantType });
    res.json({ threads });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads
router.post('/threads', async (req, res, next) => {
  try {
    const assistantType = ASSISTANT_TYPES.includes(req.body.assistantType) ? req.body.assistantType : 'campaign';
    const thread = await db.chatThreads.create(req.body.title, req.user.id, assistantType);
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

    let context;
    if (thread.assistant_type === 'general') {
      context = await buildGeneralContext(req.user.id);
    } else {
    // Build bounded context — all queries in parallel
    const { listUserSources } = require('../lib/prospect-sources');
    const [profile, docs, campaigns, patterns, prospectSources, userIntegrations] = await Promise.all([
      db.profiles.get(req.user.id),
      db.documents.getParsedTextByUser(req.user.id, 5),
      db.campaigns.list({ userId: req.user.id, limit: MAX_CAMPAIGNS_IN_CONTEXT }),
      db.memoryPatterns.list({ limit: MAX_PATTERNS_IN_CONTEXT, userId: req.user.id }),
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
    const userHasDocs = docs && docs.length > 0;
    if (userHasDocs) {
      const docContext = docs
        .map(d => `--- ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 8000)}`)
        .join('\n\n');
      if (docContext.length > 0) {
        contextParts.push(`DOCUMENTS BUSINESS (extraits):\n${docContext.slice(0, MAX_DOC_CHARS)}`);
      }
    } else {
      contextParts.push(`⚠️ AUCUN DOCUMENT BUSINESS uploadé. L'utilisateur n'a pas encore fourni de documentation (présentation entreprise, brief, etc.). INSTRUCTION CRITIQUE : si l'utilisateur demande de créer une campagne, de générer des séquences, ou de faire de la prospection, tu DOIS lui demander d'abord d'uploader ses documents dans la page Profil. Dis-lui que sans documentation, les campagnes seront génériques et inefficaces. Redirige-le vers /profil pour uploader ses docs.`);
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

    // CRM integration context — tell Claude which CRM is connected
    const crmProviders = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];
    const connectedCrms = userIntegrations.filter(i => crmProviders.includes(i.provider) && i.access_token);
    if (connectedCrms.length > 0) {
      const crmLines = connectedCrms.map(c => `- ${c.provider.charAt(0).toUpperCase() + c.provider.slice(1)}${c.instance_url ? ' (' + c.instance_url + ')' : ''}`);
      contextParts.push(`CRM CONNECTÉS:\n${crmLines.join('\n')}\n\nL'utilisateur a un CRM connecté. Tu peux proposer d'analyser son CRM, scanner la santé des données, importer des contacts, ou lancer des triggers d'activation.\n\nACTIONS RÉACTIVATION DISPONIBLES:\n- "list-reactivation-targets": Lister les deals stagnants/perdus à réactiver (triés par valeur)\n- "reactivation-stats": Voir les KPIs de réactivation (deals récupérés, revenu, taux de conversion)\n- "send-reactivation": Générer et mettre en file un email de réactivation pour un contact spécifique\nQuand l'utilisateur parle de deals stagnants, relance, réactivation, ou demande "qui je devrais relancer", propose ces actions via des quick_replies.`);
    } else {
      contextParts.push("CRM: Aucun CRM connecté. Si l'utilisateur demande une analyse CRM, redirige-le vers Paramètres pour connecter Pipedrive, HubSpot, Salesforce, Notion ou un autre CRM.");
    }

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

    // Insert language instruction at the BEGINNING of context (high priority)
    if (userLang === 'en') {
      contextParts.unshift('CRITICAL LANGUAGE RULE: You MUST reply in ENGLISH. The user speaks English. ALL your responses, campaign copy, sequences, suggestions, action labels, and quick_replies MUST be in English. The context below may contain French labels — ignore the language of the context, always respond in English.');
    } else {
      contextParts.unshift('LANGUE: Réponds en français. Tout le contenu (campagnes, séquences, suggestions, quick_replies) doit être en français.');
    }

    context = contextParts.join('\n\n');
    }

    const userId = req.user.id;
    const threadId = thread.id;

    // Stream Claude response via Socket.io
    const aiResponse = await claude.chatStream(claudeMessages, context, (chunk) => {
      notifyUser(userId, 'chat:stream', { threadId, chunk });
    }, { assistantType: thread.assistant_type });

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
router.post('/threads/:id/send-email', emailLimit, async (req, res, next) => {
  try {
    const { sendNurtureEmail } = require('../lib/email-outbound');
    const { to, toName, subject, body } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, body required' });

    // Input validation
    if (typeof to !== 'string' || !to.includes('@') || to.length > 320) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (typeof subject !== 'string' || subject.length > 500) {
      return res.status(400).json({ error: 'Invalid subject' });
    }
    if (typeof body !== 'string' || body.length > 50000) {
      return res.status(400).json({ error: 'Message too long' });
    }

    // Validate recipient exists in user's contacts
    const opp = await db.opportunities.findByEmail(req.user.id, to);
    if (!opp) {
      return res.status(400).json({ error: 'Recipient not found in your contacts. Add them first or send from your email client.' });
    }

    const result = await sendNurtureEmail(req.user.id, {
      to, toName, subject, body,
      opportunityId: opp.id,
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

// POST /api/chat/threads/:id/clean-crm — Auto-fix CRM issues
router.post('/threads/:id/clean-crm', cleanLimit, async (req, res, next) => {
  try {
    const { scanCRM, applyFixes } = require('../lib/crm-cleaning-agent');

    // Use active CRM
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    let provider = userRow.rows[0]?.active_crm_provider;
    if (!provider) {
      const { getUserKey } = require('../config');
      for (const p of ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable']) {
        const key = await getUserKey(req.user.id, p);
        if (key) { provider = p; break; }
      }
    }
    if (!provider) return res.json({ error: 'No CRM connected', applied: 0 });

    // Scan first
    const scan = await scanCRM(req.user.id, provider);
    if (!scan.issues || scan.issues.length === 0) {
      return res.json({ score: scan.score, applied: 0, message: 'No issues found' });
    }

    // Auto-fix only truly safe issues (formatting only)
    const safeFixes = [];
    const reviewItems = [];
    for (const issue of scan.issues) {
      if (issue.type === 'format_name_caps' && issue.contacts?.length > 0) {
        safeFixes.push({ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts });
      } else if (issue.type === 'duplicate_email' && issue.contacts?.length >= 2) {
        // Duplicates require manual review — no auto-merge
        reviewItems.push({ type: issue.type, action: 'review', contacts: issue.contacts });
      } else if (issue.type === 'invalid_email' && issue.contacts?.length > 0) {
        // Invalid emails require manual review — no auto-delete
        reviewItems.push({ type: issue.type, action: 'review', contacts: issue.contacts });
      }
    }

    let fixResult = { applied: 0, skipped: 0, errors: [] };
    if (safeFixes.length > 0) {
      fixResult = await applyFixes(req.user.id, provider, safeFixes);
    }

    res.json({
      score: scan.score,
      totalIssues: scan.issues.length,
      autoFixed: fixResult.applied,
      needsReview: reviewItems,
      remainingManual: scan.issues.length - safeFixes.length,
      issues: scan.issues.map(i => ({ type: i.type, count: i.count, suggestedAction: i.suggestedAction })),
    });
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
    const { importContactsForUser } = require('./crm');
    let { provider } = req.body;

    // Use active CRM if no provider specified
    if (!provider) {
      const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
      provider = userRow.rows[0]?.active_crm_provider;
    }
    if (!provider) return res.status(400).json({ error: 'No CRM connected' });

    const result = await importContactsForUser(req.user.id, provider);
    res.json(result);
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
        crmProvider: o.crm_provider || null,
        lastUpdate: o.updated_at || o.created_at,
      })),
      total: filtered.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/create-trigger — Create nurture trigger from chat
router.post('/threads/:id/create-trigger', async (req, res, next) => {
  try {
    const { name, triggerType, actionType, days, mode } = req.body;
    if (!name || !triggerType) return res.status(400).json({ error: 'name and triggerType required' });

    // Use active CRM provider
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [req.user.id]);
    let crmProvider = userRow.rows[0]?.active_crm_provider || null;
    if (!crmProvider) {
      const { getUserKey } = require('../config');
      for (const p of ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable']) {
        const key = await getUserKey(req.user.id, p);
        if (key) { crmProvider = p; break; }
      }
    }

    const result = await db.query(`
      INSERT INTO nurture_triggers (user_id, name, trigger_type, conditions, action_type, mode, crm_provider, enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      RETURNING *
    `, [
      req.user.id,
      name,
      triggerType,
      JSON.stringify({ days: parseInt(days, 10) || 30 }),
      actionType || 'email',
      (actionType || '').startsWith('linkedin_') ? 'auto' : (mode || 'approval'),
      crmProvider,
    ]);

    res.json({ trigger: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/toggle-autopilot — Enable/disable autopilot from chat
router.post('/threads/:id/toggle-autopilot', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    await db.query(
      `UPDATE users SET settings = COALESCE(settings, '{}')::jsonb || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ autopilot_enabled: !!enabled }), req.user.id]
    );
    res.json({ autopilot_enabled: !!enabled });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/list-reactivation-targets — List stagnant/lost deals for reactivation
router.post('/threads/:id/list-reactivation-targets', async (req, res, next) => {
  try {
    const { minDays = 14, maxResults = 20 } = req.body;
    const result = await db.query(`
      SELECT id, name, email, company, title, status, deal_value, churn_score,
             updated_at, lost_date,
             EXTRACT(DAY FROM NOW() - COALESCE(updated_at, created_at))::int AS days_stagnant
      FROM opportunities
      WHERE user_id = $1
        AND (
          (status NOT IN ('won', 'lost') AND updated_at < NOW() - INTERVAL '1 day' * $2)
          OR (status = 'lost' AND lost_date > NOW() - INTERVAL '90 days')
        )
        AND email IS NOT NULL
      ORDER BY deal_value DESC NULLS LAST, churn_score DESC NULLS LAST
      LIMIT $3
    `, [req.user.id, minDays, maxResults]);

    res.json({
      targets: result.rows.map(r => ({
        id: r.id, name: r.name, email: r.email, company: r.company,
        title: r.title, status: r.status, dealValue: r.deal_value,
        churnScore: r.churn_score, daysStagnant: r.days_stagnant,
        lostDate: r.lost_date,
      })),
      total: result.rows.length,
    });
  } catch (err) { next(err); }
});

// POST /api/chat/threads/:id/reactivation-stats — Get reactivation KPIs for chat
router.post('/threads/:id/reactivation-stats', async (req, res, next) => {
  try {
    const { reactivationStats } = require('./crm');
    // Reuse the GET endpoint logic
    const [reactivated, emailsSent, pipeline] = await Promise.all([
      db.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(deal_value), 0) as revenue
        FROM opportunities WHERE user_id = $1 AND reactivated_at IS NOT NULL
      `, [req.user.id]),
      db.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE replied_at IS NOT NULL) as replied
        FROM nurture_emails
        WHERE user_id = $1 AND metadata->>'chain' = 'deal_reactivation'
          AND created_at > NOW() - INTERVAL '90 days'
      `, [req.user.id]),
      db.query(`
        SELECT COUNT(*) as count, COALESCE(SUM(deal_value), 0) as potential
        FROM opportunities
        WHERE user_id = $1 AND status NOT IN ('won', 'lost')
          AND updated_at < NOW() - INTERVAL '14 days'
      `, [req.user.id]),
    ]);
    const r = reactivated.rows[0];
    const e = emailsSent.rows[0];
    const p = pipeline.rows[0];
    res.json({
      dealsReactivated: parseInt(r.count),
      revenueRecovered: parseFloat(r.revenue) || 0,
      emailsSent: parseInt(e.total),
      emailsReplied: parseInt(e.replied),
      stagnantDeals: parseInt(p.count),
      potentialRevenue: parseFloat(p.potential) || 0,
    });
  } catch (err) { next(err); }
});

// POST /api/chat/threads/:id/send-reactivation — Generate & queue reactivation email for a specific contact
router.post('/threads/:id/send-reactivation', async (req, res, next) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const oppResult = await db.query(
      'SELECT * FROM opportunities WHERE id = $1 AND user_id = $2', [contactId, req.user.id]
    );
    const opp = oppResult.rows[0];
    if (!opp) return res.status(404).json({ error: 'Contact not found' });
    if (!opp.email) return res.status(400).json({ error: 'Contact has no email' });

    // Check dedup: no email sent to this contact in last 7 days
    const recent = await db.query(
      `SELECT id FROM nurture_emails WHERE user_id = $1 AND opportunity_id = $2
       AND created_at > NOW() - INTERVAL '7 days' LIMIT 1`,
      [req.user.id, opp.id]
    );
    if (recent.rows.length > 0) {
      return res.status(409).json({ error: 'A reactivation email was already sent to this contact in the last 7 days' });
    }

    // Generate email with Claude
    const daysStagnant = Math.floor((Date.now() - new Date(opp.updated_at || opp.created_at).getTime()) / 86400000);
    const prompt = `Generate a personal reactivation email for a stagnant deal.

CONTEXT:
- Contact: ${opp.name} (${opp.title || 'N/A'}) at ${opp.company || 'N/A'}
- Deal stagnant for ${daysStagnant} days
- Churn score: ${opp.churn_score || 'N/A'}/100
- Status: ${opp.status}
${opp.deal_value ? `- Deal value: ${opp.deal_value}` : ''}

RULES:
- Max 6 lines, must sound human and personal (NOT marketing)
- Tone: professional but warm
- The goal is to re-engage, not to sell aggressively
- Write in the user's language

Return JSON: { "subject": "...", "body": "..." }`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'chat_reactivation');
    let email = result.parsed;
    if (!email) {
      const m = (result.raw || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
      if (m) { try { email = JSON.parse(m[0]); } catch { email = null; } }
    }
    if (!email?.subject || !email?.body) {
      return res.status(500).json({ error: 'Failed to generate reactivation email' });
    }

    // Queue as pending for approval
    const inserted = await db.query(
      `INSERT INTO nurture_emails (user_id, opportunity_id, to_email, to_name, subject, body, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING id`,
      [req.user.id, opp.id, opp.email, opp.name, email.subject, email.body,
       JSON.stringify({ chain: 'deal_reactivation', source: 'chat' })]
    );

    res.json({
      queued: true,
      emailId: inserted.rows[0].id,
      to: opp.email,
      subject: email.subject,
      preview: email.body,
    });
  } catch (err) { next(err); }
});

module.exports = router;
