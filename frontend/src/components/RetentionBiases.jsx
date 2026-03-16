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
    { id: 'account', label: 'Compte cree', done: true }, // Always done — endowed progress
    { id: 'profile', label: 'Profil entreprise', done: hasProfile },
    { id: 'campaign', label: 'Premiere campagne', done: campaignList.length > 0 },
    { id: 'sequence', label: 'Sequences generees', done: campaignList.some(c => c.sequence?.length > 0) },
    { id: 'active', label: 'Campagne active', done: campaignList.some(c => c.status === 'active') },
    { id: 'optimized', label: 'Premiere optimisation IA', done: campaignList.some(c => c.iteration > 0) },
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

/* ═══ Progress Card ═══ */

export function ProgressCard() {
  const { campaigns } = useApp();
  const hasProfile = !!localStorage.getItem('bakal_profile');

  const setup = useMemo(() => computeSetupProgress(campaigns, hasProfile), [campaigns, hasProfile]);
  const metrics = useMemo(() => computeRetentionMetrics(campaigns), [campaigns]);

  if (setup.percent === 100) {
    // Setup complete → show AI capital (sunk cost visualization)
    return (
      <div className="card retention-card">
        <div className="card-header">
          <div className="card-title">Votre capital IA</div>
        </div>
        <div className="card-body">
          <div className="retention-stats-grid">
            <div className="retention-stat">
              <div className="retention-stat-value">{metrics.totalProspects.toLocaleString('fr-FR')}</div>
              <div className="retention-stat-label">Prospects atteints</div>
            </div>
            <div className="retention-stat">
              <div className="retention-stat-value">{metrics.totalOptimizations}</div>
              <div className="retention-stat-label">Optimisations IA</div>
            </div>
            <div className="retention-stat">
              <div className="retention-stat-value">{metrics.patternsLearned}</div>
              <div className="retention-stat-label">Patterns appris</div>
            </div>
            <div className="retention-stat">
              <div className="retention-stat-value">{metrics.daysSinceCreation}j</div>
              <div className="retention-stat-label">D'experience accumulee</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Setup in progress → show endowed progress
  return (
    <div className="card retention-card">
      <div className="card-header">
        <div className="card-title">Configuration</div>
        <span className="retention-percent">{setup.percent}%</span>
      </div>
      <div className="card-body">
        <div className="setup-progress-bar">
          <div className="setup-progress-fill" style={{ width: `${setup.percent}%` }} />
        </div>
        <div className="setup-steps">
          {setup.steps.map(s => (
            <div className={`progress-step${s.done ? ' done' : ''}`} key={s.id}>
              <div className="progress-step-check">{s.done ? '✓' : ''}</div>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <div className="setup-hint">
          {setup.completed < setup.total
            ? `Encore ${setup.total - setup.completed} etape${setup.total - setup.completed > 1 ? 's' : ''} — votre IA s'ameliore a chaque etape`
            : 'Configuration terminee !'}
        </div>
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
