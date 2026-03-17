/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Main dashboard with tabs: Overview, Reports, Analytics, Campaigns, Refinement.
   Migrated from vanilla DOM manipulation in campaigns-data.js / nav.js / pages.js.
   =============================================================================== */

import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/useApp';
import CampaignsList from './CampaignsList';
import AnalyticsSectionFull from './AnalyticsSection';
import VarGenerator from '../components/VarGenerator';
import { ProgressCard, CumulativeValueBanner, BenchmarkBadge } from '../components/RetentionBiases';
import PerformanceChart from '../components/charts/PerformanceChart';
import { exportCampaignsCsv, exportReportPdf } from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';

const TABS = [
  { key: 'overview', label: 'Vue globale' },
  { key: 'reports', label: 'Rapports' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'campaigns', label: 'Campagnes' },
  { key: 'refinement', label: 'Refinement' },
];

const KPI_LABELS = {
  contacts: '📤 Contacts atteints',
  openRate: "📬 Taux d'ouverture",
  replyRate: '💬 Taux de réponse',
  interested: '🔥 Prospects intéressés',
  meetings: '📅 RDV qualifiés',
  stops: '🚫 Stops',
};

export default function DashboardPage({ section, onNavigateCampaign }) {
  const { campaigns, globalKpis, opportunities, recommendations, reports, chartData } = useApp();
  const [tab, setTab] = useState(section || 'overview');

  // Sync tab when `section` prop changes — derive from props directly
  const currentTab = section || tab;

  const campaignsList = useMemo(() => Object.values(campaigns), [campaigns]);
  const isEmpty = campaignsList.length === 0;
  const activeCount = useMemo(
    () => campaignsList.filter((c) => c.status === 'active').length,
    [campaignsList]
  );

  /* ── Subtitle ── */
  const subtitle = isEmpty
    ? 'Bienvenue — Configurez votre premiere campagne'
    : (() => {
        const today = new Date();
        const weekStr =
          'Semaine du ' +
          today.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
        return `${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} · ${weekStr}`;
      })();

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">
            {!isEmpty && <span className="pulse-dot"></span>}
            &nbsp;&nbsp;{subtitle}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${currentTab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {currentTab === 'overview' && (
        <OverviewSection
          isEmpty={isEmpty}
          globalKpis={globalKpis}
          campaigns={campaignsList}
          opportunities={opportunities}
          recommendations={recommendations}
          chartData={chartData}
          onShowCampaigns={() => setTab('campaigns')}
        />
      )}

      {currentTab === 'reports' && <ReportsSection isEmpty={isEmpty} reports={reports} />}

      {currentTab === 'analytics' && <AnalyticsSectionFull onNavigate={(tab) => setTab(tab)} />}

      {currentTab === 'campaigns' && (
        <CampaignsList onNavigateCampaign={onNavigateCampaign} />
      )}

      {currentTab === 'refinement' && <RefinementSection isEmpty={isEmpty} />}
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Overview Section
   ═══════════════════════════════════════════════════ */

function OverviewSection({ isEmpty, globalKpis, campaigns, opportunities, recommendations, chartData, onShowCampaigns }) {
  if (isEmpty) {
    return (
      <div id="section-overview">
        <WelcomeBanner />
        <EmptyKpis />
        <EmptyOverviewGrid />
      </div>
    );
  }

  return (
    <div id="section-overview">
      {/* KPI Grid */}
      <div className="kpi-grid">
        {Object.entries(globalKpis).map(([key, k]) => (
          <div className="kpi-card" key={key}>
            <div className="kpi-label">{KPI_LABELS[key] || key}</div>
            <div className="kpi-value">{k.value}</div>
            <div className={`kpi-trend ${k.direction === 'up' ? 'up' : ''}`}>
              {k.trend}
            </div>
          </div>
        ))}
      </div>

      {/* Retention: Cumulative value banner + benchmark */}
      <CumulativeValueBanner />
      <BenchmarkBadge />

      {/* Section grid */}
      <div className="section-grid">
        {/* Retention: Progress / AI capital card */}
        <ProgressCard />

        {/* Campaigns table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Campagnes actives</div>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '12px' }}
              onClick={onShowCampaigns}
            >
              Voir tout →
            </button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <CampaignsTable campaigns={campaigns} />
          </div>
        </div>

        {/* Performance chart — recharts */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Performance 4 semaines</div>
          </div>
          <div className="card-body">
            <PerformanceChart data={chartData} />
          </div>
        </div>

        {/* Opportunities */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">🔥 Opportunites recentes</div>
          </div>
          <div className="card-body" style={{ padding: '16px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {opportunities && opportunities.length > 0 ? (
                opportunities.map((opp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < opportunities.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{opp.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{opp.title} · {opp.company} · {opp.size}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: opp.statusColor, background: opp.statusBg, padding: '2px 8px', borderRadius: '4px' }}>{opp.status}</span>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{opp.timing}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                  Les opportunites s'afficheront ici.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">💡 Recommandations Claude</div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recommendations && recommendations.length > 0 ? (
                recommendations.map((rec, i) => (
                  <div key={i} className={`alert alert-${rec.level}`} style={{ padding: '12px 16px', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{rec.label}</div>
                    <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(rec.text) }} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                  Les recommandations IA s'afficheront ici.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══ Campaigns Table (overview summary) ═══ */

function CampaignsTable({ campaigns }) {
  const activeCampaigns = campaigns.filter(
    (c) => c.status === 'active' || c.status === 'prep'
  );

  return (
    <table className="campaign-table">
      <thead>
        <tr>
          <th>Campagne</th>
          <th>Canal</th>
          <th>Statut</th>
          <th>Ouvertures</th>
          <th>Reponses</th>
          <th>RDV</th>
        </tr>
      </thead>
      <tbody>
        {activeCampaigns.map((c) => (
          <CampaignTableRow key={c.id} campaign={c} />
        ))}
      </tbody>
    </table>
  );
}

function CampaignTableRow({ campaign: c }) {
  const isPrep = c.status === 'prep';
  const isLinkedin = c.channel === 'linkedin';

  const statusHtml = c.status === 'active' ? (
    <span className="status-badge status-active">
      <span className="pulse-dot" style={{ width: 6, height: 6 }}></span>{' '}
      Active
    </span>
  ) : (
    <span className="status-badge status-prep">⏳ En preparation</span>
  );

  let openContent, replyContent, meetingsContent;

  if (isPrep) {
    openContent = (
      <div style={{ color: 'var(--text-muted)' }}>—</div>
    );
    replyContent = (
      <div style={{ color: 'var(--text-muted)' }}>—</div>
    );
    meetingsContent = (
      <div style={{ color: 'var(--text-muted)' }}>—</div>
    );
  } else if (isLinkedin) {
    openContent = (
      <>
        <div style={{ fontWeight: 600 }}>—</div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          N/A LinkedIn
        </div>
      </>
    );
    const replyPct = Math.min((c.kpis?.replyRate || 0) * 10, 100);
    replyContent = (
      <>
        <div style={{ fontWeight: 600 }}>{c.kpis?.replyRate}%</div>
        <div className="perf-bar">
          <div
            className={`perf-fill ${c.kpis?.replyRate >= 8 ? 'perf-good' : 'perf-ok'}`}
            style={{ width: `${replyPct}%` }}
          ></div>
        </div>
      </>
    );
    meetingsContent = (
      <span style={{ fontWeight: 700, color: 'var(--success)' }}>
        {c.kpis?.meetings}
      </span>
    );
  } else {
    const openColor =
      c.kpis?.openRate >= 50 ? 'perf-good' : 'perf-ok';
    openContent = (
      <>
        <div style={{ fontWeight: 600 }}>{c.kpis?.openRate}%</div>
        <div className="perf-bar">
          <div
            className={`perf-fill ${openColor}`}
            style={{ width: `${c.kpis?.openRate}%` }}
          ></div>
        </div>
      </>
    );
    const replyPct = Math.min((c.kpis?.replyRate || 0) * 10, 100);
    replyContent = (
      <>
        <div style={{ fontWeight: 600 }}>{c.kpis?.replyRate}%</div>
        <div className="perf-bar">
          <div
            className={`perf-fill ${c.kpis?.replyRate >= 8 ? 'perf-good' : 'perf-ok'}`}
            style={{ width: `${replyPct}%` }}
          ></div>
        </div>
      </>
    );
    meetingsContent = (
      <span style={{ fontWeight: 700, color: 'var(--success)' }}>
        {c.kpis?.meetings}
      </span>
    );
  }

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 600 }}>{c.name}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {c.sectorShort} &middot; {c.size} &middot; {c.angle}
        </div>
      </td>
      <td>
        <span style={{ color: c.channelColor }}>{c.channelLabel}</span>
      </td>
      <td>{statusHtml}</td>
      <td>{openContent}</td>
      <td>{replyContent}</td>
      <td>{meetingsContent}</td>
    </tr>
  );
}


/* ═══════════════════════════════════════════════════
   Empty States
   ═══════════════════════════════════════════════════ */

function WelcomeBanner() {
  return (
    <div className="welcome-banner">
      <div className="welcome-title">Bienvenue sur Bakal</div>
      <div className="welcome-subtitle">
        Votre plateforme de prospection intelligente est prete. Suivez ces etapes
        pour lancer votre premiere campagne et commencer a generer des RDV
        qualifies.
      </div>
      <div className="onboarding-steps">
        <div className="onboarding-step step-active">
          <div className="onboarding-step-number">1</div>
          <div className="onboarding-step-title">Creez votre campagne</div>
          <div className="onboarding-step-desc">
            Definissez votre cible, votre canal (Email, LinkedIn ou les deux) et
            votre angle d'approche.
          </div>
          <button className="btn btn-primary">Creer ma campagne</button>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">2</div>
          <div className="onboarding-step-title">
            Claude genere vos sequences
          </div>
          <div className="onboarding-step-desc">
            L'IA redige des messages personnalises et adaptes a votre cible et
            votre secteur.
          </div>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">3</div>
          <div className="onboarding-step-title">
            Importez vos prospects
          </div>
          <div className="onboarding-step-desc">
            Ajoutez votre liste de contacts ou laissez-nous la constituer pour
            vous.
          </div>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">4</div>
          <div className="onboarding-step-title">Lancez et optimisez</div>
          <div className="onboarding-step-desc">
            Bakal analyse les performances et optimise automatiquement vos
            messages.
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyKpis() {
  const items = [
    { label: '📤 Contacts atteints' },
    { label: "📬 Taux d'ouverture" },
    { label: '💬 Taux de reponse' },
    { label: '🔥 Prospects interesses' },
    { label: '📅 RDV qualifies' },
    { label: '🚫 Stops' },
  ];

  return (
    <div className="kpi-grid">
      {items.map((k, i) => (
        <div className="kpi-card" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value" style={{ color: 'var(--text-muted)' }}>
            —
          </div>
          <div className="kpi-trend" style={{ color: 'var(--text-muted)' }}>
            En attente de donnees
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyOverviewGrid() {
  return (
    <div className="section-grid">
      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">🎯 Campagnes actives</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">📭</div>
          <div className="empty-text">
            Aucune campagne pour le moment. Creez votre premiere campagne pour
            voir vos performances ici.
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: '16px', fontSize: '13px' }}
          >
            Creer une campagne
          </button>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">📈 Performance 4 semaines</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">📊</div>
          <div className="empty-text">
            Les graphiques de performance apparaitront des que votre premiere
            campagne sera active.
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">🔥 Opportunites recentes</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">💎</div>
          <div className="empty-text">
            Les prospects interesses et les RDV planifies s'afficheront ici au
            fil des reponses.
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">💡 Recommandations Claude</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">🤖</div>
          <div className="empty-text">
            Claude analysera vos campagnes et proposera des optimisations des
            qu'il aura suffisamment de donnees (&gt;50 prospects, &gt;7 jours).
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Reports Section
   ═══════════════════════════════════════════════════ */

function ReportsSection({ isEmpty, reports }) {
  if (isEmpty || !reports || reports.length === 0) {
    return (
      <div id="section-reports">
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">Aucun rapport disponible</div>
          <div className="empty-state-desc">
            Les rapports hebdomadaires sont generes automatiquement chaque lundi.
            Lancez votre premiere campagne pour recevoir votre premier bilan de
            performance.
          </div>
          <button className="btn btn-primary">
            Creer ma premiere campagne
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="section-reports">
      {/* Export buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={exportCampaignsCsv}
        >
          Exporter CSV
        </button>
        <button
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={exportReportPdf}
        >
          Rapport PDF
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {reports.map((r, i) => (
          <div className="card" key={i}>
            <div className="card-header">
              <div>
                <div className="card-title">{r.week}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.dateRange}</div>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.scoreLabel}</span>
            </div>
            <div className="card-body">
              {/* Mini KPIs */}
              <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Contacts:</span> <strong>{r.metrics.contacts}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Ouverture:</span> <strong>{r.metrics.openRate}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Reponse:</span> <strong>{r.metrics.replyRate}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Interesses:</span> <strong>{r.metrics.interested}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>RDV:</span> <strong>{r.metrics.meetings}</strong></div>
              </div>
              {/* Synthesis */}
              <div style={{ fontSize: '13px', lineHeight: '1.6' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.synthesis) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Refinement Section
   ═══════════════════════════════════════════════════ */

function RefinementSection({ isEmpty }) {
  const handleAcceptVariable = useCallback((key, varData) => {
    // Future: integrate with VariableManager registry or backend
    console.log('Variable accepted:', key, varData);
  }, []);

  const handleAcceptAll = useCallback((scenarioKey, chain) => {
    console.log('All variables accepted for scenario:', scenarioKey, chain.length, 'variables');
  }, []);

  if (isEmpty) {
    return (
      <div id="section-refinement">
        <div className="empty-state">
          <div className="empty-state-icon">🧬</div>
          <div className="empty-state-title">
            Refinement A/B non disponible
          </div>
          <div className="empty-state-desc">
            Le systeme de test A/B et d'optimisation s'active apres la premiere
            semaine de campagne active, avec au moins 50 prospects contactes.
          </div>
          <button className="btn btn-ghost">Retour au dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div id="section-refinement">
      <VarGenerator
        onAcceptVariable={handleAcceptVariable}
        onAcceptAll={handleAcceptAll}
      />
    </div>
  );
}
