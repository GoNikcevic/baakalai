/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — API Client
   Connects the frontend to the Express backend (localhost:3001).
   Transforms backend snake_case → frontend camelCase data shapes.
   ═══════════════════════════════════════════════════════════════════════════ */

const BakalAPI = (() => {
  const BASE = (window.location.origin || 'http://localhost:3001') + '/api';

  /* ─── Helpers ─── */

  async function request(path, opts = {}) {
    const url = BASE + path;
    const headers = { 'Content-Type': 'application/json', ...opts.headers };

    // Attach JWT token if available
    const token = typeof BakalAuth !== 'undefined' ? BakalAuth.getToken() : null;
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const res = await fetch(url, { headers, ...opts });

    // Handle 401 — redirect to login
    if (res.status === 401 && typeof BakalAuth !== 'undefined') {
      BakalAuth.showLoginScreen();
      throw Object.assign(new Error('Session expired'), { status: 401 });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
    }
    return res.json();
  }

  /* ─── Channel helpers ─── */

  const channelMeta = {
    email:    { label: '✉️ Email',      color: 'var(--blue)' },
    linkedin: { label: '💼 LinkedIn',   color: 'var(--purple)' },
    multi:    { label: '📧+💼 Multi',   color: 'var(--orange)' },
  };

  const resultTextMap = {
    testing:  '⏳ En cours',
    improved: '▲ Amélioré',
    degraded: '▼ Dégradé',
    neutral:  '— Neutre',
  };

  /* ─── Transform: backend campaign row → frontend BAKAL campaign shape ─── */

  function transformCampaign(c, sequence, diagnostics, history) {
    const ch = channelMeta[c.channel] || channelMeta.email;

    // Build slug ID from name if not already a slug
    const slug = String(c.id);

    return {
      _backendId: c.id,
      id: slug,
      name: c.name,
      client: c.client,
      status: c.status,
      channel: c.channel,
      channelLabel: ch.label,
      channelColor: ch.color,
      sector: c.sector || '',
      sectorShort: c.sector_short || (c.sector ? c.sector.split(' ')[0] : ''),
      position: c.position || '',
      size: c.size || '',
      angle: c.angle || '',
      zone: c.zone || '',
      tone: c.tone || 'Pro décontracté',
      formality: c.formality || 'Vous',
      length: c.length || 'Standard',
      cta: c.cta || '',
      volume: { sent: c.sent || 0, planned: c.planned || 0 },
      iteration: c.iteration || 0,
      startDate: c.start_date || '',
      lemlistRef: c.lemlist_id || null,
      nextAction: null,
      kpis: {
        contacts: c.nb_prospects || 0,
        openRate: c.open_rate ?? null,
        replyRate: c.reply_rate ?? null,
        acceptRate: c.accept_rate_lk ?? null,
        interested: c.interested || 0,
        meetings: c.meetings || 0,
      },
      sequence: (sequence || []).map(transformTouchpoint),
      diagnostics: (diagnostics || []).map(transformDiagnostic),
      history: (history || []).map(transformVersion),
      prepChecklist: c.status === 'prep' ? buildDefaultChecklist(c) : undefined,
      info: {
        period: c.start_date || '',
        createdDate: c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '',
        copyDesc: [c.tone, c.formality, c.angle, 'FR'].filter(Boolean).join(' · '),
        channelsDesc: ch.label,
        launchEstimate: c.status === 'prep' ? 'Non planifié' : '',
      },
    };
  }

  function transformTouchpoint(tp) {
    return {
      _backendId: tp.id,
      id: tp.step,
      type: tp.type,
      label: tp.label || '',
      timing: tp.timing || '',
      subType: tp.sub_type || '',
      subject: tp.subject || null,
      body: tp.body || '',
      maxChars: tp.max_chars || undefined,
      stats: (tp.open_rate != null || tp.reply_rate != null || tp.accept_rate != null)
        ? {
            open: tp.open_rate ?? undefined,
            reply: tp.reply_rate ?? undefined,
            stop: tp.stop_rate ?? undefined,
            accept: tp.accept_rate ?? undefined,
            interested: tp.interested || undefined,
          }
        : null,
    };
  }

  function transformDiagnostic(d) {
    // Backend stores a text blob; frontend expects per-step objects.
    // If the backend diagnostic has been parsed, use it; otherwise wrap as a single entry.
    return {
      step: '',
      level: 'blue',
      title: '📊 Analyse',
      text: d.diagnostic || '',
    };
  }

  function transformVersion(v) {
    return {
      version: 'v' + v.version,
      title: v.hypotheses || 'Version ' + v.version,
      desc: v.hypotheses || '',
      result: v.result,
      resultText: resultTextMap[v.result] || v.result,
      date: v.date || '',
    };
  }

  function buildDefaultChecklist(c) {
    return [
      { icon: '✅', title: 'Paramètres de campagne configurés', desc: 'Cible, canal, angle, ton — tout est défini', status: 'Fait', statusColor: 'success', done: true },
      { icon: '⬜', title: 'Séquences à générer par Claude', desc: 'En attente de génération IA', status: 'À faire', statusColor: 'text-muted', done: false },
      { icon: '⬜', title: 'Liste de prospects à importer', desc: 'Import Lemlist en attente', status: 'À faire', statusColor: 'text-muted', done: false },
      { icon: '⬜', title: 'Validation par le client', desc: 'Après génération des séquences', status: 'À faire', statusColor: 'text-muted', done: false },
      { icon: '⬜', title: 'Déploiement sur Lemlist', desc: 'Automatique après validation', status: 'À faire', statusColor: 'text-muted', done: false },
    ];
  }

  /* ─── Transform: frontend → backend (for POST/PATCH) ─── */

  function campaignToBackend(values) {
    const channelMap = {
      'Email uniquement': 'email',
      'LinkedIn uniquement': 'linkedin',
      'Email + LinkedIn': 'multi',
    };

    return {
      name: values.name,
      client: values.client || 'FormaPro Consulting',
      status: values.status || 'prep',
      channel: channelMap[values.channel] || values.channel || 'email',
      sector: values.sector || null,
      sectorShort: values.sector ? values.sector.split(' ')[0] : null,
      position: values.position || null,
      size: values.size || null,
      angle: values.angle || null,
      zone: values.zone || null,
      tone: values.tone || 'Pro décontracté',
      formality: values.formality || 'Vous',
      length: values.length || 'Standard',
      cta: values.cta || null,
      startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      planned: values.volume === 'Agressif (~200/semaine)' ? 200
             : values.volume === 'Modéré (~50/semaine)' ? 50
             : 100,
    };
  }

  function sequenceToBackend(touchpoints) {
    return touchpoints.map(tp => ({
      step: tp.id || tp.step,
      type: tp.type,
      label: tp.label || '',
      subType: tp.subType || tp.sub_type || '',
      timing: tp.timing || '',
      subject: tp.subject || null,
      body: tp.body || '',
      maxChars: tp.maxChars || tp.max_chars || null,
    }));
  }

  /* ═══ Public API Methods ═══ */

  return {
    /** Check if the backend is reachable */
    async checkHealth() {
      try {
        return await request('/health');
      } catch {
        return null;
      }
    },

    /** Fetch all campaigns and transform into BAKAL format */
    async fetchAllCampaigns() {
      const data = await request('/campaigns');
      const result = {};
      for (const c of data.campaigns) {
        const transformed = transformCampaign(c, c.sequence);
        result[transformed.id] = transformed;
      }
      return result;
    },

    /** Fetch a single campaign with full detail */
    async fetchCampaignDetail(id) {
      const data = await request('/campaigns/' + id);
      return transformCampaign(data.campaign, data.sequence, data.diagnostics, data.history);
    },

    /** Fetch dashboard KPIs */
    async fetchDashboard() {
      const data = await request('/dashboard');
      const kpis = data.kpis || {};

      const openRate = kpis.avg_open_rate;
      const replyRate = kpis.avg_reply_rate;

      return {
        contacts: { value: kpis.total_contacts || 0, trend: kpis.active_campaigns ? kpis.active_campaigns + ' campagne(s)' : '', direction: 'up' },
        openRate: { value: openRate ? openRate + '%' : '—', trend: openRate >= 50 ? '✓ Au-dessus du benchmark' : openRate ? '↗ Objectif : 50%' : '', direction: openRate >= 50 ? 'up' : 'flat' },
        replyRate: { value: replyRate ? replyRate + '%' : '—', trend: replyRate >= 5 ? '✓ Au-dessus du benchmark' : replyRate ? '↗ Objectif : 5%' : '', direction: replyRate >= 5 ? 'up' : 'flat' },
        interested: { value: kpis.total_interested || 0, trend: '', direction: 'up' },
        meetings: { value: kpis.total_meetings || 0, trend: '', direction: 'up' },
        stops: { value: '—', trend: '', direction: 'up' },
      };
    },

    /** Create a new campaign */
    async createCampaign(formValues) {
      const payload = campaignToBackend(formValues);
      const created = await request('/campaigns', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return created;
    },

    /** Update a campaign */
    async updateCampaign(id, data) {
      return request('/campaigns/' + id, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    /** Save a full sequence for a campaign */
    async saveSequence(campaignId, touchpoints) {
      const payload = { sequence: sequenceToBackend(touchpoints) };
      return request('/campaigns/' + campaignId + '/sequence', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },

    /** Generate a full sequence from campaign parameters */
    async generateSequence(params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-sequence' + qs, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    /** Generate a single touchpoint by type */
    async generateTouchpoint(type, params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-touchpoint' + qs, {
        method: 'POST',
        body: JSON.stringify({ type, ...params }),
      });
    },

    /** Request AI analysis of a campaign */
    async analyzeCampaign(campaignId, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/analyze' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      });
    },

    /** Request AI sequence regeneration */
    async regenerateSequence(campaignId, diagnostic, originalMessages, clientParams, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/regenerate' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId, diagnostic, originalMessages, clientParams }),
      });
    },

    /** Run the full refinement loop (analyze → regenerate → track) */
    async runRefinement(campaignId, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/run-refinement' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      });
    },

    /** Generate variable chain for a campaign */
    async generateVariables(params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-variables' + qs, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    /** Consolidate cross-campaign memory */
    async consolidateMemory(dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/consolidate-memory' + qs, { method: 'POST' });
    },

    /** Get memory patterns */
    async getMemory() {
      return request('/ai/memory');
    },

    /** Get diagnostics for a campaign */
    async getDiagnostics(campaignId) {
      return request('/ai/diagnostics/' + campaignId);
    },

    /** Get version history for a campaign */
    async getVersions(campaignId) {
      return request('/ai/versions/' + campaignId);
    },

    /** Test backend health and return service status */
    async testConnections() {
      return request('/health');
    },

    /** Get masked API key status */
    async getKeys() {
      return request('/settings/keys');
    },

    /** Save API keys (encrypted on backend) */
    async saveKeys(keys) {
      return request('/settings/keys', {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
    },

    /** Test API key connectivity */
    async testKeys() {
      return request('/settings/keys/test', { method: 'POST' });
    },

    /* Expose internal helpers for external use */
    request,
    campaignToBackend,
    sequenceToBackend,
    transformCampaign,
  };
})();
