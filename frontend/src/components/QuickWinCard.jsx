/**
 * Quick Win Card — shown on Dashboard after CRM sync.
 * Surfaces the most actionable insight from CRM data:
 * stagnant deals, churn risk contacts, or a "CRM is clean" congrats.
 * Inspired by Vercel/Stripe "aha moment" pattern.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { useI18n, useT } from '../i18n';

export default function QuickWinCard() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    request('/dashboard/activation').then(d => {
      if (!cancelled) setData(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || dismissed) return null;

  const { segments, topStagnant, topChurnRisk } = data;

  // Don't show if no CRM contacts
  if (!segments || segments.total === 0) return null;

  // Pick the most impactful insight
  let type = null;
  let title = '';
  let desc = '';
  let cta = '';
  let ctaAction = () => {};
  let accent = 'var(--primary)';
  let icon = '';

  if (segments.stagnant > 0) {
    type = 'stagnant';
    const names = topStagnant?.slice(0, 3).map(s => s.company || s.name).join(', ');
    const days = topStagnant?.[0]?.daysSinceUpdate || 30;
    title = en
      ? `${segments.stagnant} stagnant deal${segments.stagnant > 1 ? 's' : ''} found`
      : `${segments.stagnant} deal${segments.stagnant > 1 ? 's' : ''} stagnant${segments.stagnant > 1 ? 's' : ''} detect\u00e9${segments.stagnant > 1 ? 's' : ''}`;
    desc = en
      ? `${names}${topStagnant.length > 3 ? ` +${segments.stagnant - 3} more` : ''} \u2014 inactive for ${days}+ days. A quick follow-up could reactivate them.`
      : `${names}${topStagnant.length > 3 ? ` +${segments.stagnant - 3} autres` : ''} \u2014 inactifs depuis ${days}+ jours. Une relance pourrait les r\u00e9activer.`;
    cta = en ? 'Set up a reactivation trigger' : 'Cr\u00e9er un trigger de relance';
    ctaAction = () => navigate('/activation?tab=triggers&create=deal_stagnant');
    accent = 'var(--warning)';
    icon = '\u26A1';
  } else if (segments.churnRisk > 0) {
    type = 'churn';
    const names = topChurnRisk?.slice(0, 3).map(s => s.company || s.name).join(', ');
    title = en
      ? `${segments.churnRisk} contact${segments.churnRisk > 1 ? 's' : ''} at churn risk`
      : `${segments.churnRisk} contact${segments.churnRisk > 1 ? 's' : ''} \u00e0 risque de churn`;
    desc = en
      ? `${names}${topChurnRisk.length > 3 ? ` +${segments.churnRisk - 3} more` : ''} haven\u2019t been active in 90+ days. Review them before it\u2019s too late.`
      : `${names}${topChurnRisk.length > 3 ? ` +${segments.churnRisk - 3} autres` : ''} inactifs depuis 90+ jours. Agissez avant qu\u2019il ne soit trop tard.`;
    cta = en ? 'View at-risk contacts' : 'Voir les contacts \u00e0 risque';
    ctaAction = () => navigate('/clients?filter=churn_risk');
    accent = 'var(--danger)';
    icon = '\uD83D\uDEA8';
  } else if (segments.total > 0 && segments.stagnant === 0 && segments.churnRisk === 0) {
    type = 'clean';
    title = en ? 'Your CRM is in great shape' : 'Votre CRM est en pleine forme';
    desc = en
      ? `${segments.total} contacts imported, ${segments.active} active, no stagnant deals. You\u2019re on top of your pipeline.`
      : `${segments.total} contacts import\u00e9s, ${segments.active} actifs, aucun deal stagnant. Votre pipeline est bien suivi.`;
    cta = en ? 'Explore analytics' : 'Explorer les analytics';
    ctaAction = () => navigate('/analytics');
    accent = 'var(--success)';
    icon = '\u2705';
  }

  if (!type) return null;

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid var(--border)`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 16,
      animation: 'fadeInUp 0.4s ease-out',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{icon}</span>
            <span>{title}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            {desc}
          </div>
          <button
            onClick={ctaAction}
            style={{
              background: accent,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {cta} &rarr;
          </button>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 16, padding: 4,
            opacity: 0.5,
          }}
          title={en ? 'Dismiss' : 'Fermer'}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
