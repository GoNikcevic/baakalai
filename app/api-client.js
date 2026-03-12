/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — API Client
   Primary data source: Supabase REST API (PostgREST).
   Fallback: Express backend (localhost:3001) for AI endpoints.
   Transforms database snake_case → frontend camelCase data shapes.
   ═══════════════════════════════════════════════════════════════════════════ */

const BakalAPI = (() => {
  const BACKEND_BASE = (window.location.origin || 'http://localhost:3001') + '/api';

  /* ─── Data source flags ─── */
  let _useSupabase = false;
  let _expressAvailable = false;

  /* ─── Express backend request (for AI endpoints) ─── */

  async function request(path, opts = {}) {
    const url = BACKEND_BASE + path;
    const headers = { 'Content-Type': 'application/json', ...opts.headers };

    const token = typeof BakalAuth !== 'undefined' ? BakalAuth.getToken() : null;
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    let res = await fetch(url, { headers, ...opts });

    if (res.status === 401 && typeof BakalAuth !== 'undefined') {
      const newToken = await BakalAuth.refreshAccessToken();
      if (newToken) {
        headers['Authorization'] = 'Bearer ' + newToken;
        res = await fetch(url, { headers, ...opts });
      }
      if (res.status === 401) {
        BakalAuth.showLoginScreen();
        throw Object.assign(new Error('Session expired'), { status: 401 });
      }
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

  /* ═══ Transform: database row → frontend BAKAL shape ═══ */

  function transformCampaign(c, sequence, diagnostics, history) {
    const ch = channelMeta[c.channel] || channelMeta.email;
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
      projectId: c.project_id || null,
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
    // Try parsing JSONB diagnostic for structured data
    let diag = d.diagnostic || '';
    let level = 'blue';
    let title = '📊 Analyse';
    let step = '';

    if (typeof diag === 'object') {
      level = diag.level || 'blue';
      title = diag.title || '📊 Analyse';
      step = diag.step || '';
      diag = diag.text || JSON.stringify(diag);
    } else if (typeof diag === 'string') {
      // Try parsing JSON string
      try {
        const parsed = JSON.parse(diag);
        if (parsed.level) level = parsed.level;
        if (parsed.title) title = parsed.title;
        if (parsed.step) step = parsed.step;
        if (parsed.text) diag = parsed.text;
      } catch {
        // Plain text diagnostic — infer level from priorities
        if (d.priorities && d.priorities.length > 0) {
          const pri = d.priorities[0].toLowerCase();
          if (pri.includes('urgent') || pri.includes('critique')) level = 'warning';
          else if (pri.includes('ok') || pri.includes('bon')) level = 'success';
        }
      }
    }

    return { step, level, title, text: diag };
  }

  function transformVersion(v) {
    const dateStr = v.date || v.created_at;
    const formatted = dateStr
      ? new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      : '';

    return {
      version: 'v' + v.version,
      title: v.hypotheses || 'Version ' + v.version,
      desc: v.hypotheses || '',
      result: v.result,
      resultText: resultTextMap[v.result] || v.result,
      date: formatted,
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

  function transformOpportunity(o) {
    return {
      name: o.name,
      title: o.title || '',
      company: o.company || '',
      size: o.company_size || '',
      status: o.status || 'new',
      statusColor: o.status_color || 'var(--text-muted)',
      timing: o.timing || '',
    };
  }

  function transformReport(r) {
    return {
      week: r.week,
      dateRange: r.date_range || '',
      score: r.score || 'ok',
      scoreLabel: r.score_label || r.score || '',
      metrics: {
        contacts: r.contacts || 0,
        openRate: r.open_rate ? r.open_rate + '%' : '—',
        replyRate: r.reply_rate ? r.reply_rate + '%' : '—',
        interested: r.interested || 0,
        meetings: r.meetings || 0,
      },
      synthesis: r.synthesis || '',
    };
  }

  function transformChartPoint(d) {
    return {
      label: d.label,
      email: d.email_count || 0,
      linkedin: d.linkedin_count || 0,
    };
  }

  /* ─── Transform: frontend → database (for POST/PATCH) ─── */

  function campaignToBackend(values) {
    const channelMap = {
      'Email uniquement': 'email',
      'LinkedIn uniquement': 'linkedin',
      'Email + LinkedIn': 'multi',
    };

    return {
      name: values.name,
      client: values.client || '',
      status: values.status || 'prep',
      channel: channelMap[values.channel] || values.channel || 'email',
      sector: values.sector || null,
      sector_short: values.sector ? values.sector.split(' ')[0] : null,
      position: values.position || null,
      size: values.size || null,
      angle: values.angle || null,
      zone: values.zone || null,
      tone: values.tone || 'Pro décontracté',
      formality: values.formality || 'Vous',
      length: values.length || 'Standard',
      cta: values.cta || null,
      start_date: new Date().toISOString().slice(0, 10),
      planned: values.volume === 'Agressif (~200/semaine)' ? 200
             : values.volume === 'Modéré (~50/semaine)' ? 50
             : 100,
    };
  }

  function sequenceToBackend(touchpoints) {
    return touchpoints.map((tp, i) => ({
      step: tp.id || tp.step,
      type: tp.type,
      label: tp.label || '',
      sub_type: tp.subType || tp.sub_type || '',
      timing: tp.timing || '',
      subject: tp.subject || null,
      body: tp.body || '',
      max_chars: tp.maxChars || tp.max_chars || null,
      sort_order: i,
    }));
  }

  /* ═══════════════════════════════════════════════════════════════
     Supabase Data Methods
     Direct PostgREST calls via BakalSupabase
     ═══════════════════════════════════════════════════════════════ */

  function supabaseReady() {
    return typeof BakalSupabase !== 'undefined' && BakalSupabase.isReady();
  }

  function getUserId() {
    try {
      const user = JSON.parse(localStorage.getItem('bakal_user') || '{}');
      return user.id || null;
    } catch { return null; }
  }

  /* ═══ Public API Methods ═══ */

  return {
    /** Check if any data source is reachable */
    async checkHealth() {
      // Try Supabase first
      if (supabaseReady()) {
        const ok = await BakalSupabase.checkHealth();
        if (ok) {
          _useSupabase = true;
          return { status: 'ok', source: 'supabase' };
        }
      }

      // Fallback to Express backend
      try {
        const result = await request('/health');
        _expressAvailable = true;
        return result;
      } catch {
        return null;
      }
    },

    /** Fetch all campaigns with their touchpoints */
    async fetchAllCampaigns() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        const filter = userId ? { user_id: userId } : {};

        // Fetch campaigns
        const campaigns = await BakalSupabase.select(
          'campaigns',
          '*',
          filter
        );

        if (!campaigns || campaigns.length === 0) return {};

        // Fetch touchpoints for all campaigns in one call
        const campaignIds = campaigns.map(c => c.id);
        const touchpoints = await BakalSupabase.rest('touchpoints', {
          query: `select=*&campaign_id=in.(${campaignIds.join(',')})&order=sort_order.asc`
        });

        // Group touchpoints by campaign_id
        const tpByCampaign = {};
        for (const tp of (touchpoints || [])) {
          if (!tpByCampaign[tp.campaign_id]) tpByCampaign[tp.campaign_id] = [];
          tpByCampaign[tp.campaign_id].push(tp);
        }

        const result = {};
        for (const c of campaigns) {
          const transformed = transformCampaign(c, tpByCampaign[c.id] || []);
          result[transformed.id] = transformed;
        }
        return result;
      }

      // Express fallback
      const data = await request('/campaigns');
      const result = {};
      for (const c of data.campaigns) {
        const transformed = transformCampaign(c, c.sequence);
        result[transformed.id] = transformed;
      }
      return result;
    },

    /** Fetch a single campaign with full detail (touchpoints + diagnostics + versions) */
    async fetchCampaignDetail(id) {
      if (_useSupabase && supabaseReady()) {
        const campaign = await BakalSupabase.selectOne('campaigns', '*', { id });
        const [touchpoints, diagnostics, versions] = await Promise.all([
          BakalSupabase.select('touchpoints', '*', { campaign_id: id }),
          BakalSupabase.select('diagnostics', '*', { campaign_id: id }),
          BakalSupabase.select('versions', '*', { campaign_id: id }),
        ]);
        return transformCampaign(campaign, touchpoints, diagnostics, versions);
      }

      const data = await request('/campaigns/' + id);
      return transformCampaign(data.campaign, data.sequence, data.diagnostics, data.history);
    },

    /** Fetch dashboard KPIs */
    async fetchDashboard() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        let kpis;

        try {
          kpis = await BakalSupabase.rpc('get_dashboard_kpis', { p_user_id: userId });
        } catch {
          // RPC may not exist yet — compute from campaigns
          const campaigns = await BakalSupabase.select('campaigns', 'nb_prospects,open_rate,reply_rate,interested,meetings,status', { user_id: userId });
          const active = (campaigns || []).filter(c => c.status === 'active' || c.status === 'optimizing');
          const avgOpen = active.length ? active.reduce((s, c) => s + (c.open_rate || 0), 0) / active.length : null;
          const avgReply = active.length ? active.reduce((s, c) => s + (c.reply_rate || 0), 0) / active.length : null;
          kpis = {
            total_contacts: active.reduce((s, c) => s + (c.nb_prospects || 0), 0),
            active_campaigns: active.length,
            avg_open_rate: avgOpen ? Math.round(avgOpen * 10) / 10 : null,
            avg_reply_rate: avgReply ? Math.round(avgReply * 10) / 10 : null,
            total_interested: active.reduce((s, c) => s + (c.interested || 0), 0),
            total_meetings: active.reduce((s, c) => s + (c.meetings || 0), 0),
          };
        }

        const openRate = kpis?.avg_open_rate;
        const replyRate = kpis?.avg_reply_rate;

        return {
          contacts: { value: kpis?.total_contacts || 0, trend: kpis?.active_campaigns ? kpis.active_campaigns + ' campagne(s)' : '', direction: 'up' },
          openRate: { value: openRate ? openRate + '%' : '—', trend: openRate >= 50 ? '✓ Au-dessus du benchmark' : openRate ? '↗ Objectif : 50%' : '', direction: openRate >= 50 ? 'up' : 'flat' },
          replyRate: { value: replyRate ? replyRate + '%' : '—', trend: replyRate >= 5 ? '✓ Au-dessus du benchmark' : replyRate ? '↗ Objectif : 5%' : '', direction: replyRate >= 5 ? 'up' : 'flat' },
          interested: { value: kpis?.total_interested || 0, trend: '', direction: 'up' },
          meetings: { value: kpis?.total_meetings || 0, trend: '', direction: 'up' },
          stops: { value: '—', trend: '', direction: 'up' },
        };
      }

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

    /** Fetch opportunities */
    async fetchOpportunities() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        const rows = await BakalSupabase.rest('opportunities', {
          query: `select=*&user_id=eq.${userId}&order=created_at.desc&limit=10`
        });
        return (rows || []).map(transformOpportunity);
      }
      return [];
    },

    /** Fetch reports */
    async fetchReports() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        const rows = await BakalSupabase.rest('reports', {
          query: `select=*&user_id=eq.${userId}&order=created_at.desc&limit=10`
        });
        return (rows || []).map(transformReport);
      }
      return [];
    },

    /** Fetch chart data */
    async fetchChartData() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        const rows = await BakalSupabase.rest('chart_data', {
          query: `select=*&user_id=eq.${userId}&order=week_start.asc&limit=12`
        });
        return (rows || []).map(transformChartPoint);
      }
      return [];
    },

    /** Fetch projects */
    async fetchProjects() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        const rows = await BakalSupabase.select('projects', '*', { user_id: userId });
        const result = {};
        for (const p of (rows || [])) {
          result[p.id] = {
            id: p.id,
            name: p.name,
            client: p.client || p.name,
            description: p.description || '',
            color: p.color || 'var(--blue)',
            createdDate: p.created_at ? new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
            campaignIds: [],
            files: [],
          };
        }
        return result;
      }
      return {};
    },

    /** Create a new campaign */
    async createCampaign(formValues) {
      if (_useSupabase && supabaseReady()) {
        const payload = campaignToBackend(formValues);
        payload.user_id = getUserId();
        if (formValues.projectId) payload.project_id = formValues.projectId;

        const [created] = await BakalSupabase.insert('campaigns', payload);
        return created;
      }

      const payload = campaignToBackend(formValues);
      return request('/campaigns', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    /** Update a campaign */
    async updateCampaign(id, data) {
      if (_useSupabase && supabaseReady()) {
        const [updated] = await BakalSupabase.update('campaigns', data, { id });
        return updated;
      }

      return request('/campaigns/' + id, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
    },

    /** Save a full sequence for a campaign */
    async saveSequence(campaignId, touchpoints) {
      if (_useSupabase && supabaseReady()) {
        // Delete existing touchpoints for this campaign
        await BakalSupabase.remove('touchpoints', { campaign_id: campaignId });

        // Insert new touchpoints
        const rows = sequenceToBackend(touchpoints).map(tp => ({
          ...tp,
          campaign_id: campaignId,
        }));
        if (rows.length > 0) {
          await BakalSupabase.insert('touchpoints', rows);
        }
        return { success: true };
      }

      const payload = { sequence: sequenceToBackend(touchpoints) };
      return request('/campaigns/' + campaignId + '/sequence', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },

    /** Create a project */
    async createProject(data) {
      if (_useSupabase && supabaseReady()) {
        data.user_id = getUserId();
        const [created] = await BakalSupabase.insert('projects', data);
        return created;
      }
      return request('/projects', { method: 'POST', body: JSON.stringify(data) });
    },

    /** Save user profile */
    async saveProfile(data) {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        data.user_id = userId;
        // Upsert: try update first, insert if not found
        try {
          const existing = await BakalSupabase.selectOne('user_profiles', 'user_id', { user_id: userId });
          if (existing) {
            await BakalSupabase.update('user_profiles', data, { user_id: userId });
          } else {
            await BakalSupabase.insert('user_profiles', data);
          }
        } catch {
          await BakalSupabase.insert('user_profiles', data);
        }
        return { success: true };
      }
      return request('/profile', { method: 'POST', body: JSON.stringify(data) });
    },

    /** Load user profile */
    async loadProfile() {
      if (_useSupabase && supabaseReady()) {
        const userId = getUserId();
        try {
          return await BakalSupabase.selectOne('user_profiles', '*', { user_id: userId });
        } catch { return null; }
      }
      try {
        const res = await request('/profile');
        return res.profile || null;
      } catch { return null; }
    },

    /* ─── AI Endpoints (Express backend only) ─── */

    async generateSequence(params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-sequence' + qs, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    async generateTouchpoint(type, params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-touchpoint' + qs, {
        method: 'POST',
        body: JSON.stringify({ type, ...params }),
      });
    },

    async analyzeCampaign(campaignId, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/analyze' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      });
    },

    async regenerateSequence(campaignId, diagnostic, originalMessages, clientParams, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/regenerate' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId, diagnostic, originalMessages, clientParams }),
      });
    },

    async runRefinement(campaignId, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/run-refinement' + qs, {
        method: 'POST',
        body: JSON.stringify({ campaignId }),
      });
    },

    async generateVariables(params, dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/generate-variables' + qs, {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    async consolidateMemory(dryRun = false) {
      const qs = dryRun ? '?dry_run=true' : '';
      return request('/ai/consolidate-memory' + qs, { method: 'POST' });
    },

    async getMemory() {
      if (_useSupabase && supabaseReady()) {
        return BakalSupabase.select('memory_patterns', '*');
      }
      return request('/ai/memory');
    },

    async getDiagnostics(campaignId) {
      if (_useSupabase && supabaseReady()) {
        return BakalSupabase.select('diagnostics', '*', { campaign_id: campaignId });
      }
      return request('/ai/diagnostics/' + campaignId);
    },

    async getVersions(campaignId) {
      if (_useSupabase && supabaseReady()) {
        return BakalSupabase.select('versions', '*', { campaign_id: campaignId });
      }
      return request('/ai/versions/' + campaignId);
    },

    async testConnections() {
      return request('/health');
    },

    async getKeys() {
      return request('/settings/keys');
    },

    async saveKeys(keys) {
      return request('/settings/keys', {
        method: 'POST',
        body: JSON.stringify({ keys }),
      });
    },

    async testKeys() {
      return request('/settings/keys/test', { method: 'POST' });
    },

    /* ─── State helpers ─── */
    get useSupabase() { return _useSupabase; },
    get expressAvailable() { return _expressAvailable; },

    /* Expose internal helpers for external use */
    request,
    campaignToBackend,
    sequenceToBackend,
    transformCampaign,
    transformOpportunity,
    transformReport,
    transformChartPoint,
  };
})();
