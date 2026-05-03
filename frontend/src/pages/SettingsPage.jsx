/* ===============================================================================
   BAKAL — Settings Page (React)
   API key management with encrypted storage, test connectivity, masked display.
   Includes preferences, theme toggle, notification settings, and integrations library.
   Backend: routes/settings.js (GET/POST /api/settings/keys, POST /keys/test)
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getKeys, saveKeys, testKeys, syncLemlist, syncCRM, syncOutreach, saveLanguage } from '../services/api-client';
import { useNotifications } from '../context/NotificationContext';
import { useSocket } from '../context/SocketContext';
import { useI18n } from '../i18n';
import EmailAccountSettings from '../components/EmailAccountSettings';
import TeamSettings from '../components/TeamSettings';
import ProductLinesSettings from '../components/ProductLinesSettings';
import FieldMappingSettings from '../components/FieldMappingSettings';

/* ─── Unified tool list organized by category ─── */

/* Main tools: Outreach + CRM in one block */
const MAIN_TOOLS = [
  { field: 'lemlistKey', label: 'Lemlist', desc: 'Campagnes email et LinkedIn', placeholder: 'Votre cl\u00E9 API Lemlist', color: '#6C5CE7', icon: 'L', category: 'Outreach',
    guide: ['Allez dans app.lemlist.com', 'Settings \u2192 Integrations \u2192 API', 'Copiez la cl\u00E9'], link: 'https://app.lemlist.com/settings/integrations' },
  { field: 'apolloKey', label: 'Apollo', desc: 'Base B2B + s\u00E9quences email', placeholder: 'Votre cl\u00E9 API Apollo', color: '#6C5CE7', icon: 'A', category: 'Outreach',
    guide: ['Allez dans app.apollo.io', 'Avatar \u2192 Settings \u2192 API Keys', 'Cr\u00E9ez ou copiez une cl\u00E9'], link: 'https://app.apollo.io/#/settings/integrations/api-keys' },
  { field: 'instantlyKey', label: 'Instantly', desc: 'Cold email \u00E0 grande \u00E9chelle', placeholder: 'Votre cl\u00E9 API Instantly', color: '#0984E3', icon: 'In', category: 'Outreach',
    guide: ['Allez dans app.instantly.ai', 'Settings \u2192 Integrations \u2192 API Key'], link: 'https://app.instantly.ai/settings/integrations' },
  { field: 'lgmKey', label: 'La Growth Machine', desc: 'S\u00E9quences multi-canal', placeholder: 'Votre cl\u00E9 API LGM', color: '#6C5CE7', icon: 'LG', category: 'Outreach',
    guide: ['Allez dans app.lagrowthmachine.com', 'Settings \u2192 API'], link: 'https://app.lagrowthmachine.com/settings' },
  { field: 'smartleadKey', label: 'Smartlead', desc: 'Cold email avec inbox rotation', placeholder: 'Votre cl\u00E9 API Smartlead', color: '#4F46E5', icon: 'Sm', category: 'Outreach',
    guide: ['Allez dans app.smartlead.ai', 'Settings \u2192 API \u2192 Copiez la cl\u00E9'], link: 'https://app.smartlead.ai/settings' },
  { field: 'waalaxyKey', label: 'Waalaxy', desc: 'Automatisation LinkedIn + email', placeholder: 'Votre cl\u00E9 API Waalaxy', color: '#A29BFE', icon: 'W', category: 'Outreach',
    guide: ['Allez dans app.waalaxy.com', 'Settings \u2192 Integrations'], link: 'https://app.waalaxy.com/settings' },
  { field: 'hubspotKey', label: 'HubSpot', desc: 'CRM + marketing automation', placeholder: 'pat-...', color: '#FF6B35', icon: 'H', category: 'CRM',
    guide: ['Allez dans app.hubspot.com', 'Settings \u2192 Integrations \u2192 Private Apps', 'Cr\u00E9ez une app ou copiez le token (pat-)'], link: 'https://app.hubspot.com/settings/integrations' },
  { field: 'salesforceKey', label: 'Salesforce', desc: 'CRM enterprise', placeholder: 'Votre cl\u00E9 API Salesforce', color: '#00A1E0', icon: 'S', category: 'CRM',
    guide: ['Connectez-vous sur votre instance', 'Setup \u2192 Apps \u2192 Connected Apps', 'Copiez le consumer key'] },
  { field: 'pipedriveKey', label: 'Pipedrive', desc: 'CRM visuel orient\u00E9 vente', placeholder: 'Votre cl\u00E9 API Pipedrive', color: '#017737', icon: 'P', category: 'CRM',
    guide: ['Allez dans app.pipedrive.com', 'Settings \u2192 Personal preferences \u2192 API', 'Copiez le token personnel'], link: 'https://app.pipedrive.com/settings/api' },
  { field: 'odooKey', label: 'Odoo', desc: 'ERP + CRM + Facturation', placeholder: 'Cliquez pour configurer', color: '#714B67', icon: 'Od', category: 'CRM', multiField: true,
    guide: ['URL + nom de base + login + mot de passe'] },
];

/* Extended tools in dropdown */
const EXTENDED_TOOLS = [
  { label: 'Enrichissement', keys: [
    { field: 'dropcontactKey', label: 'DropContact', desc: 'Enrichissement email et téléphone', placeholder: 'Votre clé API DropContact', color: '#00B894', icon: 'D' },
    { field: 'hunterKey', label: 'Hunter', desc: 'Recherche et vérification d\'emails', placeholder: 'Votre clé API Hunter', color: '#FF7675', icon: 'H' },
    { field: 'kasprKey', label: 'Kaspr', desc: 'Données LinkedIn en temps réel', placeholder: 'Votre clé API Kaspr', color: '#0984E3', icon: 'K' },
    { field: 'lushaKey', label: 'Lusha', desc: 'Coordonnées professionnelles', placeholder: 'Votre clé API Lusha', color: '#00CEC9', icon: 'Lu' },
    { field: 'snovKey', label: 'Snov.io', desc: 'Email finder et drip campaigns', placeholder: 'Votre clé API Snov', color: '#E17055', icon: 'S' },
  ]},
  { label: 'LinkedIn / Scraping', keys: [
    { field: 'phantombusterKey', label: 'PhantomBuster', desc: 'Scraping et automatisation web', placeholder: 'Votre clé API PhantomBuster', color: '#636E72', icon: 'PB' },
    { field: 'captaindataKey', label: 'Captain Data', desc: 'Extraction de données multi-sources', placeholder: 'Votre clé API CaptainData', color: '#0984E3', icon: 'CD' },
  ]},
  { label: 'Calendrier', keys: [
    { field: 'calendlyKey', label: 'Calendly', desc: 'Planification de RDV automatisée', placeholder: 'Votre clé API Calendly', color: '#0069FF', icon: 'Ca' },
    { field: 'calcomKey', label: 'Cal.com', desc: 'Alternative open-source à Calendly', placeholder: 'Votre clé API Cal.com', color: '#292929', icon: 'Cl' },
  ]},
  { label: 'Délivrabilité', keys: [
    { field: 'mailreachKey', label: 'MailReach', desc: 'Warm-up et monitoring inbox', placeholder: 'Votre clé API MailReach', color: '#E17055', icon: 'MR' },
    { field: 'warmboxKey', label: 'Warmbox', desc: 'Préchauffage email automatisé', placeholder: 'Votre clé API Warmbox', color: '#FDCB6E', icon: 'Wb' },
  ]},
];

const DEFAULT_PREFERENCES = {
  lemlistDailyLimit: '50',
  sendingWindow: '9h-18h',
  sendingDays: 'Lun-Ven',
  claudeModel: 'claude-3-sonnet',
  notificationEmail: '',
};

/* ─── Status badge helpers ─── */

function StatusBadge({ status }) {
  if (!status) return null;
  const map = {
    connected:      { text: null,       cls: 'settings-status-ok', i18nKey: 'settings.connected' },
    saved:          { text: 'Sauvegardé',      cls: 'settings-status-ok' },
    not_configured: { text: 'Non configuré',   cls: 'settings-status-none' },
    invalid:        { text: 'Clé invalide',    cls: 'settings-status-err' },
    error:          { text: 'Erreur',          cls: 'settings-status-err' },
    testing:        { text: 'Test...',         cls: 'settings-status-testing' },
  };
  const info = map[status.status] || { text: status.status, cls: 'settings-status-none' };
  return (
    <span className={`settings-status-badge ${info.cls}`}>
      {info.text}
      {status.message && status.status !== 'connected' && status.status !== 'not_configured'
        ? ` — ${status.message}` : ''}
    </span>
  );
}

/* ─── Component ─── */

export default function SettingsPage() {
  const [keyStatus, setKeyStatus] = useState({});
  const [testStatus, setTestStatus] = useState({});
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [syncStatus, setSyncStatus] = useState(null);
  const [crmSyncStatus, setCrmSyncStatus] = useState(null);
  const { socket } = useSocket();
  const { showToast: notifyToast } = useNotifications();
  const { lang, setLang, t } = useI18n();
  const [preferences, setPreferences] = useState(() => {
    const saved = localStorage.getItem('bakal-preferences');
    return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_PREFERENCES };
  });
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') || 'light'
  );

  /* ─── Load key status ─── */

  const loadKeys = useCallback(async () => {
    try {
      const data = await getKeys();
      setKeyStatus(data.keys || {});
    } catch {
      /* backend not available */
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  /* ─── Socket listener for Lemlist sync progress ─── */

  useEffect(() => {
    if (!socket) return;
    const onSync = (data) => {
      setSyncStatus(data);
      if (data.status === 'done') {
        notifyToast({
          type: 'success',
          title: 'Synchronisation Lemlist',
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: 'Erreur Lemlist',
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('lemlist:sync', onSync);
    return () => socket.off('lemlist:sync', onSync);
  }, [socket, notifyToast]);

  /* ─── Socket listener for outreach sync progress (Apollo/Instantly/Smartlead) ─── */

  useEffect(() => {
    if (!socket) return;
    const onOutreachSync = (data) => {
      setSyncStatus(data);
      if (data.status === 'done') {
        notifyToast({
          type: 'success',
          title: `Synchronisation ${data.provider || 'Outreach'}`,
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: `Erreur ${data.provider || 'Outreach'}`,
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('outreach:sync', onOutreachSync);
    return () => socket.off('outreach:sync', onOutreachSync);
  }, [socket, notifyToast]);

  /* ─── Socket listener for CRM sync progress ─── */

  useEffect(() => {
    if (!socket) return;
    const onCrmSync = (data) => {
      setCrmSyncStatus(data);
      if (data.status === 'done') {
        notifyToast({
          type: 'success',
          title: 'Analyse CRM',
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: 'Erreur CRM',
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('crm:sync', onCrmSync);
    return () => socket.off('crm:sync', onCrmSync);
  }, [socket, notifyToast]);

  /* ─── Outreach sync handler ─── */

  async function handleSyncOutreach() {
    setSyncStatus({ status: 'starting', progress: 0, message: 'Lancement...' });
    try {
      if (connectedOutreach && connectedOutreach.provider !== 'lemlist') {
        await syncOutreach(connectedOutreach.provider);
      } else {
        await syncLemlist();
      }
    } catch (err) {
      setSyncStatus({ status: 'error', progress: 0, message: err.message });
    }
  }

  /* ─── CRM sync handler ─── */

  async function handleSyncCRM() {
    setCrmSyncStatus({ status: 'starting', progress: 0, message: 'Lancement...' });
    try {
      await syncCRM();
    } catch (err) {
      setCrmSyncStatus({ status: 'error', progress: 0, message: err.message });
    }
  }

  /* ─── Toast helper ─── */

  const showToast = useCallback((msg, type = 'success') => {
    notifyToast({
      type: type === 'error' ? 'danger' : type,
      title: type === 'error' ? 'Erreur' : 'Succès',
      message: msg,
      duration: 3000,
    });
  }, [notifyToast]);

  /* ─── Edit / cancel / save per-field ─── */

  function startEdit(field) {
    setEditing(prev => ({ ...prev, [field]: true }));
    setDrafts(prev => ({ ...prev, [field]: '' }));
  }

  function cancelEdit(field) {
    setEditing(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setDrafts(prev => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function saveField(field, overrideValue) {
    const value = (overrideValue || drafts[field] || '').trim();
    if (!value) return;

    setSaving(true);
    try {
      const res = await saveKeys({ [field]: value });
      if (res.errors && res.errors.length > 0) {
        showToast(res.errors[0], 'error');
      } else {
        showToast('Clé sauvegardée');
        cancelEdit(field);
        await loadKeys();
      }
    } catch (err) {
      showToast(err.message || 'Erreur de sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeField(field) {
    setSaving(true);
    try {
      await saveKeys({ [field]: '' });
      showToast('Clé supprimée');
      cancelEdit(field);
      setTestStatus(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      await loadKeys();
    } catch (err) {
      showToast(err.message || 'Erreur', 'error');
    } finally {
      setSaving(false);
    }
  }

  /* ─── Test all connections ─── */

  async function handleTestAll() {
    setTesting(true);
    const testingState = {};
    for (const [field, info] of Object.entries(keyStatus)) {
      if (info.configured) testingState[field] = { status: 'testing' };
    }
    setTestStatus(testingState);

    try {
      const data = await testKeys();
      setTestStatus(data.results || {});
      showToast('Tests de connexion terminés');
    } catch (err) {
      showToast(err.message || 'Erreur lors des tests', 'error');
    } finally {
      setTesting(false);
    }
  }

  /* ─── Theme toggle ─── */

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('bakal-theme', next);
  }

  /* ─── Preferences ─── */

  function updatePreference(key, value) {
    setPreferences(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('bakal-preferences', JSON.stringify(next));
      return next;
    });
  }

  function resetPreferences() {
    setPreferences({ ...DEFAULT_PREFERENCES });
    localStorage.removeItem('bakal-preferences');
    showToast('Préférences réinitialisées');
  }

  function handleSaveAll() {
    localStorage.setItem('bakal-preferences', JSON.stringify(preferences));
    showToast('Paramètres enregistrés');
  }

  /* ─── Count configured keys ─── */

  const allKeyDefs = [...MAIN_TOOLS, ...EXTENDED_TOOLS.flatMap(g => g.keys)];
  const [showMore, setShowMore] = useState(false);
  const configuredCount = Object.values(keyStatus).filter(k => k.configured).length;
  const totalCount = Object.keys(keyStatus).length || allKeyDefs.length;

  /* ─── Detect connected outreach tool ─── */

  const outreachFieldMap = {
    lemlistKey: { provider: 'lemlist', label: 'Lemlist' },
    apolloKey: { provider: 'apollo', label: 'Apollo' },
    instantlyKey: { provider: 'instantly', label: 'Instantly' },
    smartleadKey: { provider: 'smartlead', label: 'Smartlead' },
  };
  const connectedOutreachField = Object.keys(outreachFieldMap).find(f => keyStatus[f]?.configured);
  const connectedOutreach = connectedOutreachField ? outreachFieldMap[connectedOutreachField] : null;

  /* ─── Detect connected CRM ─── */

  const crmFields = ['hubspotKey', 'salesforceKey', 'pipedriveKey'];
  const connectedCrm = crmFields.find(f => keyStatus[f]?.configured);

  /* ─── Render key row ─── */

  function renderKeyRow(keyDef, isConnected) {
    const info = keyStatus[keyDef.field] || {};
    const isEditing = editing[keyDef.field];
    const test = testStatus[keyDef.field];

    return (
      <div className="settings-key-row" key={keyDef.field} style={{
        display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px',
        borderBottom: '1px solid var(--border)', transition: 'background 0.15s',
        borderLeft: isConnected ? '3px solid var(--success)' : '3px solid transparent',
      }}>
        {/* Icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: (keyDef.color || 'var(--text-muted)') + '18',
          border: `1px solid ${keyDef.color || 'var(--border)'}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: keyDef.color || 'var(--text-muted)',
          letterSpacing: '-0.5px',
        }}>
          {keyDef.icon || keyDef.label.charAt(0)}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{keyDef.label}</span>
            {test && <StatusBadge status={test} />}
          </div>
          {keyDef.desc && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>{keyDef.desc}</div>
          )}

          {info.configured && !isEditing && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{info.masked}</div>
          )}

          {isEditing && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                className="form-input"
                type="password"
                placeholder={keyDef.placeholder}
                value={drafts[keyDef.field] || ''}
                onChange={e => setDrafts(prev => ({ ...prev, [keyDef.field]: e.target.value }))}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveField(keyDef.field);
                  if (e.key === 'Escape') cancelEdit(keyDef.field);
                }}
                style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}
              />
              <button className="btn btn-primary btn-sm" onClick={() => saveField(keyDef.field)}
                disabled={saving || !(drafts[keyDef.field] || '').trim()}>{t('settings.save')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => cancelEdit(keyDef.field)}>Annuler</button>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(keyDef.field)}>
              {info.configured ? t('settings.edit') : t('settings.configure')}
            </button>
            {info.configured && (
              <button className="btn btn-ghost btn-sm settings-btn-danger"
                onClick={() => removeField(keyDef.field)} disabled={saving}>{t('settings.delete')}</button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ─── Render ─── */

  return (
    <div id="page-settings" className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">{t('settings.title')}</div>
          <div className="page-subtitle">
            {t('settings.subtitle')} — {configuredCount}/{totalCount} {t('settings.configured')}
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={handleTestAll}
            disabled={testing}
          >
            {testing ? '...' : t('settings.testAll')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveAll}
          >
            {t('settings.save')}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'start' }}>
      {/* Left column */}
      <div>
      {/* Integrations — 2-column grid */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            {t('settings.integrations')}
            <Link to="/integrations" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('settings.learnMore')} &rarr;
            </Link>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {MAIN_TOOLS.map(tool => {
              const isConnected = keyStatus[tool.field]?.configured;
              const isEditing = editing[tool.field];
              return (
                <div key={tool.field} style={{
                  padding: '16px', borderRadius: 12,
                  border: `1.5px solid ${isConnected ? 'var(--success)' : 'var(--border)'}`,
                  background: isConnected ? 'rgba(0,214,143,0.04)' : 'var(--bg-elevated)',
                  cursor: isEditing ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => { if (!isEditing && !isConnected) startEdit(tool.field); }}
                >
                  {/* Icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: tool.color + '18',
                    border: `1px solid ${tool.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: tool.color,
                    marginBottom: 10,
                  }}>
                    {tool.icon}
                  </div>

                  {/* Name + desc */}
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{tool.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 8 }}>{tool.desc}</div>

                  {/* Status / Actions */}
                  {isConnected && !isEditing && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>{`✓ ${t('settings.connected')}`}</span>
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={(e) => { e.stopPropagation(); startEdit(tool.field); }}>{t('settings.edit')}</button>
                    </div>
                  )}

                  {!isConnected && !isEditing && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); startEdit(tool.field); }}>
                      {t('settings.configure')}
                    </button>
                  )}

                  {/* Inline edit */}
                  {isEditing && tool.multiField && (
                    <OdooConfigForm
                      draft={drafts[tool.field] || ''}
                      onSave={(json) => { setDrafts(prev => ({ ...prev, [tool.field]: json })); saveField(tool.field, json); }}
                      onCancel={() => cancelEdit(tool.field)}
                      saving={saving}
                      isConnected={isConnected}
                      onRemove={() => removeField(tool.field)}
                    />
                  )}
                  {isEditing && !tool.multiField && (
                    <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
                      {tool.guide && (
                        <div style={{
                          fontSize: 11, background: 'var(--paper-2)', borderRadius: 6,
                          padding: '8px 10px', marginBottom: 6, lineHeight: 1.6, color: 'var(--grey-700)',
                        }}>
                          <ol style={{ margin: 0, paddingLeft: 14 }}>
                            {tool.guide.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                          {tool.link && (
                            <a href={tool.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 10, color: 'var(--primary)', display: 'inline-block', marginTop: 4 }}>
                              Ouvrir {tool.label} {'\u2192'}
                            </a>
                          )}
                        </div>
                      )}
                      <input
                        className="form-input"
                        type="password"
                        placeholder={tool.placeholder}
                        value={drafts[tool.field] || ''}
                        onChange={e => setDrafts(prev => ({ ...prev, [tool.field]: e.target.value }))}
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveField(tool.field);
                          if (e.key === 'Escape') cancelEdit(tool.field);
                        }}
                        style={{ fontSize: 12, padding: '6px 10px', marginBottom: 6, width: '100%' }}
                      />
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-primary" style={{ fontSize: 10, padding: '3px 8px', flex: 1 }}
                          onClick={() => saveField(tool.field)}
                          disabled={saving || !(drafts[tool.field] || '').trim()}>{t('settings.save')}</button>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}
                          onClick={() => cancelEdit(tool.field)}>{'\u2715'}</button>
                      </div>
                      {isConnected && (
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px', marginTop: 4, color: 'var(--danger)', width: '100%' }}
                          onClick={() => removeField(tool.field)} disabled={saving}>{t('settings.delete')}</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Voir plus — inside the same card */}
          <div
            style={{
              padding: '12px 20px', cursor: 'pointer',
              borderTop: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              fontSize: 13, color: 'var(--text-muted)', fontWeight: 500,
              transition: 'color 0.15s',
            }}
            onClick={() => setShowMore(p => !p)}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            {showMore ? 'Voir moins' : 'Voir plus d\'intégrations'}
            <span style={{
              transition: 'transform 0.3s ease',
              transform: showMore ? 'rotate(180deg)' : 'rotate(0deg)',
              display: 'inline-block', fontSize: 10,
            }}>
              {'\u25BC'}
            </span>
          </div>

          <div style={{
            maxHeight: showMore ? 2000 : 0,
            overflow: 'hidden',
            transition: showMore
              ? 'max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease-out'
              : 'max-height 0.35s cubic-bezier(0.4, 0, 0.6, 1), opacity 0.2s ease-in',
            opacity: showMore ? 1 : 0,
          }}>
            {EXTENDED_TOOLS.map(group => (
              <div key={group.label}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.5px', color: 'var(--text-muted)',
                  padding: '10px 20px 4px', borderTop: '1px solid var(--border)',
                }}>
                  {group.label}
                </div>
                {group.keys.map(keyDef => renderKeyRow(keyDef, keyStatus[keyDef.field]?.configured))}
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* Right column */}
      <div>
      {/* Lemlist Sync */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title">{t('settings.outreachSync')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Synchronise vos campagnes et analyse les patterns de performance avec Baakal
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSyncOutreach}
            disabled={syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'}
          >
            {syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'
              ? 'Synchronisation...'
              : `Synchroniser ${connectedOutreach ? connectedOutreach.label : 'Outreach'}`}
          </button>
        </div>
        {syncStatus && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{
                height: 6, borderRadius: 3, background: 'var(--bg-elevated)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${syncStatus.progress || 0}%`,
                  background: syncStatus.status === 'error' ? 'var(--danger, #e74c3c)'
                    : syncStatus.status === 'done' ? 'var(--success, #00d68f)'
                    : 'var(--blue, #6366f1)',
                  transition: 'width 0.4s ease, background 0.3s ease',
                }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {syncStatus.message || ''}
            </div>
          </div>
        )}
      </div>

      {/* CRM Sync */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title">{t('settings.crmSync')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {connectedCrm
                ? `Synchronise vos deals ${connectedCrm.replace('Key', '')} et analyse les patterns de conversion avec Baakal`
                : 'Synchronise vos deals CRM et analyse les patterns de conversion avec Baakal'}
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSyncCRM}
            disabled={crmSyncStatus && crmSyncStatus.status !== 'done' && crmSyncStatus.status !== 'error'}
          >
            {crmSyncStatus && crmSyncStatus.status !== 'done' && crmSyncStatus.status !== 'error'
              ? 'Synchronisation...'
              : 'Synchroniser CRM'}
          </button>
        </div>
        {crmSyncStatus && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{
                height: 6, borderRadius: 3, background: 'var(--bg-elevated)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${crmSyncStatus.progress || 0}%`,
                  background: crmSyncStatus.status === 'error' ? 'var(--danger, #e74c3c)'
                    : crmSyncStatus.status === 'done' ? 'var(--success, #00d68f)'
                    : 'var(--blue, #6366f1)',
                  transition: 'width 0.4s ease, background 0.3s ease',
                }} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {crmSyncStatus.message || ''}
            </div>
          </div>
        )}
      </div>

      {/* Team */}
      <TeamSettings />

      {/* Product Lines */}
      <ProductLinesSettings />

      {/* CRM Field Mapping */}
      <FieldMappingSettings />

      {/* Email sortant */}
      <EmailAccountSettings />

      {/* Preferences */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('settings.preferences')}</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="settings-pref-row">
              <label className="settings-pref-label">{t('settings.dailyLimit')}</label>
              <select
                className="form-input"
                value={preferences.lemlistDailyLimit}
                onChange={e => updatePreference('lemlistDailyLimit', e.target.value)}
              >
                <option value="25">25 emails/jour</option>
                <option value="50">50 emails/jour</option>
                <option value="100">100 emails/jour</option>
                <option value="200">200 emails/jour</option>
              </select>
            </div>
            <div className="settings-pref-row">
              <label className="settings-pref-label">{t('settings.sendingWindow')}</label>
              <select
                className="form-input"
                value={preferences.sendingWindow}
                onChange={e => updatePreference('sendingWindow', e.target.value)}
              >
                <option value="8h-17h">8h-17h</option>
                <option value="9h-18h">9h-18h</option>
                <option value="10h-19h">10h-19h</option>
              </select>
            </div>
            <div className="settings-pref-row">
              <label className="settings-pref-label">{t('settings.sendingDays')}</label>
              <select
                className="form-input"
                value={preferences.sendingDays}
                onChange={e => updatePreference('sendingDays', e.target.value)}
              >
                <option value="Lun-Ven">Lun-Ven</option>
                <option value="Lun-Sam">Lun-Sam</option>
                <option value="Tous les jours">Tous les jours</option>
              </select>
            </div>
            <div className="settings-pref-row">
              <label className="settings-pref-label">{t('settings.claudeModel')}</label>
              <select
                className="form-input"
                value={preferences.claudeModel}
                onChange={e => updatePreference('claudeModel', e.target.value)}
              >
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                <option value="claude-opus-4-6">Claude Opus 4.6</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Theme toggle */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Thème</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={toggleTheme}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 20,
                background: theme === 'light' ? 'var(--bg-elevated)' : 'var(--bg-elevated)',
                border: '1px solid var(--border)', cursor: 'pointer',
                fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font)',
                transition: 'all 0.2s',
              }}
            >
              {theme === 'dark' ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  Clair
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  Sombre
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Language selector */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('settings.language')}</div>
        </div>
        <div className="card-body">
          <div className="settings-pref-row">
            <label className="settings-pref-label">{t('settings.languageDesc')}</label>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button
                onClick={() => { setLang('fr'); saveLanguage('fr').catch(() => {}); }}
                style={{
                  padding: '8px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: lang === 'fr' ? 'var(--blue)' : 'var(--bg-elevated)',
                  color: lang === 'fr' ? 'white' : 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                FR
              </button>
              <button
                onClick={() => { setLang('en'); saveLanguage('en').catch(() => {}); }}
                style={{
                  padding: '8px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: lang === 'en' ? 'var(--blue)' : 'var(--bg-elevated)',
                  color: lang === 'en' ? 'white' : 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                EN
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Notification email */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Notifications</div>
        </div>
        <div className="card-body">
          <div className="settings-pref-row">
            <label className="settings-pref-label">Email de notification</label>
            <input
              className="form-input"
              type="email"
              placeholder="votre@email.com"
              value={preferences.notificationEmail}
              onChange={e => updatePreference('notificationEmail', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Reset */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={resetPreferences}>
          {t('settings.resetPrefs')}
        </button>
      </div>
      </div>
      </div>
    </div>
  );
}

/* ═══ Odoo Config Form ═══ */

function OdooConfigForm({ onSave, onCancel, saving, isConnected, onRemove }) {
  const [url, setUrl] = useState('');
  const [dbName, setDbName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSave = () => {
    if (!url || !dbName || !username || !password) return;
    const json = JSON.stringify({ url: url.replace(/\/$/, ''), db: dbName, username, password });
    onSave(json);
  };

  const isValid = url && dbName && username && password;

  return (
    <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
        background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.6,
      }}>
        Trouvez ces infos dans Odoo : <b>Param{'\u00E8'}tres &gt; Technique &gt; Base de donn{'\u00E9'}es</b>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input className="form-input" type="text" placeholder="URL Odoo (ex: https://monsite.odoo.com)"
          value={url} onChange={e => setUrl(e.target.value)} autoFocus
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="text" placeholder="Nom de la base (ex: mycompany)"
          value={dbName} onChange={e => setDbName(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="text" placeholder="Email / identifiant"
          value={username} onChange={e => setUsername(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="password" placeholder="Mot de passe ou cl{'\u00E9'} API"
          value={password} onChange={e => setPassword(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button className="btn btn-primary" style={{ fontSize: 10, padding: '3px 8px', flex: 1 }}
          onClick={handleSave} disabled={saving || !isValid}>Connecter</button>
        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 8px' }}
          onClick={onCancel}>{'\u2715'}</button>
      </div>
      {isConnected && (
        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px', marginTop: 4, color: 'var(--danger)', width: '100%' }}
          onClick={onRemove} disabled={saving}>{t('settings.delete')}</button>
      )}
    </div>
  );
}
