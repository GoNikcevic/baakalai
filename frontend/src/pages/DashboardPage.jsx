/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Main dashboard with tabs: Overview, Reports, Analytics, Campaigns, Refinement.
   Migrated from vanilla DOM manipulation in campaigns-data.js / nav.js / pages.js.
   =============================================================================== */

import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import CampaignsList from './CampaignsList';

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
  const { campaigns, globalKpis, projects } = useApp();
  const [tab, setTab] = useState(section || 'overview');

  // Sync tab when `section` prop changes (e.g. from sidebar navigation)
  useEffect(() => {
    if (section) setTab(section);
  }, [section]);

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
        return `${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} \u00B7 ${weekStr}`;
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
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewSection
          isEmpty={isEmpty}
          globalKpis={globalKpis}
          campaigns={campaignsList}
          onShowCampaigns={() => setTab('campaigns')}
        />
      )}

      {tab === 'reports' && <ReportsSection isEmpty={isEmpty} />}

      {tab === 'analytics' && <AnalyticsSection isEmpty={isEmpty} />}

      {tab === 'campaigns' && (
        <CampaignsList onNavigateCampaign={onNavigateCampaign} />
      )}

      {tab === 'refinement' && <RefinementSection isEmpty={isEmpty} />}
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Overview Section
   ═══════════════════════════════════════════════════ */

function OverviewSection({ isEmpty, globalKpis, campaigns, onShowCampaigns }) {
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

      {/* Section grid */}
      <div className="section-grid">
        {/* Campaigns table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">🎯 Campagnes actives</div>
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

        {/* Performance chart placeholder */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">📈 Performance 4 semaines</div>
          </div>
          <div className="card-body">
            <div className="chart-container">
              <div className="chart-bars">
                {/* Chart bars would be rendered here from chartData */}
              </div>
            </div>
            <div className="chart-legend">
              <div className="chart-legend-item">
                <div
                  className="chart-legend-dot"
                  style={{ background: 'var(--blue)' }}
                ></div>{' '}
                Email
              </div>
              <div className="chart-legend-item">
                <div
                  className="chart-legend-dot"
                  style={{ background: 'var(--purple)' }}
                ></div>{' '}
                LinkedIn
              </div>
            </div>
          </div>
        </div>

        {/* Opportunities */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">🔥 Opportunites recentes</div>
          </div>
          <div className="card-body" style={{ padding: '16px 24px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '24px 0',
                }}
              >
                Les opportunites s'afficheront ici.
              </div>
            </div>
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">💡 Recommandations Claude</div>
          </div>
          <div className="card-body">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '24px 0',
                }}
              >
                Les recommandations IA s'afficheront ici.
              </div>
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

function ReportsSection({ isEmpty }) {
  if (isEmpty) {
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
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: '48px 0',
        }}
      >
        Les rapports seront affiches ici une fois les donnees disponibles.
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Analytics Section
   ═══════════════════════════════════════════════════ */

function AnalyticsSection({ isEmpty }) {
  if (isEmpty) {
    return (
      <div id="section-analytics">
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">Analytics non disponible</div>
          <div className="empty-state-desc">
            Les analytics detailles apparaitront apres le lancement de votre
            premiere campagne.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="section-analytics">
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: '48px 0',
        }}
      >
        Le module analytics sera rendu ici.
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Refinement Section
   ═══════════════════════════════════════════════════ */

function RefinementSection({ isEmpty }) {
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
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: '48px 0',
        }}
      >
        Le module Refinement A/B sera rendu ici.
      </div>
    </div>
  );
}
