/* ===============================================================================
   BAKAL — Onboarding Checklist Component
   Shows a progress card on the dashboard for new users (beta testers).
   6-step guided tour to first campaign launch in <30 min.
   Complements the OnboardingWizard (wizard = initial setup, checklist = ongoing guide).
   =============================================================================== */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT } from '../i18n';
import { request } from '../services/api-client';

const STEP_CONFIG = [
  { key: 'accountCreated', route: null },
  { key: 'crmConnected', route: '/integrations' },
  { key: 'emailConnected', route: '/integrations' },
  { key: 'contactsImported', route: '/clients' },
  { key: 'firstCampaign', route: '/chat' },
  { key: 'firstLaunch', route: '/campaigns' },
];

export default function OnboardingChecklist() {
  const t = useT();
  const navigate = useNavigate();
  const { campaigns, opportunities } = useApp();

  const [keys, setKeys] = useState(null);
  const [emailAccounts, setEmailAccounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('bakal_checklist_dismissed') === 'true'
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [keysRes, emailRes] = await Promise.all([
          request('/settings/keys'),
          request('/nurture/email-accounts').catch(() => ({ accounts: [] })),
        ]);
        if (!cancelled) {
          setKeys(keysRes.keys || keysRes);
          setEmailAccounts(emailRes.accounts || []);
        }
      } catch { /* checklist won't show */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const campaignsList = useMemo(() => Object.values(campaigns || {}), [campaigns]);
  const contactsList = useMemo(() => Object.values(opportunities || {}), [opportunities]);

  const steps = useMemo(() => {
    if (loading) return null;

    // 1. Account created — always true if they see this
    const accountCreated = true;

    // 2. CRM connected — any of Pipedrive/HubSpot/Salesforce/Odoo configured
    const crmConnected = !!(keys && (
      (keys.pipedriveKey && keys.pipedriveKey.configured) ||
      (keys.hubspotKey && keys.hubspotKey.configured) ||
      (keys.salesforceKey && keys.salesforceKey.configured) ||
      (keys.odooUrl && keys.odooUrl.configured)
    ));

    // 3. Email connected — any email account (SMTP/OAuth)
    const emailConnected = !!(emailAccounts && emailAccounts.length > 0);

    // 4. Contacts imported — at least one contact/opportunity exists
    const contactsImported = contactsList.length > 0;

    // 5. First campaign created
    const firstCampaign = campaignsList.length > 0;

    // 6. First campaign launched
    const firstLaunch = campaignsList.some(c => c.status === 'active');

    return STEP_CONFIG.map((cfg, i) => ({
      ...cfg,
      done: [accountCreated, crmConnected, emailConnected, contactsImported, firstCampaign, firstLaunch][i],
    }));
  }, [loading, keys, emailAccounts, contactsList, campaignsList]);

  if (loading || !steps || dismissed) return null;
  const doneCount = steps.filter(s => s.done).length;
  const total = steps.length;
  if (doneCount === total) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--blue-bg, #eff6ff) 0%, var(--purple-bg, #f5f3ff) 100%)',
      border: '1px solid rgba(59, 130, 246, 0.15)',
      borderRadius: 12,
      padding: '20px 24px',
      marginBottom: 20,
      animation: 'fadeInUp 0.4s ease-out',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>
            {t('onboarding.title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('onboarding.subtitle', { done: doneCount, total })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Progress ring */}
          <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border, #e5e7eb)" strokeWidth="3" />
              <circle
                cx="22" cy="22" r="18" fill="none"
                stroke="var(--blue, #3b82f6)" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(doneCount / total) * 113.1} 113.1`}
                transform="rotate(-90 22 22)"
                style={{ transition: 'stroke-dasharray 0.5s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'var(--blue, #3b82f6)',
            }}>
              {doneCount}/{total}
            </div>
          </div>
          {/* Dismiss button */}
          <button
            onClick={() => { setDismissed(true); localStorage.setItem('bakal_checklist_dismissed', 'true'); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 16, color: 'var(--text-muted)', padding: 4,
            }}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 6, borderRadius: 3,
        background: 'var(--border, #e5e7eb)',
        marginBottom: 16, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          background: 'var(--blue, #3b82f6)',
          width: `${(doneCount / total) * 100}%`,
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Checklist items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {steps.map((step) => (
          <div
            key={step.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 13,
              color: step.done ? 'var(--success, #22c55e)' : 'var(--text)',
              opacity: step.done ? 0.7 : 1,
              cursor: !step.done && step.route ? 'pointer' : 'default',
            }}
            onClick={() => { if (!step.done && step.route) navigate(step.route); }}
          >
            <span style={{
              width: 20, height: 20, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, flexShrink: 0,
              background: step.done ? 'var(--success, #22c55e)' : 'var(--border, #e5e7eb)',
              color: step.done ? '#fff' : 'var(--text-muted)',
            }}>
              {step.done ? '\u2713' : ' '}
            </span>
            <span style={{ textDecoration: step.done ? 'line-through' : 'none', flex: 1 }}>
              {t(`onboarding.${step.key}`)}
            </span>
            {!step.done && step.route && (
              <span style={{ fontSize: 11, color: 'var(--blue, #3b82f6)', fontWeight: 600 }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        className="btn btn-primary"
        style={{ fontSize: 13, padding: '8px 18px', width: 'fit-content' }}
        onClick={() => {
          const nextStep = steps.find(s => !s.done && s.route);
          navigate(nextStep ? nextStep.route : '/chat');
        }}
      >
        {t('onboarding.continueChat')}
      </button>
    </div>
  );
}
