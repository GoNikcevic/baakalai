/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Overview-only dashboard: KPIs, campaigns table, opportunities, chart,
   recommendations with link to full recos page.
   =============================================================================== */

import { useMemo, useCallback, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { DEMO_DATA } from '../data/demo-data';
import { ProgressCard, CumulativeValueBanner, BenchmarkBadge } from '../components/RetentionBiases';
import PerformanceChart from '../components/charts/PerformanceChart';
import { sanitizeHtml } from '../services/sanitize';
import ScoreBadge from '../components/ScoreBadge';
import { scoreLeads, exportScoresToCRM, downloadScoresCSV } from '../services/api-client';

const KPI_LABELS = {
  contacts: '\u{1F4E4} Contacts atteints',
  openRate: "\u{1F4EC} Taux d'ouverture",
  replyRate: '\u{1F4AC} Taux de r\u00e9ponse',
  interested: '\u{1F525} Prospects int\u00e9ress\u00e9s',
  meetings: '\u{1F4C5} RDV qualifi\u00e9s',
  stops: '\u{1F6AB} Stops',
};

export default function DashboardPage() {
  const { campaigns, globalKpis, opportunities, recommendations, chartData, setOpportunities } = useApp();
  const { setShowCreatorModal } = useOutletContext() || {};
  const openCreator = useCallback(() => setShowCreatorModal?.(true), [setShowCreatorModal]);
  const [showDemo, setShowDemo] = useState(false);

  const displayData = showDemo ? {
    campaigns: DEMO_DATA.campaigns,
    globalKpis: DEMO_DATA.globalKpis,
    opportunities: DEMO_DATA.opportunities,
    recommendations: DEMO_DATA.recommendations,
    chartData: DEMO_DATA.chartData,
  } : { campaigns, globalKpis, opportunities, recommendations, chartData };

  const campaignsList = useMemo(() => Object.values(displayData.campaigns), [displayData.campaigns]);
  const isEmpty = showDemo ? false : campaignsList.length === 0;
  const activeCount = useMemo(
    () => campaignsList.filter((c) => c.status === 'active').length,
    [campaignsList]
  );

  /* ── Subtitle ── */
  const subtitle = isEmpty
    ? 'Bienvenue \u2014 Configurez votre première campagne'
    : (() => {
        const today = new Date();
        const weekStr =
          'Semaine du ' +
          today.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
        return `${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} \u00b7 ${weekStr}`;
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
        <button
          className={`btn ${showDemo ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowDemo(p => !p)}
          style={{ fontSize: 12 }}
        >
          {showDemo ? 'Donn\u00e9es de d\u00e9mo actives' : 'Voir la d\u00e9mo'}
        </button>
      </div>

      {/* Overview content */}
      <OverviewSection
        isEmpty={isEmpty}
        globalKpis={displayData.globalKpis}
        campaigns={campaignsList}
        opportunities={displayData.opportunities}
        recommendations={displayData.recommendations}
        chartData={displayData.chartData}
        onCreateCampaign={openCreator}
        setOpportunities={setOpportunities}
      />
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Overview Section
   ═══════════════════════════════════════════════════ */

function OverviewSection({ isEmpty, globalKpis, campaigns, opportunities, recommendations, chartData, onCreateCampaign, setOpportunities }) {
  const [scoring, setScoring] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleScoreLeads = useCallback(async () => {
    setScoring(true);
    try {
      const data = await scoreLeads();
      if (data.scored && data.scored.length > 0) {
        const { transformOpportunity } = await import('../services/api-client');
        setOpportunities(data.scored.map(transformOpportunity));
      }
    } catch (err) {
      console.error('Score leads error:', err);
    } finally {
      setScoring(false);
    }
  }, [setOpportunities]);

  const handleExportCSV = useCallback(() => {
    downloadScoresCSV();
  }, []);

  const handleExportCRM = useCallback(async () => {
    setExporting(true);
    try {
      await exportScoresToCRM();
    } catch (err) {
      console.error('CRM export error:', err);
    } finally {
      setExporting(false);
    }
  }, []);
  if (isEmpty) {
    return (
      <div id="section-overview">
        <ProgressCard />
        <WelcomeBanner onCreateCampaign={onCreateCampaign} />
        <EmptyKpis />
        <EmptyOverviewGrid onCreateCampaign={onCreateCampaign} />
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

      {/* Progress card — full width */}
      <div style={{ marginBottom: 16 }}>
        <ProgressCard />
      </div>

      {/* Section grid — 2x2 */}
      <div className="section-grid">
        {/* Campaigns table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Campagnes actives</div>
            <Link
              to="/campaigns"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              Voir tout &rarr;
            </Link>
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
            <div className="card-title">{'\u{1F525}'} Opportunités</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleExportCSV}>CSV</button>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleExportCRM} disabled={exporting}>{exporting ? '...' : 'CRM'}</button>
              <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleScoreLeads} disabled={scoring}>{scoring ? '...' : 'Scorer'}</button>
            </div>
          </div>
          <div className="card-body" style={{ padding: '16px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {opportunities && opportunities.length > 0 ? (
                opportunities.map((opp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < opportunities.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{opp.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{opp.title} &middot; {opp.company} &middot; {opp.size}</div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ScoreBadge score={opp.score} breakdown={opp.scoreBreakdown} />
                      <div>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: opp.statusColor, background: opp.statusBg, padding: '2px 8px', borderRadius: '4px' }}>{opp.status}</span>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{opp.timing}</div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                  Les opportunités s'afficheront ici.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{'\u{1F4A1}'} Recommandations Claude</div>
            <Link
              to="/recos"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              Voir toutes les recommandations &rarr;
            </Link>
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
          <th>Réponses</th>
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
    <span className="status-badge status-prep">{'\u23F3'} En préparation</span>
  );

  let openContent, replyContent, meetingsContent;

  if (isPrep) {
    openContent = (
      <div style={{ color: 'var(--text-muted)' }}>&mdash;</div>
    );
    replyContent = (
      <div style={{ color: 'var(--text-muted)' }}>&mdash;</div>
    );
    meetingsContent = (
      <div style={{ color: 'var(--text-muted)' }}>&mdash;</div>
    );
  } else if (isLinkedin) {
    openContent = (
      <>
        <div style={{ fontWeight: 600 }}>&mdash;</div>
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

function WelcomeBanner({ onCreateCampaign }) {
  return (
    <div className="welcome-banner">
      <div className="welcome-title">Bienvenue sur Bakal</div>
      <div className="welcome-subtitle">
        Votre plateforme de prospection intelligente est prête. Suivez ces étapes
        pour lancer votre première campagne et commencer à générer des RDV
        qualifiés.
      </div>
      <div className="onboarding-steps">
        <div className="onboarding-step step-active">
          <div className="onboarding-step-number">1</div>
          <div className="onboarding-step-title">Créez votre campagne</div>
          <div className="onboarding-step-desc">
            Définissez votre cible, votre canal (Email, LinkedIn ou les deux) et
            votre angle d'approche.
          </div>
          <button className="btn btn-primary" onClick={onCreateCampaign}>Créer ma campagne</button>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">2</div>
          <div className="onboarding-step-title">
            Claude génère vos séquences
          </div>
          <div className="onboarding-step-desc">
            L'IA rédige des messages personnalisés et adaptés à votre cible et
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
    { label: '\u{1F4E4} Contacts atteints' },
    { label: "\u{1F4EC} Taux d'ouverture" },
    { label: '\u{1F4AC} Taux de réponse' },
    { label: '\u{1F525} Prospects intéressés' },
    { label: '\u{1F4C5} RDV qualifiés' },
    { label: '\u{1F6AB} Stops' },
  ];

  return (
    <div className="kpi-grid">
      {items.map((k, i) => (
        <div className="kpi-card" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value" style={{ color: 'var(--text-muted)' }}>
            &mdash;
          </div>
          <div className="kpi-trend" style={{ color: 'var(--text-muted)' }}>
            En attente de données
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyOverviewGrid({ onCreateCampaign }) {
  return (
    <div className="section-grid">
      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F3AF}'} Campagnes actives</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F4ED}'}</div>
          <div className="empty-text">
            Aucune campagne pour le moment. Créez votre première campagne pour
            voir vos performances ici.
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: '16px', fontSize: '13px' }}
            onClick={onCreateCampaign}
          >
            Créer une campagne
          </button>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F4C8}'} Performance 4 semaines</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F4CA}'}</div>
          <div className="empty-text">
            Les graphiques de performance apparaîtront dès que votre première
            campagne sera active.
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F525}'} Opportunités récentes</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F48E}'}</div>
          <div className="empty-text">
            Les prospects intéressés et les RDV planifiés s'afficheront ici au
            fil des réponses.
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F4A1}'} Recommandations Claude</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F916}'}</div>
          <div className="empty-text">
            Claude analysera vos campagnes et proposera des optimisations des
            qu'il aura suffisamment de données (&gt;50 prospects, &gt;7 jours).
          </div>
        </div>
      </div>
    </div>
  );
}
