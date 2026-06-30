/* ===============================================================================
   BAKAL — Settings Page (React)
   API key management with encrypted storage, test connectivity, masked display.
   Includes preferences, theme toggle, notification settings, and integrations library.
   Backend: routes/settings.js (GET/POST /api/settings/keys, POST /keys/test)
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { getKeys, saveKeys, testKeys, syncLemlist, syncCRM, syncOutreach, saveLanguage, request } from '../services/api-client';
import { deleteAccount } from '../services/auth';
import { useNotifications } from '../context/NotificationContext';
import { useSocket } from '../context/SocketContext';
import { useI18n } from '../i18n';
import EmailAccountSettings from '../components/EmailAccountSettings';
import TeamSettings from '../components/TeamSettings';
import ProductLinesSettings from '../components/ProductLinesSettings';
import FieldMappingSettings from '../components/FieldMappingSettings';

/* ─── Unified tool list organized by category ─── */

/* Main tools: Outreach + CRM in one block */
function getMainTools(lang) {
  const en = lang === 'en';
  return [
    { field: 'lemlistKey', label: 'Lemlist', desc: en ? 'Email and LinkedIn campaigns' : 'Campagnes email et LinkedIn', placeholder: en ? 'Your Lemlist API key' : 'Votre cl\u00E9 API Lemlist', color: '#6C5CE7', icon: 'L', category: 'Outreach',
      guide: en ? ['Go to app.lemlist.com', 'Settings \u2192 Integrations \u2192 API', 'Copy the key'] : ['Allez dans app.lemlist.com', 'Settings \u2192 Integrations \u2192 API', 'Copiez la cl\u00E9'], link: 'https://app.lemlist.com/settings/integrations' },
    { field: 'apolloKey', label: 'Apollo', desc: en ? 'B2B database + email sequences' : 'Base B2B + s\u00E9quences email', placeholder: en ? 'Your Apollo API key' : 'Votre cl\u00E9 API Apollo', color: '#6C5CE7', icon: 'A', category: 'Outreach',
      guide: en ? ['Go to app.apollo.io', 'Avatar \u2192 Settings \u2192 API Keys', 'Create or copy a key'] : ['Allez dans app.apollo.io', 'Avatar \u2192 Settings \u2192 API Keys', 'Cr\u00E9ez ou copiez une cl\u00E9'], link: 'https://app.apollo.io/#/settings/integrations/api-keys' },
    { field: 'instantlyKey', label: 'Instantly', desc: en ? 'Cold email at scale' : 'Cold email \u00E0 grande \u00E9chelle', placeholder: en ? 'Your Instantly API key' : 'Votre cl\u00E9 API Instantly', color: '#0984E3', icon: 'In', category: 'Outreach',
      guide: en ? ['Go to app.instantly.ai', 'Settings \u2192 Integrations \u2192 API Key'] : ['Allez dans app.instantly.ai', 'Settings \u2192 Integrations \u2192 API Key'], link: 'https://app.instantly.ai/settings/integrations' },
    { field: 'lgmKey', label: 'La Growth Machine', desc: en ? 'Multi-channel sequences' : 'S\u00E9quences multi-canal', placeholder: en ? 'Your LGM API key' : 'Votre cl\u00E9 API LGM', color: '#6C5CE7', icon: 'LG', category: 'Outreach',
      guide: en ? ['Go to app.lagrowthmachine.com', 'Settings \u2192 API'] : ['Allez dans app.lagrowthmachine.com', 'Settings \u2192 API'], link: 'https://app.lagrowthmachine.com/settings' },
    { field: 'smartleadKey', label: 'Smartlead', desc: en ? 'Cold email with inbox rotation' : 'Cold email avec inbox rotation', placeholder: en ? 'Your Smartlead API key' : 'Votre cl\u00E9 API Smartlead', color: '#4F46E5', icon: 'Sm', category: 'Outreach',
      guide: en ? ['Go to app.smartlead.ai', 'Settings \u2192 API \u2192 Copy the key'] : ['Allez dans app.smartlead.ai', 'Settings \u2192 API \u2192 Copiez la cl\u00E9'], link: 'https://app.smartlead.ai/settings' },
    { field: 'waalaxyKey', label: 'Waalaxy', desc: en ? 'LinkedIn + email automation' : 'Automatisation LinkedIn + email', placeholder: en ? 'Your Waalaxy API key' : 'Votre cl\u00E9 API Waalaxy', color: '#A29BFE', icon: 'W', category: 'Outreach',
      guide: en ? ['Go to app.waalaxy.com', 'Settings \u2192 Integrations'] : ['Allez dans app.waalaxy.com', 'Settings \u2192 Integrations'], link: 'https://app.waalaxy.com/settings' },
    { field: 'hubspotKey', label: 'HubSpot', desc: 'CRM + marketing automation', placeholder: 'pat-...', color: '#FF6B35', icon: 'H', category: 'CRM',
      guide: en ? ['Go to app.hubspot.com', 'Settings \u2192 Integrations \u2192 Private Apps', 'Create an app or copy the token (pat-)'] : ['Allez dans app.hubspot.com', 'Settings \u2192 Integrations \u2192 Private Apps', 'Cr\u00E9ez une app ou copiez le token (pat-)'], link: 'https://app.hubspot.com/settings/integrations' },
    { field: 'salesforceKey', label: 'Salesforce', desc: 'CRM enterprise', placeholder: en ? 'Your Salesforce access token' : 'Votre access token Salesforce', color: '#00A1E0', icon: 'S', category: 'CRM', multiField: 'salesforce',
      guide: en ? ['Log in to your Salesforce instance', 'Setup \u2192 Apps \u2192 Connected Apps', 'Generate an access token', 'Paste the token and your instance URL below'] : ['Connectez-vous sur votre instance Salesforce', 'Setup \u2192 Apps \u2192 Connected Apps', 'G\u00E9n\u00E9rez un access token', 'Collez le token et votre URL d\'instance ci-dessous'] },
    { field: 'pipedriveKey', label: 'Pipedrive', desc: en ? 'Visual sales-oriented CRM' : 'CRM visuel orient\u00E9 vente', placeholder: en ? 'Your Pipedrive API key' : 'Votre cl\u00E9 API Pipedrive', color: '#017737', icon: 'P', category: 'CRM',
      guide: en ? ['Go to app.pipedrive.com', 'Settings \u2192 Personal preferences \u2192 API', 'Copy the personal token'] : ['Allez dans app.pipedrive.com', 'Settings \u2192 Personal preferences \u2192 API', 'Copiez le token personnel'], link: 'https://app.pipedrive.com/settings/api' },
    { field: 'odooKey', label: 'Odoo', desc: en ? 'ERP + CRM + Invoicing' : 'ERP + CRM + Facturation', placeholder: en ? 'Click to configure' : 'Cliquez pour configurer', color: '#714B67', icon: 'Od', category: 'CRM', multiField: true,
      guide: en ? ['URL + database name + login + password'] : ['URL + nom de base + login + mot de passe'] },
    { field: 'notionToken', label: 'Notion', desc: en ? 'CRM + Docs — import & sync contacts' : 'CRM + Docs — import et sync contacts', placeholder: en ? 'ntn_ or secret_ token' : 'Token ntn_ ou secret_', color: '#000000', icon: 'N', category: 'CRM', hasMetadata: 'notion',
      guide: en ? ['Go to notion.so/my-integrations', 'Create an internal integration', 'Copy the token (starts with ntn_ or secret_)', 'Share your CRM database with the integration'] : ['Allez dans notion.so/my-integrations', 'Cr\u00e9ez une int\u00e9gration interne', 'Copiez le token (commence par ntn_ ou secret_)', 'Partagez votre base CRM avec l\'int\u00e9gration'], link: 'https://www.notion.so/my-integrations' },
    { field: 'airtableKey', label: 'Airtable', desc: en ? 'CRM + spreadsheet — import & sync contacts' : 'CRM + tableur — import et sync contacts', placeholder: en ? 'Your Airtable personal access token' : 'Votre personal access token Airtable', color: '#18BFFF', icon: 'At', category: 'CRM', hasMetadata: 'airtable',
      guide: en ? ['Go to airtable.com/create/tokens', 'Create a personal access token', 'Grant read/write scopes on your base', 'Copy and paste here'] : ['Allez dans airtable.com/create/tokens', 'Cr\u00e9ez un personal access token', 'Accordez les scopes lecture/\u00e9criture sur votre base', 'Copiez et collez ici'], link: 'https://airtable.com/create/tokens' },
  ];
}

/* Extended tools in dropdown */
function getExtendedTools(lang) {
  const en = lang === 'en';
  return [
    { label: en ? 'Enrichment' : 'Enrichissement', keys: [
      { field: 'dropcontactKey', label: 'DropContact', desc: en ? 'Email and phone enrichment' : 'Enrichissement email et téléphone', placeholder: en ? 'Your DropContact API key' : 'Votre clé API DropContact', color: '#00B894', icon: 'D' },
      { field: 'hunterKey', label: 'Hunter', desc: en ? 'Email search and verification' : 'Recherche et vérification d\'emails', placeholder: en ? 'Your Hunter API key' : 'Votre clé API Hunter', color: '#FF7675', icon: 'H' },
      { field: 'kasprKey', label: 'Kaspr', desc: en ? 'Real-time LinkedIn data' : 'Données LinkedIn en temps réel', placeholder: en ? 'Your Kaspr API key' : 'Votre clé API Kaspr', color: '#0984E3', icon: 'K' },
      { field: 'lushaKey', label: 'Lusha', desc: en ? 'Professional contact info' : 'Coordonnées professionnelles', placeholder: en ? 'Your Lusha API key' : 'Votre clé API Lusha', color: '#00CEC9', icon: 'Lu' },
      { field: 'snovKey', label: 'Snov.io', desc: en ? 'Email finder and drip campaigns' : 'Email finder et drip campaigns', placeholder: en ? 'Your Snov API key' : 'Votre clé API Snov', color: '#E17055', icon: 'S' },
    ]},
    { label: 'Newsletter / Marketing', keys: [
      { field: 'informzKey', label: 'Informz', desc: 'Newsletter campaigns for associations (Higher Logic)', placeholder: 'username:password:brandId', color: '#2D3436', icon: 'Iz',
        helpSteps: ['Get your API credentials from your Informz admin', 'Format: username:password:brandId', 'Your server IP must be whitelisted by Informz'] },
    ]},
    { label: 'LinkedIn / Scraping', keys: [
      { field: 'linkedinKey', label: 'LinkedIn', desc: en ? 'li_at cookie — enrichment + automated outreach' : 'Cookie li_at — enrichissement + outreach automatisé', placeholder: en ? 'Your li_at cookie (from browser)' : 'Votre cookie li_at (depuis le navigateur)', color: '#0A66C2', icon: 'in', category: 'LinkedIn',
        helpSteps: en ? ['Log in to linkedin.com', 'Open DevTools (F12) → Application → Cookies', 'Copy the value of the "li_at" cookie', 'Paste it here'] : ['Connectez-vous à linkedin.com', 'Ouvrez les DevTools (F12) → Application → Cookies', 'Copiez la valeur du cookie "li_at"', 'Collez-la ici'] },
      { field: 'phantombusterKey', label: 'PhantomBuster', desc: en ? 'Web scraping and automation' : 'Scraping et automatisation web', placeholder: en ? 'Your PhantomBuster API key' : 'Votre clé API PhantomBuster', color: '#636E72', icon: 'PB' },
      { field: 'captaindataKey', label: 'Captain Data', desc: en ? 'Multi-source data extraction' : 'Extraction de données multi-sources', placeholder: en ? 'Your CaptainData API key' : 'Votre clé API CaptainData', color: '#0984E3', icon: 'CD' },
    ]},
    { label: en ? 'Calendar' : 'Calendrier', keys: [
      { field: 'calendlyKey', label: 'Calendly', desc: en ? 'Automated meeting scheduling' : 'Planification de RDV automatisée', placeholder: en ? 'Your Calendly API key' : 'Votre clé API Calendly', color: '#0069FF', icon: 'Ca' },
      { field: 'calcomKey', label: 'Cal.com', desc: en ? 'Open-source alternative to Calendly' : 'Alternative open-source à Calendly', placeholder: en ? 'Your Cal.com API key' : 'Votre clé API Cal.com', color: '#292929', icon: 'Cl' },
    ]},
    { label: en ? 'Deliverability' : 'Délivrabilité', keys: [
      { field: 'mailreachKey', label: 'MailReach', desc: en ? 'Warm-up and inbox monitoring' : 'Warm-up et monitoring inbox', placeholder: en ? 'Your MailReach API key' : 'Votre clé API MailReach', color: '#E17055', icon: 'MR' },
      { field: 'warmboxKey', label: 'Warmbox', desc: en ? 'Automated email warm-up' : 'Préchauffage email automatisé', placeholder: en ? 'Your Warmbox API key' : 'Votre clé API Warmbox', color: '#FDCB6E', icon: 'Wb' },
    ]},
  ];
}

const DEFAULT_PREFERENCES = {
  lemlistDailyLimit: '50',
  sendingWindow: '9h-18h',
  sendingDays: 'Lun-Ven',
  claudeModel: 'claude-3-sonnet',
  notificationEmail: '',
};

/* ─── Status badge helpers ─── */

function StatusBadge({ status, lang }) {
  if (!status) return null;
  const en = lang === 'en';
  const map = {
    connected:      { text: null,       cls: 'settings-status-ok' },
    saved:          { text: en ? 'Saved' : 'Sauvegardé',      cls: 'settings-status-ok' },
    not_configured: { text: en ? 'Not configured' : 'Non configuré',   cls: 'settings-status-none' },
    invalid:        { text: en ? 'Invalid key' : 'Clé invalide',    cls: 'settings-status-err' },
    error:          { text: en ? 'Error' : 'Erreur',          cls: 'settings-status-err' },
    testing:        { text: en ? 'Testing...' : 'Test...',         cls: 'settings-status-testing' },
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
  const en = lang === 'en';
  const MAIN_TOOLS = getMainTools(lang);
  const EXTENDED_TOOLS = getExtendedTools(lang);
  const [preferences, setPreferences] = useState(() => {
    const saved = localStorage.getItem('bakal-preferences');
    try { return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_PREFERENCES }; } catch { return { ...DEFAULT_PREFERENCES }; }
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
          title: en ? 'Lemlist sync' : 'Synchronisation Lemlist',
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: en ? 'Lemlist error' : 'Erreur Lemlist',
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('lemlist:sync', onSync);
    return () => socket.off('lemlist:sync', onSync);
  }, [socket, notifyToast, en]);

  /* ─── Socket listener for outreach sync progress (Apollo/Instantly/Smartlead) ─── */

  useEffect(() => {
    if (!socket) return;
    const onOutreachSync = (data) => {
      setSyncStatus(data);
      if (data.status === 'done') {
        notifyToast({
          type: 'success',
          title: en ? `${data.provider || 'Outreach'} sync` : `Synchronisation ${data.provider || 'Outreach'}`,
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: en ? `${data.provider || 'Outreach'} error` : `Erreur ${data.provider || 'Outreach'}`,
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('outreach:sync', onOutreachSync);
    return () => socket.off('outreach:sync', onOutreachSync);
  }, [socket, notifyToast, en]);

  /* ─── Socket listener for CRM sync progress ─── */

  useEffect(() => {
    if (!socket) return;
    const onCrmSync = (data) => {
      setCrmSyncStatus(data);
      if (data.status === 'done') {
        notifyToast({
          type: 'success',
          title: en ? 'CRM analysis' : 'Analyse CRM',
          message: data.message,
          duration: 5000,
        });
      } else if (data.status === 'error') {
        notifyToast({
          type: 'danger',
          title: en ? 'CRM error' : 'Erreur CRM',
          message: data.message,
          duration: 5000,
        });
      }
    };
    socket.on('crm:sync', onCrmSync);
    return () => socket.off('crm:sync', onCrmSync);
  }, [socket, notifyToast, en]);

  /* ─── Outreach sync handler ─── */

  async function handleSyncOutreach() {
    setSyncStatus({ status: 'starting', progress: 0, message: en ? 'Starting...' : 'Lancement...' });
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
    setCrmSyncStatus({ status: 'starting', progress: 0, message: en ? 'Starting...' : 'Lancement...' });
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
      title: type === 'error' ? (en ? 'Error' : 'Erreur') : (en ? 'Success' : 'Succès'),
      message: msg,
      duration: 3000,
    });
  }, [notifyToast, en]);

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
        showToast(en ? 'Key saved' : 'Clé sauvegardée');
        cancelEdit(field);
        await loadKeys();
      }
    } catch (err) {
      showToast(err.message || (en ? 'Save error' : 'Erreur de sauvegarde'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeField(field) {
    setSaving(true);
    try {
      await saveKeys({ [field]: '' });
      showToast(en ? 'Key deleted' : 'Clé supprimée');
      cancelEdit(field);
      setTestStatus(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      await loadKeys();
    } catch (err) {
      showToast(err.message || (en ? 'Error' : 'Erreur'), 'error');
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
      showToast(en ? 'Connection tests completed' : 'Tests de connexion terminés');
    } catch (err) {
      showToast(err.message || (en ? 'Error during tests' : 'Erreur lors des tests'), 'error');
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
    showToast(en ? 'Preferences reset' : 'Préférences réinitialisées');
  }

  function handleSaveAll() {
    localStorage.setItem('bakal-preferences', JSON.stringify(preferences));
    showToast(en ? 'Settings saved' : 'Paramètres enregistrés');
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

  const crmFieldLabels = { hubspotKey: 'HubSpot', salesforceKey: 'Salesforce', pipedriveKey: 'Pipedrive', odooKey: 'Odoo', notionToken: 'Notion', airtableKey: 'Airtable' };
  const connectedCrmField = Object.keys(crmFieldLabels).find(f => keyStatus[f]?.configured);
  const connectedCrmLabel = connectedCrmField ? crmFieldLabels[connectedCrmField] : null;

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
            {test && <StatusBadge status={test} lang={lang} />}
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
              <button className="btn btn-ghost btn-sm" onClick={() => cancelEdit(keyDef.field)}>{en ? 'Cancel' : 'Annuler'}</button>
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
                  {isEditing && tool.multiField === true && (
                    <OdooConfigForm
                      draft={drafts[tool.field] || ''}
                      onSave={(json) => { setDrafts(prev => ({ ...prev, [tool.field]: json })); saveField(tool.field, json); }}
                      onCancel={() => cancelEdit(tool.field)}
                      saving={saving}
                      isConnected={isConnected}
                      onRemove={() => removeField(tool.field)}
                    />
                  )}
                  {isEditing && tool.multiField === 'salesforce' && (
                    <SalesforceConfigForm
                      onCancel={() => cancelEdit(tool.field)}
                      saving={saving}
                      isConnected={isConnected}
                      onRemove={() => removeField(tool.field)}
                      onDone={() => { cancelEdit(tool.field); loadKeys(); }}
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
                              {en ? 'Open' : 'Ouvrir'} {tool.label} {'\u2192'}
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

                  {/* Metadata config for Notion / Airtable (shown when connected) */}
                  {isConnected && tool.hasMetadata && (
                    <MetadataConfig provider={tool.hasMetadata} en={en} />
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
            {showMore ? (en ? 'Show less' : 'Voir moins') : (en ? 'More integrations' : 'Voir plus d\'intégrations')}
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
              {en ? 'Sync your campaigns and analyze performance patterns with Baakal' : 'Synchronise vos campagnes et analyse les patterns de performance avec Baakal'}
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSyncOutreach}
            disabled={syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'}
          >
            {syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'
              ? (en ? 'Syncing...' : 'Synchronisation...')
              : `${en ? 'Sync' : 'Synchroniser'} ${connectedOutreach ? connectedOutreach.label : 'Outreach'}`}
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
            <div className="card-title">{en ? 'CRM Analysis' : 'Analyse CRM'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {connectedCrmLabel
                ? (en ? `Connected to ${connectedCrmLabel}` : `Connect\u00e9 \u00e0 ${connectedCrmLabel}`)
                : (en ? 'Connect a CRM above to get started' : 'Connectez un CRM ci-dessus pour commencer')}
            </div>
          </div>
          {connectedCrmLabel && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSyncCRM}
              disabled={crmSyncStatus && crmSyncStatus.status !== 'done' && crmSyncStatus.status !== 'error'}
            >
              {crmSyncStatus && crmSyncStatus.status !== 'done' && crmSyncStatus.status !== 'error'
                ? (en ? 'Syncing...' : 'Analyse...')
                : (en ? 'Analyze CRM' : 'Analyser le CRM')}
            </button>
          )}
        </div>
        <div className="card-body" style={{ paddingTop: connectedCrmLabel ? 0 : undefined }}>
          {/* Explanation when no sync has been run */}
          {connectedCrmLabel && !crmSyncStatus && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {en ? (
                <>
                  Click <strong>Analyze CRM</strong> to let baakalai scan your {connectedCrmLabel} data. The AI will:
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 16 }}>
                    <li>Identify <strong>conversion patterns</strong> (what wins vs. what loses)</li>
                    <li>Build your <strong>ideal customer profile</strong> from real data</li>
                    <li>Detect <strong>stagnant deals</strong> and suggest next actions</li>
                    <li>Score <strong>churn risk</strong> for each contact</li>
                    <li>Find <strong>data quality issues</strong> (duplicates, missing emails, formatting)</li>
                  </ul>
                </>
              ) : (
                <>
                  Cliquez sur <strong>Analyser le CRM</strong> pour laisser baakalai scanner vos donn\u00e9es {connectedCrmLabel}. L'IA va :
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 16 }}>
                    <li>Identifier les <strong>patterns de conversion</strong> (ce qui gagne vs. ce qui perd)</li>
                    <li>Construire votre <strong>profil client id\u00e9al</strong> depuis vos donn\u00e9es r\u00e9elles</li>
                    <li>D\u00e9tecter les <strong>deals stagnants</strong> et sugg\u00e9rer des actions</li>
                    <li>Scorer le <strong>risque de churn</strong> par contact</li>
                    <li>Trouver les <strong>probl\u00e8mes de qualit\u00e9</strong> (doublons, emails manquants, formatage)</li>
                  </ul>
                </>
              )}
            </div>
          )}
          {/* No CRM connected */}
          {!connectedCrmLabel && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
              {en
                ? 'Connect Pipedrive, HubSpot, Salesforce, Odoo, Notion or Airtable above to unlock CRM analysis.'
                : 'Connectez Pipedrive, HubSpot, Salesforce, Odoo, Notion ou Airtable ci-dessus pour d\u00e9bloquer l\'analyse CRM.'}
            </div>
          )}
          {/* Progress bar during sync */}
          {crmSyncStatus && (
            <div style={{ marginTop: connectedCrmLabel && !crmSyncStatus ? 12 : 0 }}>
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
              <div style={{ fontSize: 12, color: crmSyncStatus.status === 'done' ? 'var(--success)' : crmSyncStatus.status === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
                {crmSyncStatus.status === 'done' ? '\u2705 ' : crmSyncStatus.status === 'error' ? '\u274c ' : ''}{crmSyncStatus.message || ''}
              </div>
              {crmSyncStatus.status === 'done' && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  {en
                    ? 'Patterns saved to AI Memory. View them in the Memory Explorer page.'
                    : 'Patterns sauvegard\u00e9s dans la M\u00e9moire IA. Consultez-les dans la page M\u00e9moire.'}
                </div>
              )}
            </div>
          )}
        </div>
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
                <option value="25">25 emails/{en ? 'day' : 'jour'}</option>
                <option value="50">50 emails/{en ? 'day' : 'jour'}</option>
                <option value="100">100 emails/{en ? 'day' : 'jour'}</option>
                <option value="200">200 emails/{en ? 'day' : 'jour'}</option>
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
                <option value="Lun-Ven">{en ? 'Mon-Fri' : 'Lun-Ven'}</option>
                <option value="Lun-Sam">{en ? 'Mon-Sat' : 'Lun-Sam'}</option>
                <option value="Tous les jours">{en ? 'Every day' : 'Tous les jours'}</option>
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
          <div className="card-title">{en ? 'Theme' : 'Thème'}</div>
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
                  {en ? 'Light' : 'Clair'}
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  {en ? 'Dark' : 'Sombre'}
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
          <div className="card-title">{en ? 'Notifications' : 'Notifications'}</div>
        </div>
        <div className="card-body">
          <div className="settings-pref-row">
            <label className="settings-pref-label">{en ? 'Notification email' : 'Email de notification'}</label>
            <input
              className="form-input"
              type="email"
              placeholder={en ? "your@email.com" : "votre@email.com"}
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

      {/* Restart onboarding */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{en ? 'Onboarding wizard' : 'Assistant de configuration'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {en ? 'Re-run the setup wizard to update your company profile and connections.' : 'Relancez l\'assistant pour mettre à jour votre profil et vos connexions.'}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => {
            localStorage.removeItem('bakal_onboarding_complete');
            const tkn = localStorage.getItem('bakal_token');
            fetch('/api/auth/onboarding-reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}) },
            }).catch(() => {});
            window.location.reload();
          }}>
            {en ? 'Restart onboarding' : 'Relancer l\'onboarding'}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <DeleteAccountSection t={t} showToast={showToast} lang={lang} />
      </div>
      </div>
    </div>
  );
}

/* ═══ Delete Account Section ═══ */

function DeleteAccountSection({ t, showToast, lang }) {
  const en = lang === 'en';
  const [showConfirm, setShowConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Check if user is OAuth-only (no password_hash)
  let user = {};
  try { user = JSON.parse(localStorage.getItem('bakal_user') || '{}'); } catch { /* ignore */ }
  const isOAuth = !user.hasPassword && user.hasPassword !== undefined;

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAccount(password || undefined);
      showToast(t('settings.deleteAccountSuccess'));
      setTimeout(() => { window.location.href = '/'; }, 1500);
    } catch (err) {
      showToast(err.message, 'error');
      setDeleting(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24, border: '1px solid var(--danger, #e74c3c)' }}>
      <div className="card-header">
        <div className="card-title" style={{ color: 'var(--danger, #e74c3c)' }}>
          {t('settings.dangerZone')}
        </div>
      </div>
      <div className="card-body">
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          {t('settings.deleteAccountDesc')}
        </p>

        {!showConfirm ? (
          <button
            className="btn"
            onClick={() => setShowConfirm(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--danger, #e74c3c)',
              color: 'var(--danger, #e74c3c)',
              fontSize: 13,
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            {t('settings.deleteAccount')}
          </button>
        ) : (
          <div style={{
            background: 'rgba(231,76,60,0.05)',
            border: '1px solid var(--danger, #e74c3c)',
            borderRadius: 8,
            padding: 16,
          }}>
            <p style={{ fontSize: 13, color: 'var(--danger, #e74c3c)', fontWeight: 600, marginBottom: 12 }}>
              {t('settings.deleteAccountConfirm')}
            </p>
            <input
              className="form-input"
              type="password"
              placeholder={t('settings.deleteAccountPassword')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setShowConfirm(false); setPassword(''); } }}
              style={{ marginBottom: 12, fontSize: 13 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn"
                onClick={handleDelete}
                disabled={deleting || !password.trim()}
                style={{
                  background: 'var(--danger, #e74c3c)',
                  color: 'white',
                  border: 'none',
                  fontSize: 13,
                  padding: '8px 16px',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting || !password.trim() ? 0.5 : 1,
                }}
              >
                {deleting ? t('settings.deleting') : t('settings.deleteAccount')}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { setShowConfirm(false); setPassword(''); }}
                disabled={deleting}
              >
                {en ? 'Cancel' : 'Annuler'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Metadata Config (Notion database selector / Airtable base+table) ═══ */

function MetadataConfig({ provider, en }) {
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState('');
  const [baseId, setBaseId] = useState('');
  const [saved, setSaved] = useState(false);
  const [currentMeta, setCurrentMeta] = useState(null);

  // Load current metadata on mount
  useEffect(() => {
    request('/settings/keys').then(data => {
      const keys = data.keys || data;
      const providerKey = provider === 'notion' ? 'notionToken' : 'airtableKey';
      const info = keys[providerKey];
      if (info?.metadata) {
        setCurrentMeta(info.metadata);
        if (provider === 'notion' && info.metadata.database_id) setSelected(info.metadata.database_id);
        if (provider === 'airtable') {
          if (info.metadata.base_id) setBaseId(info.metadata.base_id);
          if (info.metadata.table_name) setSelected(info.metadata.table_name);
        }
      }
    }).catch(() => {});
  }, [provider]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      if (provider === 'notion') {
        const data = await request('/crm/notion/databases');
        setOptions(data.databases || []);
      } else if (provider === 'airtable' && baseId.trim()) {
        const data = await request(`/crm/airtable/tables?baseId=${encodeURIComponent(baseId.trim())}`);
        setOptions(data.tables || []);
      }
    } catch { setOptions([]); }
    setLoading(false);
  }, [provider, baseId]);

  useEffect(() => {
    if (provider === 'notion') loadOptions();
  }, [provider, loadOptions]);

  const [saveError, setSaveError] = useState(null);

  const handleSave = useCallback(async () => {
    setSaved(false);
    setSaveError(null);
    try {
      const metadata = provider === 'notion'
        ? { database_id: selected }
        : { base_id: baseId.trim(), table_name: selected };
      await request('/settings/keys/metadata', {
        method: 'PATCH',
        body: JSON.stringify({ provider, metadata }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 5000);
    } catch (err) {
      setSaveError(err.message || 'Save failed');
    }
  }, [provider, selected, baseId]);

  if (provider === 'notion') {
    return (
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
          {en ? 'Select your CRM database' : 'Sélectionnez votre base CRM'}
        </div>
        {loading && <span style={{ color: 'var(--text-muted)' }}>{en ? 'Loading databases...' : 'Chargement des bases...'}</span>}
        {options && options.length > 0 && (
          <select className="form-input" style={{ fontSize: 12, padding: '6px 8px', width: '100%', marginBottom: 6 }}
            value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">{en ? '— Select a database —' : '— Choisir une base —'}</option>
            {options.map(db => <option key={db.id} value={db.id}>{db.title}</option>)}
          </select>
        )}
        {options && options.length === 0 && !loading && (
          <div style={{ color: 'var(--warning)', fontSize: 11 }}>
            {en ? 'No databases found. Share your Notion database with the integration first.' : 'Aucune base trouvée. Partagez d\'abord votre base Notion avec l\'intégration.'}
          </div>
        )}
        {selected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={handleSave}>
              {saved ? (en ? 'Saved!' : 'Enregistré !') : (en ? 'Save database' : 'Enregistrer la base')}
            </button>
            {saved && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>{'\u2705'}</span>}
          </div>
        )}
        {saveError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{saveError}</div>}
        {currentMeta?.database_id && !selected && (
          <div style={{ fontSize: 11, color: 'var(--success)' }}>{'\u2705'} {en ? 'Database configured' : 'Base configurée'}</div>
        )}
      </div>
    );
  }

  if (provider === 'airtable') {
    return (
      <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }}>
          {en ? 'Configure your Airtable base' : 'Configurez votre base Airtable'}
        </div>
        <input className="form-input" style={{ fontSize: 12, padding: '6px 8px', width: '100%', marginBottom: 6 }}
          placeholder={en ? 'Base ID (appXXXXXXXXXX)' : 'Base ID (appXXXXXXXXXX)'}
          value={baseId} onChange={e => setBaseId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && baseId.trim()) loadOptions(); }}
        />
        {baseId.trim() && !options && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', marginBottom: 6 }}
            onClick={loadOptions} disabled={loading}>
            {loading ? '...' : (en ? 'Load tables' : 'Charger les tables')}
          </button>
        )}
        {options && options.length > 0 && (
          <select className="form-input" style={{ fontSize: 12, padding: '6px 8px', width: '100%', marginBottom: 6 }}
            value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">{en ? '— Select a table —' : '— Choisir une table —'}</option>
            {options.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        )}
        {options && options.length === 0 && !loading && (
          <div style={{ color: 'var(--warning)', fontSize: 11 }}>
            {en ? 'No tables found. Check your Base ID.' : 'Aucune table trouvée. Vérifiez le Base ID.'}
          </div>
        )}
        {selected && baseId.trim() && (
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={handleSave}>
            {saved ? (en ? 'Saved!' : 'Enregistré !') : (en ? 'Save config' : 'Enregistrer')}
          </button>
        )}
        {currentMeta?.base_id && !baseId && (
          <div style={{ fontSize: 11, color: 'var(--success)' }}>{en ? 'Base configured' : 'Base configurée'}: {currentMeta.base_id} / {currentMeta.table_name}</div>
        )}
      </div>
    );
  }

  return null;
}

/* ═══ Odoo Config Form ═══ */

function SalesforceConfigForm({ onCancel, saving, isConnected, onRemove, onDone }) {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const [accessToken, setAccessToken] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [status, setStatus] = useState(null);

  const handleConnect = async () => {
    if (!accessToken || !instanceUrl) return;
    setStatus('connecting');
    try {
      const res = await request('/api/crm/salesforce/manual-connect', {
        method: 'POST',
        body: JSON.stringify({ accessToken, instanceUrl: instanceUrl.replace(/\/$/, '') }),
      });
      if (res.ok && res.status === 'connected') {
        setStatus('connected');
        setTimeout(() => onDone(), 1000);
      } else {
        setStatus(res.status === 'saved_but_test_failed' ? 'test_failed' : 'error');
      }
    } catch {
      setStatus('error');
    }
  };

  const isValid = accessToken.length > 10 && instanceUrl.startsWith('http');

  return (
    <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', marginBottom: 8,
        background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.6,
      }}>
        {en
          ? <>1. Log in to your Salesforce instance<br/>2. Setup &gt; Apps &gt; Connected Apps<br/>3. Generate an access token<br/>4. Paste both fields below</>
          : <>1. Connectez-vous sur votre instance Salesforce<br/>2. Setup &gt; Apps &gt; Connected Apps<br/>3. G{'\u00E9'}n{'\u00E9'}rez un access token<br/>4. Collez les deux champs ci-dessous</>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input className="form-input" type="text"
          placeholder={en ? "Instance URL (e.g., https://mycompany.salesforce.com)" : "URL de l'instance (ex: https://mycompany.salesforce.com)"}
          value={instanceUrl} onChange={e => setInstanceUrl(e.target.value)} autoFocus
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="password"
          placeholder={en ? "Access token" : "Access token"}
          value={accessToken} onChange={e => setAccessToken(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
      </div>
      {status === 'connected' && (
        <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>{en ? 'Connected!' : 'Connect\u00E9 !'}</div>
      )}
      {status === 'test_failed' && (
        <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>{en ? 'Saved but connection test failed — token may have expired' : 'Sauvegard\u00E9 mais test \u00E9chou\u00E9 — le token a peut-\u00EAtre expir\u00E9'}</div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{en ? 'Connection failed' : '\u00C9chec de connexion'}</div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button className="btn btn-primary" style={{ fontSize: 10, padding: '3px 8px', flex: 1 }}
          onClick={handleConnect} disabled={saving || status === 'connecting' || !isValid}>
          {status === 'connecting' ? (en ? 'Connecting...' : 'Connexion...') : (en ? 'Connect' : 'Connecter')}
        </button>
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

function OdooConfigForm({ onSave, onCancel, saving, isConnected, onRemove }) {
  const { t, lang } = useI18n();
  const en = lang === 'en';
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
        {en ? <>Find this info in Odoo: <b>Settings &gt; Technical &gt; Database</b></> : <>Trouvez ces infos dans Odoo : <b>Param{'\u00E8'}tres &gt; Technique &gt; Base de donn{'\u00E9'}es</b></>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input className="form-input" type="text" placeholder={en ? "Odoo URL (e.g., https://mysite.odoo.com)" : "URL Odoo (ex: https://monsite.odoo.com)"}
          value={url} onChange={e => setUrl(e.target.value)} autoFocus
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="text" placeholder={en ? "Database name (e.g., mycompany)" : "Nom de la base (ex: mycompany)"}
          value={dbName} onChange={e => setDbName(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="text" placeholder={en ? "Email / username" : "Email / identifiant"}
          value={username} onChange={e => setUsername(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
        <input className="form-input" type="password" placeholder={en ? "Password or API key" : `Mot de passe ou cl${'\u00E9'} API`}
          value={password} onChange={e => setPassword(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px' }} />
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button className="btn btn-primary" style={{ fontSize: 10, padding: '3px 8px', flex: 1 }}
          onClick={handleSave} disabled={saving || !isValid}>{en ? 'Connect' : 'Connecter'}</button>
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
