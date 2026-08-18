/* ===============================================================================
   BAKAL — Onboarding Wizard (React)
   Single-screen, two-card flow shown on first login: connect a CRM, connect an
   email account. Both are skippable (soft-required, not gated) — everything else
   (company profile, documents, outreach tools) is left for later, via Settings/
   Profile or conversationally through the general assistant.
   Sets localStorage 'bakal_onboarding_complete' on finish.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { saveKeys, getKeys, request } from '../services/api-client';
import { useT } from '../i18n';
import EmailAccountSettings from './EmailAccountSettings';

const CRM_GUIDES = {
  hubspot: {
    field: 'hubspotKey',
    guide: [
      'Connectez-vous sur app.hubspot.com',
      'Allez dans Settings → Integrations → Private Apps',
      'Créez une app ou copiez le token (commence par pat-)',
    ],
    link: 'https://app.hubspot.com/settings/integrations',
    placeholder: 'pat-...',
  },
  pipedrive: {
    field: 'pipedriveKey',
    guide: [
      'Connectez-vous sur app.pipedrive.com',
      'Allez dans Settings → Personal preferences → API',
      'Copiez le token personnel affiché',
    ],
    link: 'https://app.pipedrive.com/settings/api',
    placeholder: 'Votre clé API',
  },
  salesforce: {
    field: 'salesforceKey',
    guide: [
      'Connectez-vous sur votre instance Salesforce',
      'Allez dans Setup → Apps → Connected Apps',
      'Créez une connected app et copiez le consumer key',
    ],
    link: null,
    placeholder: 'Votre clé API',
  },
  odoo: {
    field: 'odooKey',
    guide: [
      'Connectez-vous sur votre instance Odoo',
      'Allez dans Paramètres → Technique → Base de données',
      'Notez l\'URL, le nom de base, votre login et mot de passe',
    ],
    link: null,
    placeholder: 'Votre clé API',
  },
};

/* ─── CRM connect card ─── */

function CrmCard({ t, connected, onConnected }) {
  const [crmProvider, setCrmProvider] = useState('');
  const [crmKey, setCrmKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const handleSave = useCallback(async () => {
    const guide = CRM_GUIDES[crmProvider];
    if (!crmKey.trim() || !guide) return;
    setSaving(true);
    setError(false);
    try {
      const res = await saveKeys({ [guide.field]: crmKey.trim() });
      if (res.errors && res.errors.length > 0) {
        setError(true);
      } else {
        request('/settings/keys/sync-crm', { method: 'POST' }).catch(() => {});
        onConnected(crmProvider);
      }
    } catch {
      setError(true);
    }
    setSaving(false);
  }, [crmProvider, crmKey, onConnected]);

  if (connected) {
    return (
      <div className="wizard-key-row">
        <div className="wizard-key-icon">✅</div>
        <div className="wizard-key-input">
          <div className="wizard-key-label">{t('wizard.crmCardTitle')}</div>
          <div style={{ fontSize: 13, color: 'var(--success)' }}>{t('wizard.connected')}</div>
        </div>
      </div>
    );
  }

  const guide = CRM_GUIDES[crmProvider];

  return (
    <div className="wizard-key-row">
      <div className="wizard-key-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <div className="wizard-key-input">
        <div className="wizard-key-label">{t('wizard.crmCardTitle')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('wizard.crmCardDesc')}</div>
        <select className="form-input" value={crmProvider} onChange={e => { setCrmProvider(e.target.value); setCrmKey(''); setError(false); }} style={{ marginBottom: 8 }}>
          <option value="">{t('wizard.selectCrm')}</option>
          <option value="hubspot">HubSpot</option>
          <option value="pipedrive">Pipedrive</option>
          <option value="salesforce">Salesforce</option>
          <option value="odoo">Odoo</option>
        </select>
        {crmProvider && (
          <>
            <div style={{ fontSize: 12, background: 'var(--paper-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 8, lineHeight: 1.6 }}>
              <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--grey-700)' }}>
                {(guide?.guide || []).map((s, i) => <li key={i}>{s}</li>)}
              </ol>
              {guide?.link && (
                <a href={guide.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--primary)', display: 'inline-block', marginTop: 6 }}>
                  Ouvrir {crmProvider.charAt(0).toUpperCase() + crmProvider.slice(1)} {'→'}
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="password"
                placeholder={guide?.placeholder}
                value={crmKey}
                onChange={e => setCrmKey(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !crmKey.trim()}>
                {saving ? t('wizard.saving') : t('wizard.connect')}
              </button>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                Format de clé invalide. Vérifiez et réessayez.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Main wizard ─── */

export default function OnboardingWizard({ onComplete }) {
  const t = useT();
  const [crmConnected, setCrmConnected] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Check current CRM connection state on mount so a user who already connected one
  // sees it as done immediately instead of re-prompted. Email's own "already connected"
  // state is handled by EmailAccountSettings itself, no need to duplicate it here.
  useEffect(() => {
    (async () => {
      try {
        const keysRes = await getKeys().catch(() => ({ keys: {} }));
        const crmFields = ['hubspotKey', 'pipedriveKey', 'salesforceKey', 'odooKey'];
        setCrmConnected(crmFields.some(f => keysRes.keys?.[f]?.configured));
      } catch { /* ignore — show the connect form */ }
      setLoadingStatus(false);
    })();
  }, []);

  function handleFinish() {
    const token = localStorage.getItem('bakal_token');
    fetch('/api/auth/onboarding-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).catch(() => {});
    localStorage.setItem('bakal_onboarding_complete', 'true');
    if (onComplete) onComplete();
  }

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <div className="wizard-logo">
            <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
              <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round"/>
              <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="22" cy="26" r="7" fill="#C4B5FD"/>
              <circle cx="82" cy="30" r="8" fill="#9A84EB"/>
              <circle cx="30" cy="80" r="7" fill="#C4B5FD"/>
              <circle cx="50" cy="50" r="13" fill="#6E57FA"/>
            </svg>
          </div>
          <div className="wizard-title">{t('wizard.welcomeTitle')}</div>
          <div className="wizard-subtitle">{t('wizard.welcomeSubtitle')}</div>
        </div>

        <div className="wizard-body">
          {!loadingStatus && (
            <div className="wizard-core-keys">
              <CrmCard t={t} connected={crmConnected} onConnected={() => setCrmConnected(true)} />

              <div className="wizard-key-row" style={{ alignItems: 'flex-start' }}>
                <div className="wizard-key-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="wizard-key-input">
                  <div className="wizard-key-label">{t('wizard.emailCardTitle')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('wizard.emailCardDesc')}</div>
                  <EmailAccountSettings />
                </div>
              </div>
            </div>
          )}

          <div className="wizard-actions">
            <button className="btn btn-primary" onClick={handleFinish}>
              {t('wizard.goToDashboard')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
