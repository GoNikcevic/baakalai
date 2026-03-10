/* ===============================================================================
   BAKAL — Settings Page (React)
   Ported from app/pages.js (saveSettings, loadSettingsKeys, testApiConnections).
   API key management, preferences, theme toggle, API catalog.
   =============================================================================== */

import { useState, useCallback, useMemo } from 'react';
import { useApp } from '../context/useApp';
import BakalAPI from '../services/api-client';

/* ─── API key definitions by category ─── */

const API_KEYS_CONFIG = [
  // Core
  { key: 'lemlistKey', inputId: 'settings-lemlist-key', statusId: 'status-lemlist', dotId: 'dot-lemlist', category: 'core', name: 'Lemlist', icon: '\u2709\ufe0f', desc: "Envoi d'emails et messages LinkedIn automatis\u00e9s. Gestion des s\u00e9quences multi-canal, A/B testing, et suivi des performances.", placeholder: 'Copiez depuis Lemlist \u2192 Settings \u2192 Integrations \u2192 API', hint: 'Lemlist \u2192 Settings \u2192 Integrations \u2192 API' },
  { key: 'claudeKey', inputId: 'settings-claude-key', statusId: 'status-claude', dotId: 'dot-claude', category: 'core', name: 'Claude (Anthropic)', icon: '\ud83e\udd16', desc: "IA pour la g\u00e9n\u00e9ration de copy personnalis\u00e9, l'analyse de performances et les recommandations d'optimisation.", placeholder: 'sk-ant-...', hint: 'console.anthropic.com \u2192 Settings \u2192 API Keys' },
  { key: 'notionToken', inputId: 'settings-notion-token', statusId: 'status-notion', dotId: 'dot-notion', category: 'core', name: 'Notion', icon: '\ud83d\udcdd', desc: 'Hub centralis\u00e9 pour vos donn\u00e9es : gestion clients, suivi campagnes, base de connaissances et m\u00e9moire cross-campagne.', placeholder: 'Copiez depuis notion.so/my-integrations', hint: 'notion.so/my-integrations \u2192 Cr\u00e9er une int\u00e9gration' },
  // CRM
  { key: 'hubspotKey', inputId: 'settings-hubspot-key', statusId: 'status-hubspot', dotId: 'dot-hubspot', category: 'crm', name: 'HubSpot', icon: '\ud83d\udfe0', desc: 'Synchronisation automatique des leads, gestion du pipeline commercial et tracking des interactions prospects.', placeholder: 'pat-...', hint: 'HubSpot \u2192 Settings \u2192 Integrations \u2192 Private Apps' },
  { key: 'pipedriveKey', inputId: 'settings-pipedrive-key', statusId: 'status-pipedrive', dotId: 'dot-pipedrive', category: 'crm', name: 'Pipedrive', icon: '\ud83d\udfe2', desc: 'CRM orient\u00e9 vente avec pipeline visuel. Sync des deals et contacts g\u00e9n\u00e9r\u00e9s par vos campagnes.', placeholder: 'Copiez depuis Pipedrive \u2192 Settings \u2192 API', hint: 'Pipedrive \u2192 Settings \u2192 Personal preferences \u2192 API' },
  { key: 'salesforceKey', inputId: 'settings-salesforce-key', statusId: 'status-salesforce', dotId: 'dot-salesforce', category: 'crm', name: 'Salesforce', icon: '\u2601\ufe0f', desc: 'CRM enterprise. Synchronisation bidirectionnelle des leads, contacts et opportunit\u00e9s.', placeholder: 'Connected App Consumer Key', hint: 'Salesforce \u2192 Setup \u2192 Apps \u2192 Connected Apps', extended: true },
  { key: 'folkKey', inputId: 'settings-folk-key', statusId: 'status-folk', dotId: 'dot-folk', category: 'crm', name: 'Folk', icon: '\ud83d\udc65', desc: 'CRM collaboratif l\u00e9ger, id\u00e9al pour les petites \u00e9quipes.', placeholder: 'API Key', hint: 'Folk \u2192 Settings \u2192 API', extended: true },
  // Enrichment
  { key: 'dropcontactKey', inputId: 'settings-dropcontact-key', statusId: 'status-dropcontact', dotId: 'dot-dropcontact', category: 'enrichment', name: 'Dropcontact', icon: '\ud83d\udce7', desc: 'Enrichissement et v\u00e9rification d\'emails B2B. RGPD-compliant, id\u00e9al pour le march\u00e9 fran\u00e7ais.', placeholder: 'API Key', hint: 'dropcontact.com \u2192 API', extended: true },
  { key: 'apolloKey', inputId: 'settings-apollo-key', statusId: 'status-apollo', dotId: 'dot-apollo', category: 'enrichment', name: 'Apollo.io', icon: '\ud83d\ude80', desc: 'Base de donn\u00e9es B2B et enrichissement de contacts. Recherche avanc\u00e9e par industrie, taille et poste.', placeholder: 'API Key', hint: 'Apollo \u2192 Settings \u2192 Integrations \u2192 API', extended: true },
  { key: 'hunterKey', inputId: 'settings-hunter-key', statusId: 'status-hunter', dotId: 'dot-hunter', category: 'enrichment', name: 'Hunter.io', icon: '\ud83d\udd0d', desc: 'Trouver et v\u00e9rifier des adresses email professionnelles \u00e0 partir de noms de domaines.', placeholder: 'API Key', hint: 'hunter.io \u2192 API', extended: true },
  { key: 'kasprKey', inputId: 'settings-kaspr-key', statusId: 'status-kaspr', dotId: 'dot-kaspr', category: 'enrichment', name: 'Kaspr', icon: '\ud83d\udcf1', desc: 'Trouver des emails et num\u00e9ros de t\u00e9l\u00e9phone directement depuis LinkedIn.', placeholder: 'API Key', hint: 'Kaspr \u2192 Settings \u2192 API', extended: true },
  { key: 'lushaKey', inputId: 'settings-lusha-key', statusId: 'status-lusha', dotId: 'dot-lusha', category: 'enrichment', name: 'Lusha', icon: '\ud83d\udcd6', desc: 'Enrichissement de contacts B2B avec emails et t\u00e9l\u00e9phones directs.', placeholder: 'API Key', hint: 'Lusha \u2192 API', extended: true },
  { key: 'snovKey', inputId: 'settings-snov-key', statusId: 'status-snov', dotId: 'dot-snov', category: 'enrichment', name: 'Snov.io', icon: '\u2744\ufe0f', desc: 'Recherche et v\u00e9rification d\'emails, plus automation d\'outreach.', placeholder: 'API Key', hint: 'snov.io \u2192 API', extended: true },
  // Outreach
  { key: 'instantlyKey', inputId: 'settings-instantly-key', statusId: 'status-instantly', dotId: 'dot-instantly', category: 'outreach', name: 'Instantly', icon: '\u26a1', desc: 'Envoi d\'emails de masse avec rotation de comptes et warm-up int\u00e9gr\u00e9.', placeholder: 'API Key', hint: 'Instantly \u2192 Settings \u2192 API', extended: true },
  { key: 'lgmKey', inputId: 'settings-lgm-key', statusId: 'status-lgm', dotId: 'dot-lgm', category: 'outreach', name: 'La Growth Machine', icon: '\ud83d\udce8', desc: 'Automatisation de s\u00e9quences multi-canal : Email, LinkedIn, Twitter.', placeholder: 'API Key', hint: 'LGM \u2192 Settings \u2192 API', extended: true },
  { key: 'waalaxyKey', inputId: 'settings-waalaxy-key', statusId: 'status-waalaxy', dotId: 'dot-waalaxy', category: 'outreach', name: 'Waalaxy', icon: '\ud83d\udef8', desc: 'Automatisation LinkedIn et cold email. Campagnes multi-canal simplifi\u00e9es.', placeholder: 'API Key', hint: 'Waalaxy \u2192 Settings \u2192 API', extended: true },
  // Scraping
  { key: 'phantombusterKey', inputId: 'settings-phantombuster-key', statusId: 'status-phantombuster', dotId: 'dot-phantombuster', category: 'scraping', name: 'PhantomBuster', icon: '\ud83d\udc7b', desc: 'Extraction de donn\u00e9es LinkedIn, automatisation de t\u00e2ches r\u00e9p\u00e9titives sur les r\u00e9seaux sociaux.', placeholder: 'API Key', hint: 'PhantomBuster \u2192 Settings \u2192 API', extended: true },
  { key: 'captaindataKey', inputId: 'settings-captaindata-key', statusId: 'status-captaindata', dotId: 'dot-captaindata', category: 'scraping', name: 'Captain Data', icon: '\ud83c\udfa9', desc: 'Extraction et enrichissement de donn\u00e9es \u00e0 grande \u00e9chelle avec workflows automatiques.', placeholder: 'API Key', hint: 'Captain Data \u2192 API', extended: true },
  // Calendar
  { key: 'calendlyKey', inputId: 'settings-calendly-key', statusId: 'status-calendly', dotId: 'dot-calendly', category: 'calendar', name: 'Calendly', icon: '\ud83d\udcc5', desc: 'Prise de RDV automatis\u00e9e. Int\u00e9grez vos liens de calendrier dans les CTA de campagne.', placeholder: 'API Key', hint: 'Calendly \u2192 Integrations \u2192 API', extended: true },
  { key: 'calcomKey', inputId: 'settings-calcom-key', statusId: 'status-calcom', dotId: 'dot-calcom', category: 'calendar', name: 'Cal.com', icon: '\ud83d\uddd3\ufe0f', desc: 'Prise de RDV open-source. Alternative self-hosted \u00e0 Calendly.', placeholder: 'API Key', hint: 'Cal.com \u2192 Settings \u2192 Developer \u2192 API Keys', extended: true },
  // Deliverability
  { key: 'mailreachKey', inputId: 'settings-mailreach-key', statusId: 'status-mailreach', dotId: 'dot-mailreach', category: 'deliverability', name: 'MailReach', icon: '\ud83d\udce9', desc: 'Warm-up d\'adresses email et monitoring de d\u00e9livrabilit\u00e9. Maintenez un bon score d\'envoi.', placeholder: 'API Key', hint: 'MailReach \u2192 Settings \u2192 API', extended: true },
  { key: 'warmboxKey', inputId: 'settings-warmbox-key', statusId: 'status-warmbox', dotId: 'dot-warmbox', category: 'deliverability', name: 'Warmbox', icon: '\ud83d\udd25', desc: 'Warm-up automatique de bo\u00eetes email pour maximiser la d\u00e9livrabilit\u00e9 de vos campagnes.', placeholder: 'API Key', hint: 'Warmbox \u2192 API', extended: true },
];

const CATEGORY_LABELS = {
  all: 'Toutes',
  core: 'Core',
  crm: 'CRM',
  enrichment: 'Enrichissement',
  outreach: 'Outreach',
  scraping: 'Scraping',
  calendar: 'Calendrier',
  deliverability: 'D\u00e9livrabilit\u00e9',
};

const CATEGORY_FILTER_ORDER = ['all', 'crm', 'enrichment', 'outreach', 'scraping', 'calendar', 'deliverability'];

/* ─── Preferences config ─── */

const PREFS_CONFIG = [
  { key: 'lemlistDailyLimit', label: 'Limite quotidienne Lemlist', options: ['50', '100', '150', '200'] },
  { key: 'lemlistSendWindow', label: 'Fen\u00eatre d\'envoi', options: ['8h-18h', '9h-17h', '7h-20h'] },
  { key: 'lemlistSendDays', label: 'Jours d\'envoi', options: ['Lun-Ven', 'Lun-Sam', 'Tous les jours'] },
  { key: 'linkedinDelay', label: 'D\u00e9lai entre actions LinkedIn', options: ['30s', '60s', '90s', '120s'] },
  { key: 'claudeModel', label: 'Mod\u00e8le Claude', options: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
  { key: 'claudeValidation', label: 'Validation des g\u00e9n\u00e9rations', options: ['Manuelle', 'Semi-auto', 'Automatique'] },
];

/* ─── Component ─── */

export default function SettingsPage() {
  useApp();

  // API keys state
  const [apiKeys, setApiKeys] = useState(() => {
    const initial = {};
    API_KEYS_CONFIG.forEach(c => { initial[c.key] = ''; });
    return initial;
  });

  // Key status state
  const [keyStatuses, setKeyStatuses] = useState(() => {
    const initial = {};
    API_KEYS_CONFIG.forEach(c => {
      initial[c.key] = { configured: false, text: 'Non connect\u00e9', className: 'input-status' };
    });
    return initial;
  });

  // Preferences state
  const [prefs, setPrefs] = useState({
    lemlistDailyLimit: '',
    lemlistSendWindow: '',
    lemlistSendDays: '',
    linkedinDelay: '',
    claudeModel: '',
    claudeValidation: '',
    notifEmail: '',
  });

  // UI state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [showExtended, setShowExtended] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [openCards, setOpenCards] = useState(new Set());
  const [theme, setThemeState] = useState(() =>
    document.documentElement.getAttribute('data-theme') || 'dark'
  );

  /* ─── Load helpers ─── */

  const loadSettingsKeys = useCallback(async () => {
    try {
      const { keys } = await BakalAPI.getKeys();
      setKeyStatuses(prev => {
        const newStatuses = { ...prev };
        for (const [field, info] of Object.entries(keys)) {
          if (!newStatuses[field]) continue;
          if (info.configured) {
            newStatuses[field] = { configured: true, text: 'Configur\u00e9 (chiffr\u00e9)', className: 'input-status connected' };
            setApiKeys(prevKeys => ({ ...prevKeys, [field]: '' }));
          } else {
            newStatuses[field] = { configured: false, text: 'Non configur\u00e9', className: 'input-status' };
          }
        }
        return newStatuses;
      });
    } catch {
      /* backend not available */
    }
  }, []);

  const loadSettingsPrefs = useCallback(() => {
    const saved = localStorage.getItem('bakal_settings_prefs');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      setPrefs(prev => ({
        ...prev,
        lemlistDailyLimit: data.lemlistDailyLimit || '',
        lemlistSendWindow: data.lemlistSendWindow || '',
        lemlistSendDays: data.lemlistSendDays || '',
        linkedinDelay: data.linkedinDelay || '',
        claudeModel: data.claudeModel || '',
        claudeValidation: data.claudeValidation || '',
        notifEmail: data.notifEmail || '',
      }));
    } catch {
      /* ignore */
    }
  }, []);

  /* ─── Load on mount ─── */

  useState(() => {
    loadSettingsKeys();
    loadSettingsPrefs();
  });


  /* ─── Save ─── */

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);

    // Save non-sensitive prefs to localStorage
    localStorage.setItem('bakal_settings_prefs', JSON.stringify(prefs));

    // Collect non-empty API keys
    const keysToSave = {};
    let hasKeys = false;
    for (const [field, value] of Object.entries(apiKeys)) {
      if (value && value.trim()) {
        keysToSave[field] = value.trim();
        hasKeys = true;
      }
    }

    if (hasKeys) {
      try {
        const result = await BakalAPI.saveKeys(keysToSave);
        if (result.errors && result.errors.length > 0) {
          setSaveStatus('error');
          setSaving(false);
          setTimeout(() => setSaveStatus(null), 3000);
          return;
        }
        // Reload key statuses
        await loadSettingsKeys();
      } catch {
        setSaveStatus('error');
        setSaving(false);
        setTimeout(() => setSaveStatus(null), 3000);
        return;
      }
    }

    setSaving(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(null), 2000);
  }, [apiKeys, prefs, loadSettingsKeys]);

  /* ─── Test connections ─── */

  const testConnections = useCallback(async () => {
    setTesting(true);

    // Set all to testing
    setKeyStatuses(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = { ...next[k], text: 'Test en cours...', className: 'input-status' };
      }
      return next;
    });

    try {
      const { results } = await BakalAPI.testKeys();
      setKeyStatuses(prev => {
        const next = { ...prev };
        for (const [field, result] of Object.entries(results)) {
          if (!next[field]) continue;
          if (result.status === 'connected') {
            next[field] = { configured: true, text: 'Connect\u00e9', className: 'input-status connected' };
          } else if (result.status === 'invalid') {
            next[field] = { configured: false, text: 'Cl\u00e9 invalide', className: 'input-status error' };
          } else if (result.status === 'not_configured') {
            next[field] = { configured: false, text: 'Non configur\u00e9', className: 'input-status' };
          } else {
            next[field] = { configured: false, text: result.message || 'Erreur', className: 'input-status error' };
          }
        }
        return next;
      });
    } catch {
      // Offline fallback — cannot truly validate without backend
      setKeyStatuses(prev => {
        const next = { ...prev };
        for (const cfg of API_KEYS_CONFIG) {
          const value = apiKeys[cfg.key]?.trim();
          if (!value) {
            next[cfg.key] = { configured: false, text: 'Non configur\u00e9', className: 'input-status' };
          } else if (value.length > 10) {
            next[cfg.key] = { configured: false, text: 'Backend indisponible \u2014 test impossible', className: 'input-status error' };
          } else {
            next[cfg.key] = { configured: false, text: 'Format invalide', className: 'input-status error' };
          }
        }
        return next;
      });
    }

    setTesting(false);
  }, [apiKeys]);

  /* ─── Theme ─── */

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('bakal-theme', next);
    setThemeState(next);
  }, [theme]);

  /* ─── Reset preferences ─── */

  const resetPreferences = useCallback(() => {
    const empty = {
      lemlistDailyLimit: '',
      lemlistSendWindow: '',
      lemlistSendDays: '',
      linkedinDelay: '',
      claudeModel: '',
      claudeValidation: '',
      notifEmail: '',
    };
    setPrefs(empty);
    localStorage.removeItem('bakal_settings_prefs');
  }, []);

  /* ─── API catalog helpers ─── */

  const toggleCard = useCallback((key) => {
    setOpenCards(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const coreCards = useMemo(() => API_KEYS_CONFIG.filter(c => !c.extended), []);
  const extendedCards = useMemo(() => API_KEYS_CONFIG.filter(c => c.extended), []);

  const filteredExtendedCards = useMemo(() => {
    return extendedCards.filter(c => {
      const matchesCat = catalogFilter === 'all' || c.category === catalogFilter;
      const matchesSearch = !catalogSearch ||
        c.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        c.desc.toLowerCase().includes(catalogSearch.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [extendedCards, catalogFilter, catalogSearch]);

  /* ─── Render helpers ─── */

  function renderApiCard(cfg) {
    const isOpen = openCards.has(cfg.key);
    const status = keyStatuses[cfg.key] || {};
    const dotClass = status.className?.includes('connected') ? 'online' : status.className?.includes('error') ? 'error' : '';

    return (
      <div
        key={cfg.key}
        className={`api-card${isOpen ? ' open' : ''}${status.configured ? ' connected' : ''}`}
        data-cat={cfg.category}
        onClick={() => toggleCard(cfg.key)}
      >
        <span className="api-card-chevron">{'\u25bc'}</span>
        <div className="api-card-top">
          <div className="api-card-icon">{cfg.icon}</div>
          <div className="api-card-info">
            <div className="api-card-name">{cfg.name}</div>
            <span className={`api-card-badge ${cfg.category}`}>{CATEGORY_LABELS[cfg.category] || cfg.category}</span>
          </div>
          <div className="api-card-status">
            <div className={`api-card-status-dot${dotClass ? ' ' + dotClass : ''}`} />
            <span className="api-card-status-text">{status.text || 'Non connect\u00e9'}</span>
          </div>
        </div>
        <div className="api-card-desc">{cfg.desc}</div>
        <div className="api-card-expand">
          <div className="input-with-status">
            <input
              className="form-input mono"
              type="password"
              placeholder={status.configured ? '(chiffr\u00e9)' : cfg.placeholder}
              value={apiKeys[cfg.key] || ''}
              onChange={(e) => {
                e.stopPropagation();
                setApiKeys(prev => ({ ...prev, [cfg.key]: e.target.value }));
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="form-hint">{cfg.hint} {'\u00b7'} <em>Chiffr\u00e9 c\u00f4t\u00e9 serveur</em></div>
        </div>
      </div>
    );
  }

  /* ─── Main render ─── */

  return (
    <div id="page-settings" className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Param\u00e8tres</div>
          <div className="page-subtitle">Configuration des int\u00e9grations et pr\u00e9f\u00e9rences</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={saveSettings}
            disabled={saving}
            style={
              saveStatus === 'saved' ? { background: 'var(--success)' } :
              saveStatus === 'error' ? { background: 'var(--error, #e53935)' } :
              undefined
            }
          >
            {saving ? 'Chiffrement...' : saveStatus === 'saved' ? 'Enregistr\u00e9' : saveStatus === 'error' ? 'Erreur serveur' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="settings-grid">

        {/* ─── API Catalog Card ─── */}
        <div className="card" id="apiCatalogCard">
          <div className="card-header">
            <div className="card-title">Biblioth\u00e8que d'int\u00e9grations</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '11px', padding: '6px 12px' }}
                onClick={testConnections}
                disabled={testing}
              >
                {testing ? 'Test en cours...' : 'Tester tout'}
              </button>
              <div className="api-catalog-count">
                {coreCards.length + filteredExtendedCards.length} int\u00e9gration{coreCards.length + filteredExtendedCards.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <div className="card-body">
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Connectez vos outils pour automatiser votre prospection. Cliquez sur une carte pour configurer la cl\u00e9 API.
            </p>

            {/* Core cards grid */}
            <div className="api-catalog-grid">
              {coreCards.map(renderApiCard)}
            </div>

            {/* Show more toggle */}
            <div style={{ textAlign: 'center', margin: '16px 0 8px' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '13px', padding: '8px 20px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => setShowExtended(!showExtended)}
              >
                <span>{showExtended ? "Masquer les int\u00e9grations" : "Voir plus d'int\u00e9grations"}</span>
                <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: showExtended ? 'rotate(180deg)' : '' }}>{'\u25bc'}</span>
                <span style={{ background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                  {extendedCards.length}
                </span>
              </button>
            </div>

            {/* Extended section */}
            {showExtended && (
              <div>
                {/* Search and category filters */}
                <div className="api-catalog-toolbar" style={{ marginBottom: '12px' }}>
                  <div className="api-catalog-search-wrap">
                    <input
                      className="api-catalog-search"
                      type="text"
                      placeholder="Rechercher une int\u00e9gration..."
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                    />
                  </div>
                  <div className="api-catalog-filters">
                    {CATEGORY_FILTER_ORDER.map(cat => (
                      <button
                        key={cat}
                        className={`api-cat-filter${catalogFilter === cat ? ' active' : ''}`}
                        onClick={() => setCatalogFilter(cat)}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="api-catalog-grid">
                  {filteredExtendedCards.map(renderApiCard)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Preferences Card ─── */}
        <div className="card">
          <div className="card-title">Pr\u00e9f\u00e9rences</div>

          <div className="form-grid">
            {PREFS_CONFIG.map(cfg => (
              <div key={cfg.key} className="form-group">
                <label className="form-label">{cfg.label}</label>
                <select
                  className="form-input"
                  value={prefs[cfg.key] || ''}
                  onChange={(e) => setPrefs(prev => ({ ...prev, [cfg.key]: e.target.value }))}
                >
                  <option value="">-- S\u00e9lectionner --</option>
                  {cfg.options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="form-group" style={{ marginTop: '12px' }}>
            <label className="form-label">Email de notification</label>
            <input
              className="form-input"
              type="email"
              placeholder="votre@email.com"
              value={prefs.notifEmail || ''}
              onChange={(e) => setPrefs(prev => ({ ...prev, notifEmail: e.target.value }))}
            />
          </div>

          {/* Theme toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '20px', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Th\u00e8me</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {theme === 'light' ? 'Mode clair activ\u00e9' : 'Mode sombre activ\u00e9'}
              </div>
            </div>
            <div
              className={`theme-toggle${theme === 'light' ? ' on' : ''}`}
              onClick={toggleTheme}
              style={{
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                background: theme === 'light' ? 'var(--accent)' : 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: '2px',
                left: theme === 'light' ? '22px' : '2px',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
          </div>

          {/* Reset button */}
          <div style={{ marginTop: '16px', textAlign: 'right' }}>
            <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={resetPreferences}>
              R\u00e9initialiser les pr\u00e9f\u00e9rences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
