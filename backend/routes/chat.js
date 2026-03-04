const { Router } = require('express');
const db = require('../db');
const claude = require('../api/claude');

const router = Router();

// GET /api/chat/threads — List conversations (scoped to user)
router.get('/threads', (req, res) => {
  const threads = db.chatThreads.list(req.user.id);
  res.json({ threads });
});

// POST /api/chat/threads — Create a new conversation
router.post('/threads', (req, res) => {
  const thread = db.chatThreads.create(req.body.title, req.user.id);
  res.status(201).json(thread);
});

// DELETE /api/chat/threads/:id — Delete a conversation
router.delete('/threads/:id', (req, res) => {
  const thread = db.chatThreads.get(req.params.id);
  if (thread && thread.user_id && thread.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }
  db.chatMessages.deleteByThread(req.params.id);
  db.chatThreads.delete(req.params.id);
  res.json({ ok: true });
});

// GET /api/chat/threads/:id/messages — Get conversation history
router.get('/threads/:id/messages', (req, res) => {
  const thread = db.chatThreads.get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });
  if (thread.user_id && thread.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = db.chatMessages.listByThread(thread.id);
  res.json({ thread, messages });
});

// POST /api/chat/threads/:id/messages — Send a message and get AI response
router.post('/threads/:id/messages', async (req, res, next) => {
  try {
    const thread = db.chatThreads.get(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Save user message
    db.chatMessages.create(thread.id, 'user', message.trim());

    // Build conversation history for Claude
    const history = db.chatMessages.listByThread(thread.id);
    const claudeMessages = history.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Build rich context from profile + documents + campaigns
    const contextParts = [];

    // User profile
    const profile = db.profiles.get(req.user.id);
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

    // Uploaded documents context (truncated to avoid token overflow)
    const docs = db.documents.getParsedTextByUser(req.user.id);
    if (docs && docs.length > 0) {
      const docContext = docs
        .map(d => `--- ${d.original_name} ---\n${(d.parsed_text || '').slice(0, 2000)}`)
        .join('\n\n');
      if (docContext.length > 0) {
        contextParts.push(`DOCUMENTS BUSINESS (extraits):\n${docContext.slice(0, 8000)}`);
      }
    }

    // Existing campaigns
    const campaigns = db.campaigns.list({ userId: req.user.id });
    if (campaigns.length > 0) {
      contextParts.push(`CAMPAGNES EXISTANTES:\n${campaigns.map(c => `"${c.name}" (${c.status}, ${c.channel})`).join(', ')}`);
    } else {
      contextParts.push('Aucune campagne créée pour le moment.');
    }

    const context = contextParts.join('\n\n');

    // Call Claude
    const aiResponse = await claude.chat(claudeMessages, context);

    // Extract action from response if present
    let metadata = null;
    const jsonMatch = aiResponse.content.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        metadata = JSON.parse(jsonMatch[1]);
      } catch { /* invalid JSON, ignore */ }
    }

    // Save assistant message
    const saved = db.chatMessages.create(thread.id, 'assistant', aiResponse.content, metadata);

    // Auto-title thread from first exchange
    if (history.length <= 1) {
      const title = message.trim().slice(0, 60) + (message.length > 60 ? '...' : '');
      db.chatThreads.updateTitle(thread.id, title);
    }

    res.json({
      message: {
        id: saved.id,
        role: 'assistant',
        content: aiResponse.content,
        metadata,
        created_at: new Date().toISOString(),
      },
      usage: aiResponse.usage,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/threads/:id/create-campaign — Create campaign from chat action
router.post('/threads/:id/create-campaign', (req, res) => {
  const thread = db.chatThreads.get(req.params.id);
  if (!thread) return res.status(404).json({ error: 'Thread not found' });

  const { campaign: data } = req.body;
  if (!data || !data.name) {
    return res.status(400).json({ error: 'Campaign data required' });
  }

  // Create campaign (assigned to user)
  const campaign = db.campaigns.create({
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
    startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    planned: data.planned || 100,
    userId: req.user.id,
  });

  // Create touchpoints if sequence provided
  if (Array.isArray(data.sequence)) {
    data.sequence.forEach((tp, i) => {
      db.touchpoints.create(campaign.id, {
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
    });
  }

  res.status(201).json({ campaign });
});

module.exports = router;
