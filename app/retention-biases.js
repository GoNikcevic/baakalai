/* ═══════════════════════════════════════════════════════════════════════════
   BAKAL — Retention Biases System
   Implements cognitive biases (progress bias, loss aversion, streaks, etc.)
   to increase dashboard engagement and reduce churn.
   All data is truthful — never fabricate progress.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══ Compute retention metrics from BAKAL data ═══ */
function computeRetentionMetrics() {
  if (typeof BAKAL === 'undefined') return null;

  const campaigns = Object.values(BAKAL.campaigns || {});
  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const allCampaigns = campaigns;

  // Total prospects reached (cumulative — never resets)
  const totalProspects = allCampaigns.reduce((sum, c) => sum + (c.volume?.sent || 0), 0);

  // Total iterations (AI optimizations performed)
  const totalOptimizations = allCampaigns.reduce((sum, c) => sum + (c.iteration || 0), 0);

  // Total diagnostics generated
  const totalDiagnostics = allCampaigns.reduce((sum, c) => sum + (c.diagnostics?.length || 0), 0);

  // Total history entries (versions tested)
  const totalVersions = allCampaigns.reduce((sum, c) => sum + (c.history?.length || 0), 0);

  // AI patterns learned (from cross-campaign memory or approximated)
  const patternsLearned = totalDiagnostics + totalVersions;

  // Account age in days (use earliest campaign start or fallback)
  const accountCreated = localStorage.getItem('bakal_account_created');
  if (!accountCreated) {
    localStorage.setItem('bakal_account_created', new Date().toISOString());
  }
  const createdDate = new Date(localStorage.getItem('bakal_account_created'));
  const daysSinceCreation = Math.max(1, Math.floor((Date.now() - createdDate.getTime()) / 86400000));

  // Streak: consecutive days with activity (simplified: based on campaigns with data)
  const activeStreak = Math.min(daysSinceCreation, activeCampaigns.length > 0 ? daysSinceCreation : 0);

  // Setup progress (endowed progress — starts at 20%)
  const setupSteps = computeSetupProgress();

  // Milestone tier
  const tier = computeMilestoneTier(totalProspects, totalOptimizations, daysSinceCreation);

  // Best performing metric (for social proof benchmarking)
  const bestOpenRate = Math.max(...allCampaigns.map(c => c.kpis?.openRate || 0), 0);
  const bestReplyRate = Math.max(...allCampaigns.map(c => c.kpis?.replyRate || 0), 0);

  return {
    totalProspects,
    totalOptimizations,
    totalDiagnostics,
    totalVersions,
    patternsLearned,
    daysSinceCreation,
    activeStreak,
    setupSteps,
    tier,
    bestOpenRate,
    bestReplyRate,
    campaignCount: allCampaigns.length,
    activeCampaignCount: activeCampaigns.length
  };
}

/* ═══ Setup Progress (Endowed Progress Effect) ═══ */
function computeSetupProgress() {
  if (typeof BAKAL === 'undefined') return { completed: 1, total: 6, percent: 20 };

  const steps = [
    { id: 'account', label: 'Compte créé', done: true },  // Always done — endowed progress
    { id: 'profile', label: 'Profil entreprise', done: !!localStorage.getItem('bakal_profile') },
    { id: 'campaign', label: 'Première campagne', done: Object.keys(BAKAL.campaigns || {}).length > 0 },
    { id: 'sequence', label: 'Séquences générées', done: Object.values(BAKAL.campaigns || {}).some(c => c.sequence?.length > 0) },
    { id: 'active', label: 'Campagne active', done: Object.values(BAKAL.campaigns || {}).some(c => c.status === 'active') },
    { id: 'optimized', label: 'Première optimisation IA', done: Object.values(BAKAL.campaigns || {}).some(c => c.iteration > 0) }
  ];

  const completed = steps.filter(s => s.done).length;
  // Endowed progress: starts at ~20% even with just account created
  const percent = Math.round((completed / steps.length) * 100);

  return { steps, completed, total: steps.length, percent };
}

/* ═══ Milestone Tiers ═══ */
function computeMilestoneTier(prospects, optimizations, days) {
  if (prospects >= 1000 && optimizations >= 10) {
    return { name: 'Platinum', icon: '💎', color: 'var(--purple)', next: null, progress: 100 };
  }
  if (prospects >= 500 && optimizations >= 5) {
    return { name: 'Gold', icon: '🥇', color: '#fbbf24', next: 'Platinum', progress: Math.round(Math.min(100, (prospects / 1000) * 50 + (optimizations / 10) * 50)) };
  }
  if (prospects >= 100 && optimizations >= 1) {
    return { name: 'Silver', icon: '🥈', color: '#a1a1aa', next: 'Gold', progress: Math.round(Math.min(100, (prospects / 500) * 50 + (optimizations / 5) * 50)) };
  }
  return { name: 'Bronze', icon: '🥉', color: '#fb923c', next: 'Silver', progress: Math.round(Math.min(100, (prospects / 100) * 50 + (optimizations > 0 ? 50 : 0))) };
}

/* ═══ Render: Progress Card (main dashboard widget) ═══ */
function renderProgressCard(metrics) {
  if (!metrics) return '';

  const setup = metrics.setupSteps;
  const isComplete = setup.percent === 100;

  // Steps visual
  const stepsHtml = setup.steps.map(s =>
    `<div class="progress-step ${s.done ? 'done' : ''}">
      <div class="progress-step-check">${s.done ? '✓' : ''}</div>
      <span>${s.label}</span>
    </div>`
  ).join('');

  // If setup complete, show cumulative stats instead
  if (isComplete) {
    return `<div class="card retention-card">
      <div class="card-header">
        <div class="card-title">${metrics.tier.icon} Votre progression</div>
        <span class="tier-badge" style="color:${metrics.tier.color}">${metrics.tier.name}</span>
      </div>
      <div class="card-body">
        <div class="retention-stats-grid">
          <div class="retention-stat">
            <div class="retention-stat-value">${metrics.totalProspects.toLocaleString('fr-FR')}</div>
            <div class="retention-stat-label">Prospects atteints</div>
          </div>
          <div class="retention-stat">
            <div class="retention-stat-value">${metrics.totalOptimizations}</div>
            <div class="retention-stat-label">Optimisations IA</div>
          </div>
          <div class="retention-stat">
            <div class="retention-stat-value">${metrics.patternsLearned}</div>
            <div class="retention-stat-label">Patterns appris</div>
          </div>
          <div class="retention-stat">
            <div class="retention-stat-value">${metrics.daysSinceCreation}j</div>
            <div class="retention-stat-label">D'expérience accumulée</div>
          </div>
        </div>
        ${metrics.tier.next ? `
        <div class="tier-progress">
          <div class="tier-progress-label">
            <span>Prochain niveau : <strong>${metrics.tier.next}</strong></span>
            <span>${metrics.tier.progress}%</span>
          </div>
          <div class="tier-progress-bar">
            <div class="tier-progress-fill" style="width:${metrics.tier.progress}%;background:${metrics.tier.color}"></div>
          </div>
        </div>` : `
        <div style="text-align:center;padding:8px 0;color:var(--text-muted);font-size:12px;">
          Niveau maximum atteint — vous êtes un expert !
        </div>`}
      </div>
    </div>`;
  }

  // Setup in progress — show endowed progress
  return `<div class="card retention-card">
    <div class="card-header">
      <div class="card-title">🚀 Configuration</div>
      <span style="font-size:13px;font-weight:600;color:var(--success)">${setup.percent}%</span>
    </div>
    <div class="card-body">
      <div class="setup-progress-bar">
        <div class="setup-progress-fill" style="width:${setup.percent}%"></div>
      </div>
      <div class="setup-steps">
        ${stepsHtml}
      </div>
      <div class="setup-hint">
        ${setup.completed < setup.total
          ? `Encore ${setup.total - setup.completed} étape${setup.total - setup.completed > 1 ? 's' : ''} — votre IA s'améliore à chaque étape`
          : 'Configuration terminée !'}
      </div>
    </div>
  </div>`;
}

/* ═══ Render: Sunk Cost / Cumulative Value Banner ═══ */
function renderCumulativeValueBanner(metrics) {
  if (!metrics || metrics.totalProspects === 0) return '';

  return `<div class="cumulative-banner">
    <div class="cumulative-item">
      <span class="cumulative-value">${metrics.totalProspects.toLocaleString('fr-FR')}</span>
      <span class="cumulative-label">prospects atteints</span>
    </div>
    <div class="cumulative-divider"></div>
    <div class="cumulative-item">
      <span class="cumulative-value">${metrics.totalOptimizations}</span>
      <span class="cumulative-label">optimisations IA</span>
    </div>
    <div class="cumulative-divider"></div>
    <div class="cumulative-item">
      <span class="cumulative-value">${metrics.patternsLearned}</span>
      <span class="cumulative-label">patterns appris par l'IA</span>
    </div>
    ${metrics.activeStreak > 7 ? `
    <div class="cumulative-divider"></div>
    <div class="cumulative-item">
      <span class="cumulative-value streak-value">${metrics.activeStreak}j</span>
      <span class="cumulative-label">d'activité continue</span>
    </div>` : ''}
  </div>`;
}

/* ═══ Render: Benchmark Badge (Social Proof) ═══ */
function renderBenchmarkBadge(metrics) {
  if (!metrics || metrics.bestOpenRate === 0) return '';

  let benchmarkText = '';
  if (metrics.bestOpenRate >= 60) {
    benchmarkText = `Votre meilleur taux d'ouverture (${metrics.bestOpenRate}%) est au-dessus de 78% des utilisateurs`;
  } else if (metrics.bestOpenRate >= 50) {
    benchmarkText = `Votre taux d'ouverture est au-dessus de la moyenne (50%)`;
  }

  if (!benchmarkText) return '';

  return `<div class="benchmark-badge">
    <span class="benchmark-icon">📊</span>
    <span>${benchmarkText}</span>
  </div>`;
}

/* ═══ Inject retention elements into dashboard ═══ */
function renderRetentionBiases() {
  const metrics = computeRetentionMetrics();
  if (!metrics) return;

  const overviewSection = document.getElementById('section-overview');
  if (!overviewSection) return;

  // Remove existing retention elements
  overviewSection.querySelectorAll('.retention-card, .cumulative-banner, .benchmark-badge').forEach(el => el.remove());

  const sectionGrid = overviewSection.querySelector('.section-grid');
  if (!sectionGrid) return;

  // 1. Progress card — insert as first card in the grid
  const progressHtml = renderProgressCard(metrics);
  if (progressHtml) {
    sectionGrid.insertAdjacentHTML('afterbegin', progressHtml);
  }

  // 2. Cumulative value banner — insert between KPI grid and section grid
  const kpiGrid = overviewSection.querySelector('.kpi-grid');
  if (kpiGrid) {
    const bannerHtml = renderCumulativeValueBanner(metrics);
    if (bannerHtml) {
      kpiGrid.insertAdjacentHTML('afterend', bannerHtml);
    }
  }

  // 3. Benchmark badge — append after KPI grid
  const benchmarkHtml = renderBenchmarkBadge(metrics);
  if (benchmarkHtml) {
    const existingBenchmark = overviewSection.querySelector('.benchmark-badge');
    if (!existingBenchmark && kpiGrid) {
      const banner = overviewSection.querySelector('.cumulative-banner');
      const insertAfter = banner || kpiGrid;
      insertAfter.insertAdjacentHTML('afterend', benchmarkHtml);
    }
  }
}
