/* ===============================================================================
   BAKAL — Settings Page (React)
   API key management with encrypted storage, test connectivity, masked display.
   Backend: routes/settings.js (GET/POST /api/settings/keys, POST /keys/test)
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { getKeys, saveKeys, testKeys } from '../services/api-client';

/* ─── Key definitions grouped by category ─── */

const KEY_GROUPS = [
  {
    label: 'Core',
    keys: [
      { field: 'lemlistKey', label: 'Lemlist', placeholder: 'Votre clé API Lemlist', required: true },
      { field: 'claudeKey', label: 'Claude (Anthropic)', placeholder: 'sk-ant-...', required: true },
      { field: 'notionToken', label: 'Notion', placeholder: 'ntn_ ou secret_...' },
    ],
  },
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
  const [keyStatus, setKeyStatus] = useState({});    // { field: { configured, masked, updatedAt } }
  const [testStatus, setTestStatus] = useState({});   // { field: { status, message } }
  const [drafts, setDrafts] = useState({});            // { field: 'new-value' } — only fields being edited
  const [editing, setEditing] = useState({});          // { field: true } — which fields are in edit mode
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState(null);

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
    // Mark all configured as testing
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

  /* ─── Count configured keys ─── */

  const configuredCount = Object.values(keyStatus).filter(k => k.configured).length;
  const totalCount = Object.keys(keyStatus).length || KEY_GROUPS.reduce((n, g) => n + g.keys.length, 0);

  /* ─── Render ─── */

  return (
    <div id="page-settings" className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">Paramètres</div>
          <div className="page-subtitle">
            Gérez vos clés API et intégrations — {configuredCount}/{totalCount} configurée{configuredCount !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={handleTestAll}
            disabled={testing || configuredCount === 0}
          >
            {testing ? 'Test en cours...' : 'Tester les connexions'}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`settings-toast ${toast.type === 'error' ? 'settings-toast-err' : ''}`}>
          {toast.msg}
        </div>
      )}

      {/* Key groups */}
      {KEY_GROUPS.map(group => (
        <div className="card" key={group.label} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">{group.label}</div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {group.keys.map(keyDef => {
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
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
