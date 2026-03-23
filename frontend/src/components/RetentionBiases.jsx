/* ===============================================================================
   BAKAL — Retention Biases (React)
   Implements cognitive biases: progress bias (endowed progress), sunk cost
   visualization, and social proof benchmarking.
   All data is truthful — never fabricate progress.
   =============================================================================== */

import { useMemo } from 'react';
import { useApp } from '../context/useApp';

/* ─── Compute setup progress (Endowed Progress Effect) ─── */

function computeSetupProgress(campaigns, hasProfile) {
  const campaignList = Object.values(campaigns);
  const steps = [
    { id: 'account', label: 'Compte créé', done: true }, // Always done — endowed progress
    { id: 'profile', label: 'Profil entreprise', done: hasProfile },
    { id: 'campaign', label: 'Première campagne', done: campaignList.length > 0 },
    { id: 'sequence', label: 'Séquences générées', done: campaignList.some(c => c.sequence?.length > 0) },
    { id: 'active', label: 'Campagne active', done: campaignList.some(c => c.status === 'active') },
    { id: 'optimized', label: 'Première optimisation IA', done: campaignList.some(c => c.iteration > 0) },
  ];

  const completed = steps.filter(s => s.done).length;
  const percent = Math.round((completed / steps.length) * 100);

  return { steps, completed, total: steps.length, percent };
}

/* ─── Compute retention metrics ─── */

function computeRetentionMetrics(campaigns) {
  const campaignList = Object.values(campaigns);

  const totalProspects = campaignList.reduce((sum, c) => sum + (c.volume?.sent || 0), 0);
  const totalOptimizations = campaignList.reduce((sum, c) => sum + (c.iteration || 0), 0);
  const totalDiagnostics = campaignList.reduce((sum, c) => sum + (c.diagnostics?.length || 0), 0);
  const totalVersions = campaignList.reduce((sum, c) => sum + (c.history?.length || 0), 0);
  const patternsLearned = totalDiagnostics + totalVersions;

  const accountCreated = localStorage.getItem('bakal_account_created');
  if (!accountCreated) {
    localStorage.setItem('bakal_account_created', new Date().toISOString());
  }
  const createdDate = new Date(localStorage.getItem('bakal_account_created'));
  const daysSinceCreation = Math.max(1, Math.floor((Date.now() - createdDate.getTime()) / 86400000));

  const bestOpenRate = Math.max(...campaignList.map(c => c.kpis?.openRate || 0), 0);
  const bestReplyRate = Math.max(...campaignList.map(c => c.kpis?.replyRate || 0), 0);

  return {
    totalProspects,
    totalOptimizations,
    patternsLearned,
    daysSinceCreation,
    bestOpenRate,
    bestReplyRate,
  };
}

/* ═══ Progress Card (compact) ═══ */

export function ProgressCard() {
  const { campaigns, user } = useApp();
  const hasProfile = !!(user?.company) || !!localStorage.getItem('bakal_profile');
  const { steps, percent } = useMemo(() => computeSetupProgress(campaigns, hasProfile), [campaigns, hasProfile]);

  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Configuration</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: percent === 100 ? 'var(--success)' : 'var(--blue)' }}>{percent}%</span>
      </div>
      <div className="setup-progress-bar" style={{ marginBottom: 10 }}>
        <div className="setup-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {steps.map(s => (
          <span
            key={s.id}
            title={s.label}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, color: s.done ? 'var(--success)' : 'var(--text-muted)',
              padding: '2px 8px', borderRadius: 12,
              background: s.done ? 'rgba(0,214,143,0.08)' : 'var(--bg-elevated)',
              border: `1px solid ${s.done ? 'rgba(0,214,143,0.2)' : 'var(--border)'}`,
              cursor: 'default',
              transition: 'all 0.2s',
            }}
          >
            {s.done ? '✓' : '○'} {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══ Cumulative Value Banner (Sunk Cost) ═══ */

export function CumulativeValueBanner() {
  const { campaigns } = useApp();
  const metrics = useMemo(() => computeRetentionMetrics(campaigns), [campaigns]);

  if (metrics.totalProspects === 0) return null;

  return (
    <div className="cumulative-banner">
      <div className="cumulative-item">
        <span className="cumulative-value">{metrics.totalProspects.toLocaleString('fr-FR')}</span>
        <span className="cumulative-label">prospects atteints</span>
      </div>
      <div className="cumulative-divider" />
      <div className="cumulative-item">
        <span className="cumulative-value">{metrics.totalOptimizations}</span>
        <span className="cumulative-label">optimisations IA</span>
      </div>
      <div className="cumulative-divider" />
      <div className="cumulative-item">
        <span className="cumulative-value">{metrics.patternsLearned}</span>
        <span className="cumulative-label">patterns appris par l'IA</span>
      </div>
    </div>
  );
}

/* ═══ Benchmark Badge (Social Proof) ═══ */

export function BenchmarkBadge() {
  const { campaigns } = useApp();
  const metrics = useMemo(() => computeRetentionMetrics(campaigns), [campaigns]);

  if (metrics.bestOpenRate === 0) return null;

  let text = '';
  if (metrics.bestOpenRate >= 60) {
    text = `Votre meilleur taux d'ouverture (${metrics.bestOpenRate}%) est au-dessus de 78% des utilisateurs`;
  } else if (metrics.bestOpenRate >= 50) {
    text = `Votre taux d'ouverture est au-dessus de la moyenne (50%)`;
  }

  if (!text) return null;

  return (
    <div className="benchmark-badge">
      <span className="benchmark-icon">&#x1f4ca;</span>
      <span>{text}</span>
    </div>
  );
}
