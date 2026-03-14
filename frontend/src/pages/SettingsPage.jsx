/* ===============================================================================
   BAKAL — Settings Page (React)
   API key management with encrypted storage, test connectivity, masked display.
   Includes preferences, theme toggle, notification settings, and integrations library.
   Backend: routes/settings.js (GET/POST /api/settings/keys, POST /keys/test)
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { getKeys, saveKeys, testKeys } from '../services/api-client';

/* ─── Key definitions grouped by category ─── */

const CORE_KEYS = [
  { field: 'lemlistKey', label: 'Lemlist', placeholder: 'Votre clé API Lemlist', required: true },
  { field: 'claudeKey', label: 'Claude (Anthropic)', placeholder: 'sk-ant-...', required: true },
  { field: 'notionToken', label: 'Notion', placeholder: 'ntn_ ou secret_...' },
];

const EXTENDED_GROUPS = [
  {
    label: 'CRM',
    keys: [
      { field: 'hubspotKey', label: 'HubSpot', placeholder: 'pat-...' },
      { field: 'pipedriveKey', label: 'Pipedrive', placeholder: 'Votre clé API Pipedrive' },
      { field: 'salesforceKey', label: 'Salesforce', placeholder: 'Votre clé API Salesforce' },
      { field: 'folkKey', label: 'Folk', placeholder: 'Votre clé API Folk' },
    ],
  },
  {
    label: 'Enrichissement',
    keys: [
      { field: 'dropcontactKey', label: 'DropContact', placeholder: 'Votre clé API DropContact' },
      { field: 'apolloKey', label: 'Apollo', placeholder: 'Votre clé API Apollo' },
      { field: 'hunterKey', label: 'Hunter', placeholder: 'Votre clé API Hunter' },
      { field: 'kasprKey', label: 'Kaspr', placeholder: 'Votre clé API Kaspr' },
      { field: 'lushaKey', label: 'Lusha', placeholder: 'Votre clé API Lusha' },
      { field: 'snovKey', label: 'Snov.io', placeholder: 'Votre clé API Snov' },
    ],
  },
  {
    label: 'Outreach',
    keys: [
      { field: 'instantlyKey', label: 'Instantly', placeholder: 'Votre clé API Instantly' },
      { field: 'lgmKey', label: 'La Growth Machine', placeholder: 'Votre clé API LGM' },
      { field: 'waalaxyKey', label: 'Waalaxy', placeholder: 'Votre clé API Waalaxy' },
    ],
  },
  {
    label: 'LinkedIn / Scraping',
    keys: [
      { field: 'phantombusterKey', label: 'PhantomBuster', placeholder: 'Votre clé API PhantomBuster' },
      { field: 'captaindataKey', label: 'Captain Data', placeholder: 'Votre clé API CaptainData' },
    ],
  },
  {
    label: 'Calendrier',
    keys: [
      { field: 'calendlyKey', label: 'Calendly', placeholder: 'Votre clé API Calendly' },
      { field: 'calcomKey', label: 'Cal.com', placeholder: 'Votre clé API Cal.com' },
    ],
  },
  {
    label: 'Délivrabilité',
    keys: [
      { field: 'mailreachKey', label: 'MailReach', placeholder: 'Votre clé API MailReach' },
      { field: 'warmboxKey', label: 'Warmbox', placeholder: 'Votre clé API Warmbox' },
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
  const [toast, setToast] = useState(null);
  const [showExtended, setShowExtended] = useState(false);
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

  /* ─── Toast helper ─── */

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

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

  const allKeyDefs = [
    ...CORE_KEYS,
    ...EXTENDED_GROUPS.flatMap(g => g.keys),
  ];
  const configuredCount = Object.values(keyStatus).filter(k => k.configured).length;
  const totalCount = Object.keys(keyStatus).length || allKeyDefs.length;

  /* ─── Render key row ─── */

  function renderKeyRow(keyDef) {
    const info = keyStatus[keyDef.field] || {};
    const isEditing = editing[keyDef.field];
    const test = testStatus[keyDef.field];

    return (
      <div className="settings-key-row" key={keyDef.field}>
        <div className="settings-key-info">
          <div className="settings-key-label">
            {keyDef.label}
            {keyDef.required && <span className="settings-required">requis</span>}
          </div>
          {info.configured && !isEditing && (
            <div className="settings-key-masked">{info.masked}</div>
          )}
          {info.configured && info.updatedAt && !isEditing && (
            <div className="settings-key-date">
              Mis à jour le {new Date(info.updatedAt).toLocaleDateString('fr-FR')}
            </div>
          )}
        </div>

        <div className="settings-key-actions">
          {test && <StatusBadge status={test} />}

          {isEditing ? (
            <div className="settings-key-edit-row">
              <input
                className="form-input settings-key-input"
                type="password"
                placeholder={keyDef.placeholder}
                value={drafts[keyDef.field] || ''}
                onChange={e => setDrafts(prev => ({ ...prev, [keyDef.field]: e.target.value }))}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveField(keyDef.field);
                  if (e.key === 'Escape') cancelEdit(keyDef.field);
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => saveField(keyDef.field)}
                disabled={saving || !(drafts[keyDef.field] || '').trim()}
              >
                Sauver
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => cancelEdit(keyDef.field)}
              >
                Annuler
              </button>
            </div>
          ) : (
            <div className="settings-key-btns">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => startEdit(keyDef.field)}
              >
                {info.configured ? 'Modifier' : 'Configurer'}
              </button>
              {info.configured && (
                <button
                  className="btn btn-ghost btn-sm settings-btn-danger"
                  onClick={() => removeField(keyDef.field)}
                  disabled={saving}
                >
                  Supprimer
                </button>
              )}
            </div>
          )}
        </div>
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

      {/* Toast */}
      {toast && (
        <div className={`settings-toast ${toast.type === 'error' ? 'settings-toast-err' : ''}`}>
          {toast.msg}
        </div>
      )}

      {/* Core integrations */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Core</div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {CORE_KEYS.map(renderKeyRow)}
        </div>
      </div>

      {/* Integrations library */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Bibliothèque d'intégrations</div>
        </div>
        <div className="card-body">
          {!showExtended ? (
            <button
              className="btn btn-ghost"
              onClick={() => setShowExtended(true)}
              style={{ width: '100%' }}
            >
              Voir plus d'intégrations
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => setShowExtended(false)}
              style={{ width: '100%', marginBottom: 16 }}
            >
              Masquer les intégrations
            </button>
          )}
        </div>
      </div>

      {/* Extended integration groups */}
      {showExtended && EXTENDED_GROUPS.map(group => (
        <div className="card" key={group.label} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">{group.label}</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {group.keys.map(renderKeyRow)}
          </div>
        </div>
      ))}

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
