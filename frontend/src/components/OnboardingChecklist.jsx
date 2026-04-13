/* ===============================================================================
   BAKAL — Onboarding Checklist Component
   Shows a progress card on the dashboard for new users.
   Points them to the chat for conversational onboarding.
   =============================================================================== */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT } from '../i18n';
import { request } from '../services/api-client';

/**
 * OnboardingChecklist — renders a small card/banner for new users.
 * Checks: profile filled, Lemlist connected, first campaign, prospects added, first launch.
 * Disappears once all 5 steps are done.
 */
export default function OnboardingChecklist() {
  const t = useT();
  const navigate = useNavigate();
  const { campaigns } = useApp();

  const [userProfile, setUserProfile] = useState(null);
  const [keys, setKeys] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile + integration keys on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [profileRes, keysRes] = await Promise.all([
          request('/profile'),
          request('/settings/keys'),
        ]);
        if (!cancelled) {
          setUserProfile(profileRes.profile || null);
          setKeys(keysRes.keys || keysRes);
        }
      } catch {
        // Silently ignore — checklist just won't show
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Compute checklist steps
  const campaignsList = useMemo(() => Object.values(campaigns || {}), [campaigns]);

  const steps = useMemo(() => {
    if (loading) return null;

    const profileFilled = !!(userProfile && userProfile.company && (userProfile.sector || userProfile.description));
    const lemlistConnected = !!(keys && keys.lemlistKey && keys.lemlistKey.configured);
    const firstCampaign = campaignsList.length > 0;
    const prospectsAdded = campaignsList.some(c => (c.nbProspects || c.nb_prospects || 0) > 0);
    const firstLaunch = campaignsList.some(c => c.status === 'active');

    return [
      { key: 'profileFilled', done: profileFilled },
      { key: 'lemlistConnected', done: lemlistConnected },
      { key: 'firstCampaign', done: firstCampaign },
      { key: 'prospectsAdded', done: prospectsAdded },
      { key: 'firstLaunch', done: firstLaunch },
    ];
  }, [loading, userProfile, keys, campaignsList]);

  // Don't render while loading, if data failed, or if all steps are done
  if (loading || !steps) return null;
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
          <div key={step.key} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 13,
            color: step.done ? 'var(--success, #22c55e)' : 'var(--text)',
            opacity: step.done ? 0.7 : 1,
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, flexShrink: 0,
              background: step.done ? 'var(--success, #22c55e)' : 'var(--border, #e5e7eb)',
              color: step.done ? '#fff' : 'var(--text-muted)',
            }}>
              {step.done ? '\u2713' : ' '}
            </span>
            <span style={{ textDecoration: step.done ? 'line-through' : 'none' }}>
              {t(`onboarding.${step.key}`)}
            </span>
          </div>
        ))}
      </div>

      {/* CTA button */}
      <button
        className="btn btn-primary"
        style={{ fontSize: 13, padding: '8px 18px', width: 'fit-content' }}
        onClick={() => navigate('/chat')}
      >
        {t('onboarding.continueChat')}
      </button>
    </div>
  );
}
