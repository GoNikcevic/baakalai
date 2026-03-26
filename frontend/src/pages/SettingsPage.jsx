/* ===============================================================================
   BAKAL — Settings Page (React)
   API key management with encrypted storage, test connectivity, masked display.
   Includes preferences, theme toggle, notification settings, and integrations library.
   Backend: routes/settings.js (GET/POST /api/settings/keys, POST /keys/test)
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { getKeys, saveKeys, testKeys, syncLemlist, syncCRM } from '../services/api-client';
import { useNotifications } from '../context/NotificationContext';
import { useSocket } from '../context/SocketContext';

/* ─── Unified tool list organized by category ─── */

const TOOL_CATEGORIES = [
  {
    label: 'Outreach',
    description: 'Votre outil principal d\'envoi de campagnes',
    keys: [
      { field: 'lemlistKey', label: 'Lemlist', desc: 'Campagnes email et LinkedIn, séquences multi-canal', placeholder: 'Votre clé API Lemlist', color: '#6C5CE7', icon: 'L' },
      { field: 'apolloKey', label: 'Apollo', desc: 'Base B2B + séquences email automatisées', placeholder: 'Votre clé API Apollo', color: '#6C5CE7', icon: 'A' },
      { field: 'instantlyKey', label: 'Instantly', desc: 'Cold email à grande échelle', placeholder: 'Votre clé API Instantly', color: '#0984E3', icon: 'In' },
      { field: 'lgmKey', label: 'La Growth Machine', desc: 'Séquences multi-canal automatisées', placeholder: 'Votre clé API LGM', color: '#6C5CE7', icon: 'LG' },
      { field: 'waalaxyKey', label: 'Waalaxy', desc: 'Automatisation LinkedIn + email', placeholder: 'Votre clé API Waalaxy', color: '#A29BFE', icon: 'W' },
    ],
  },
  {
    label: 'CRM',
    description: 'Synchronisation contacts et deals',
    keys: [
      { field: 'hubspotKey', label: 'HubSpot', desc: 'CRM complet + marketing automation', placeholder: 'pat-...', color: '#FF6B35', icon: 'H' },
      { field: 'salesforceKey', label: 'Salesforce', desc: 'CRM enterprise + reporting avancé', placeholder: 'Votre clé API Salesforce', color: '#00A1E0', icon: 'S' },
      { field: 'pipedriveKey', label: 'Pipedrive', desc: 'CRM visuel orienté vente', placeholder: 'Votre clé API Pipedrive', color: '#017737', icon: 'P' },
    ],
  },
  {
    label: 'Enrichissement',
    keys: [
      { field: 'dropcontactKey', label: 'DropContact', desc: 'Enrichissement email et téléphone', placeholder: 'Votre clé API DropContact', color: '#00B894', icon: 'D' },
      { field: 'hunterKey', label: 'Hunter', desc: 'Recherche et vérification d\'emails', placeholder: 'Votre clé API Hunter', color: '#FF7675', icon: 'H' },
      { field: 'kasprKey', label: 'Kaspr', desc: 'Données LinkedIn en temps réel', placeholder: 'Votre clé API Kaspr', color: '#0984E3', icon: 'K' },
      { field: 'lushaKey', label: 'Lusha', desc: 'Coordonnées professionnelles', placeholder: 'Votre clé API Lusha', color: '#00CEC9', icon: 'Lu' },
      { field: 'snovKey', label: 'Snov.io', desc: 'Email finder et drip campaigns', placeholder: 'Votre clé API Snov', color: '#E17055', icon: 'S' },
    ],
  },
  {
    label: 'LinkedIn / Scraping',
    keys: [
      { field: 'phantombusterKey', label: 'PhantomBuster', desc: 'Scraping et automatisation web', placeholder: 'Votre clé API PhantomBuster', color: '#636E72', icon: 'PB' },
      { field: 'captaindataKey', label: 'Captain Data', desc: 'Extraction de données multi-sources', placeholder: 'Votre clé API CaptainData', color: '#0984E3', icon: 'CD' },
    ],
  },
  {
    label: 'Calendrier',
    keys: [
      { field: 'calendlyKey', label: 'Calendly', desc: 'Planification de RDV automatisée', placeholder: 'Votre clé API Calendly', color: '#0069FF', icon: 'Ca' },
      { field: 'calcomKey', label: 'Cal.com', desc: 'Alternative open-source à Calendly', placeholder: 'Votre clé API Cal.com', color: '#292929', icon: 'Cl' },
    ],
  },
  {
    label: 'Délivrabilité',
    keys: [
      { field: 'mailreachKey', label: 'MailReach', desc: 'Warm-up et monitoring inbox', placeholder: 'Votre clé API MailReach', color: '#E17055', icon: 'MR' },
      { field: 'warmboxKey', label: 'Warmbox', desc: 'Préchauffage email automatisé', placeholder: 'Votre clé API Warmbox', color: '#FDCB6E', icon: 'Wb' },
    ],
  },
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
    connected:      { text: 'Connecté',       cls: 'settings-status-ok' },
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
  const [preferences, setPreferences] = useState(() => {
    const saved = localStorage.getItem('bakal-preferences');
    return saved ? { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) } : { ...DEFAULT_PREFERENCES };
  });
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') || 'dark'
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

  /* ─── Lemlist sync handler ─── */

  async function handleSyncLemlist() {
    setSyncStatus({ status: 'starting', progress: 0, message: 'Lancement...' });
    try {
      await syncLemlist();
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

  async function saveField(field) {
    const value = (drafts[field] || '').trim();
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

  const allKeyDefs = TOOL_CATEGORIES.flatMap(g => g.keys);
  const configuredCount = Object.values(keyStatus).filter(k => k.configured).length;
  const totalCount = Object.keys(keyStatus).length || allKeyDefs.length;

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
                disabled={saving || !(drafts[keyDef.field] || '').trim()}>Sauver</button>
              <button className="btn btn-ghost btn-sm" onClick={() => cancelEdit(keyDef.field)}>Annuler</button>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => startEdit(keyDef.field)}>
              {info.configured ? 'Modifier' : 'Configurer'}
            </button>
            {info.configured && (
              <button className="btn btn-ghost btn-sm settings-btn-danger"
                onClick={() => removeField(keyDef.field)} disabled={saving}>Supprimer</button>
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
          <div className="page-title">Paramètres</div>
          <div className="page-subtitle">
            Configuration des intégrations et préférences — {configuredCount}/{totalCount} configurée{configuredCount !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={handleTestAll}
            disabled={testing}
          >
            {testing ? 'Test en cours...' : 'Tester tout'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveAll}
          >
            Enregistrer
          </button>
        </div>
      </div>

      {/* Tool categories — flat unified list */}
      {TOOL_CATEGORIES.map(cat => (
        <div className="card" key={cat.label} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-title">{cat.label}</div>
              {cat.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{cat.description}</div>}
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {cat.keys.map(keyDef => renderKeyRow(keyDef, keyStatus[keyDef.field]?.configured))}
          </div>
        </div>
      ))}

      {/* Lemlist Sync */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="card-title">Analyse Lemlist</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Synchronise vos campagnes Lemlist et analyse les patterns de performance avec Claude
            </div>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSyncLemlist}
            disabled={syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'}
          >
            {syncStatus && syncStatus.status !== 'done' && syncStatus.status !== 'error'
              ? 'Synchronisation...'
              : 'Synchroniser Lemlist'}
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
            <div className="card-title">Analyse CRM</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {connectedCrm
                ? `Synchronise vos deals ${connectedCrm.replace('Key', '')} et analyse les patterns de conversion avec Claude`
                : 'Synchronise vos deals CRM et analyse les patterns de conversion avec Claude'}
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

      {/* Preferences */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Préférences</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="settings-pref-row">
              <label className="settings-pref-label">Limite quotidienne Lemlist</label>
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
              <label className="settings-pref-label">Fenêtre d'envoi</label>
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
              <label className="settings-pref-label">Jours d'envoi</label>
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
              <label className="settings-pref-label">Modèle Claude</label>
              <select
                className="form-input"
                value={preferences.claudeModel}
                onChange={e => updatePreference('claudeModel', e.target.value)}
              >
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="claude-3-opus">Claude 3 Opus</option>
                <option value="claude-3-haiku">Claude 3 Haiku</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Theme toggle */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Thème</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{theme === 'dark' ? 'Mode sombre activé' : 'Mode clair activé'}</span>
            <div className="theme-toggle" onClick={toggleTheme} style={{ cursor: 'pointer', padding: '8px 16px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              {theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
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
          Réinitialiser les préférences
        </button>
      </div>
    </div>
  );
}
