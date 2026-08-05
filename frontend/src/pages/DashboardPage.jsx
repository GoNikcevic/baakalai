/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Overview-only dashboard: KPIs, campaigns table, opportunities, chart,
   recommendations with link to full recos page.
   =============================================================================== */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useOutletContext, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT, useI18n } from '../i18n';
import { useSocket } from '../context/SocketContext';
import { CumulativeValueBanner, BenchmarkBadge } from '../components/RetentionBiases';
import PerformanceChart from '../components/charts/PerformanceChart';
import { sanitizeHtml } from '../services/sanitize';
import ScoreBadge from '../components/ScoreBadge';
import AnimatedCounter from '../components/AnimatedCounter';
import OnboardingChecklist from '../components/OnboardingChecklist';
import DealCoachCard from '../components/DealCoachCard';
import QuickWinCard from '../components/QuickWinCard';
import ReactivationCard from '../components/ReactivationCard';
import ICPInsightsCard from '../components/ICPInsightsCard';
import DeliverabilityCard from '../components/DeliverabilityCard';
import { request, scoreLeads, exportScoresToCRM, downloadScoresCSV, sendRecoFeedback } from '../services/api-client';

const KPI_LABELS = {
  fr: {
    contacts: '\u{1F4E4} Contacts atteints',
    openRate: "\u{1F4EC} Taux d'ouverture",
    replyRate: '\u{1F4AC} Taux de r\u00e9ponse',
    interested: '\u{1F525} Prospects int\u00e9ress\u00e9s',
    meetings: '\u{1F4C5} RDV qualifi\u00e9s',
    stops: '\u{1F6AB} Stops',
  },
  en: {
    contacts: '\u{1F4E4} Contacts reached',
    openRate: '\u{1F4EC} Open rate',
    replyRate: '\u{1F4AC} Reply rate',
    interested: '\u{1F525} Interested prospects',
    meetings: '\u{1F4C5} Qualified meetings',
    stops: '\u{1F6AB} Stops',
  },
};

export default function DashboardPage() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const { campaigns, globalKpis, opportunities, recommendations, chartData, setOpportunities } = useApp();
  const { setShowCreatorModal } = useOutletContext() || {};
  const navigate = useNavigate();
  const openCreator = useCallback(() => navigate('/chat'), [navigate]);
  const { socket } = useSocket();
  const [syncStatus, setSyncStatus] = useState(null);
  // Stats CRM (pipeline, dormants, récupéré) — fetch unique, partagé entre la
  // grille RevenueKpis et la ReactivationCard.
  const [crmStats, setCrmStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/crm/reactivation-stats').then(d => {
      if (!cancelled) setCrmStats(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onLemlist = (data) => setSyncStatus(data.status === 'done' || data.status === 'error' ? null : { type: 'Lemlist', ...data });
    const onCrm = (data) => setSyncStatus(data.status === 'done' || data.status === 'error' ? null : { type: 'CRM', ...data });
    socket.on('lemlist:sync', onLemlist);
    socket.on('crm:sync', onCrm);
    return () => { socket.off('lemlist:sync', onLemlist); socket.off('crm:sync', onCrm); };
  }, [socket]);

  const displayData = { campaigns, globalKpis, opportunities, recommendations, chartData };

  const campaignsList = useMemo(() => Object.values(displayData.campaigns), [displayData.campaigns]);
  const isEmpty = campaignsList.length === 0;
  const activeCount = useMemo(
    () => campaignsList.filter((c) => c.status === 'active').length,
    [campaignsList]
  );

  /* ── Subtitle ── */
  const subtitle = isEmpty
    ? t('dashboard.welcomeSubtitle')
    : (() => {
        const today = new Date();
        const weekStr = en
          ? 'Week of ' + today.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'Semaine du ' + today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        return en
          ? `${activeCount} active campaign${activeCount > 1 ? 's' : ''} \u00b7 ${weekStr}`
          : `${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} \u00b7 ${weekStr}`;
      })();

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">
            {!isEmpty && <span className="pulse-dot"></span>}
            <span style={{ marginLeft: 8 }}>{subtitle}</span>
          </div>
        </div>
      </div>

      {/* Sync in progress indicator */}
      {syncStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 16,
          background: 'var(--blue-bg)', border: '1px solid rgba(59,130,246,0.15)',
          borderRadius: 10, fontSize: 13, color: 'var(--blue)',
          animation: 'fadeInUp 0.3s ease-out',
        }}>
          <div style={{
            width: 16, height: 16, border: '2px solid var(--blue)',
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span>{en ? `${syncStatus.type} analysis in progress` : `Analyse ${syncStatus.type} en cours`} — {syncStatus.message || `${syncStatus.progress || 0}%`}</span>
        </div>
      )}

      {/* Onboarding checklist for new users */}
      <OnboardingChecklist />

      {/* KPIs revenue — le langage du produit : pipeline, dormants, récupéré.
          Les KPIs d'emailing descendent dans la section campagnes. */}
      <RevenueKpis stats={crmStats} />

      {/* Reactivation KPIs — hero metric */}
      <ReactivationCard stats={crmStats} />

      {/* Quick Win — immediate CRM insight after sync */}
      <QuickWinCard />

      {/* Deal Coach — stagnant deal suggestions with action buttons */}
      <DealCoachCard />

      {/* Deliverability — show if user has >= 1 campaign */}
      {campaignsList.length >= 1 && <DeliverabilityCard />}

      {/* ICP Insights — only show if user has >= 3 campaigns */}
      {campaignsList.length >= 3 && <ICPInsightsCard />}

      {/* Weekly report link */}
      {!isEmpty && (
        <div style={{ marginBottom: 16, textAlign: 'right' }}>
          <Link to="/performance" style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
            {en ? 'Weekly report & trends' : 'Rapport hebdo & tendances'} {'\u2192'}
          </Link>
        </div>
      )}

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
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [scoring, setScoring] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ratedRecos, setRatedRecos] = useState({});

  const handleRecoFeedback = useCallback(async (idx, rec, feedback) => {
    setRatedRecos(prev => ({ ...prev, [idx]: feedback }));
    try {
      await sendRecoFeedback(rec.patternId || null, rec.text || '', feedback);
    } catch {
      /* ignore errors silently */
    }
  }, []);

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
    // Pas de ProgressCard ici : l'OnboardingChecklist au-dessus guide déjà les
    // premiers pas — deux jauges de progression concurrentes brouillaient le
    // message (constat de l'audit UX du 2026-08-05).
    return (
      <div id="section-overview">
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
            <div className="kpi-label">{(en ? KPI_LABELS.en[key] : KPI_LABELS.fr[key]) || key}</div>
            <div className="kpi-value">
              <AnimatedCounter value={k.value} />
            </div>
            <div className={`kpi-trend ${k.direction === 'up' ? 'up' : ''}`}>
              {k.trend}
            </div>
          </div>
        ))}
      </div>

      {/* Retention: Cumulative value banner + benchmark */}
      <CumulativeValueBanner />
      <BenchmarkBadge />

      {/* Section grid — 2x2 */}
      <div className="section-grid">
        {/* Campaigns table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('dashboard.activeCampaigns')}</div>
            <Link
              to="/campaigns"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {t('dashboard.viewAll')} &rarr;
            </Link>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <CampaignsTable campaigns={campaigns} />
          </div>
        </div>

        {/* Performance chart — recharts */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('dashboard.performance4w')}</div>
          </div>
          <div className="card-body">
            <PerformanceChart data={chartData} />
          </div>
        </div>

        {/* Opportunities */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{'\u{1F525}'} {en ? 'Opportunities' : 'Opportunités'}</div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleExportCSV}>CSV</button>
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleExportCRM} disabled={exporting}>{exporting ? '...' : 'CRM'}</button>
              <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={handleScoreLeads} disabled={scoring}>{scoring ? '...' : (en ? 'Score' : 'Scorer')}</button>
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
                  {en ? 'Opportunities will appear here.' : 'Les opportunités s\'afficheront ici.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{'\u{1F4A1}'} {en ? 'Baakalai Recommendations' : 'Recommandations Baakalai'}</div>
            <Link
              to="/recos"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              {t('dashboard.allRecos')} &rarr;
            </Link>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recommendations && recommendations.length > 0 ? (
                recommendations.map((rec, i) => (
                  <div key={i} className={`alert alert-${rec.level}`} style={{ padding: '12px 16px', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{rec.label}</div>
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(rec.text) }} />
                      </div>
                      <div style={{ display: 'flex', gap: '4px', marginLeft: '12px', flexShrink: 0 }}>
                        {ratedRecos[i] ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{en ? 'Thanks' : 'Merci'}</span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleRecoFeedback(i, rec, 'useful')}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                              title={en ? 'Useful' : 'Utile'}
                            >{'\uD83D\uDC4D'}</button>
                            <button
                              onClick={() => handleRecoFeedback(i, rec, 'not_useful')}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                              title={en ? 'Not useful' : 'Pas utile'}
                            >{'\uD83D\uDC4E'}</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
                  {en ? 'AI recommendations will appear here.' : 'Les recommandations IA s\'afficheront ici.'}
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
  const { lang } = useI18n();
  const en = lang === 'en';
  const activeCampaigns = campaigns.filter(
    (c) => c.status === 'active' || c.status === 'prep'
  );

  return (
    <table className="campaign-table">
      <thead>
        <tr>
          <th>{en ? 'Campaign' : 'Campagne'}</th>
          <th>{en ? 'Channel' : 'Canal'}</th>
          <th>{en ? 'Status' : 'Statut'}</th>
          <th>{en ? 'Opens' : 'Ouvertures'}</th>
          <th>{en ? 'Replies' : 'Réponses'}</th>
          <th>{en ? 'Meetings' : 'RDV'}</th>
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
  const { lang } = useI18n();
  const en = lang === 'en';
  const isPrep = c.status === 'prep';
  const isLinkedin = c.channel === 'linkedin';

  const statusHtml = c.status === 'active' ? (
    <span className="status-badge status-active">
      <span className="pulse-dot" style={{ width: 6, height: 6 }}></span>{' '}
      Active
    </span>
  ) : (
    <span className="status-badge status-prep">{'\u23F3'} {en ? 'Preparing' : 'En préparation'}</span>
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
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  return (
    <div className="welcome-banner">
      <div className="welcome-title">{t('dashboard.welcomeTitle')}</div>
      <div className="welcome-subtitle">
        {en ? 'Your intelligent prospecting platform is ready. Follow these steps to launch your first campaign and start generating qualified meetings.'
          : 'Votre plateforme de prospection intelligente est pr\u00eate. Suivez ces \u00e9tapes pour lancer votre premi\u00e8re campagne et commencer \u00e0 g\u00e9n\u00e9rer des RDV qualifi\u00e9s.'}
      </div>
      <div className="onboarding-steps">
        <div className="onboarding-step step-active">
          <div className="onboarding-step-number">1</div>
          <div className="onboarding-step-title">{en ? 'Create your campaign' : 'Cr\u00e9ez votre campagne'}</div>
          <div className="onboarding-step-desc">
            {en ? 'Define your target, channel (Email, LinkedIn or both), and approach angle.'
              : 'D\u00e9finissez votre cible, votre canal (Email, LinkedIn ou les deux) et votre angle d\'approche.'}
          </div>
          <button className="btn btn-primary" onClick={onCreateCampaign}>{en ? 'Create my campaign' : 'Cr\u00e9er ma campagne'}</button>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">2</div>
          <div className="onboarding-step-title">
            {en ? 'baakalai generates your sequences' : 'Baakalai g\u00e9n\u00e8re vos s\u00e9quences'}
          </div>
          <div className="onboarding-step-desc">
            {en ? 'AI writes personalized messages adapted to your target and sector.'
              : 'L\'IA r\u00e9dige des messages personnalis\u00e9s et adapt\u00e9s \u00e0 votre cible et votre secteur.'}
          </div>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">3</div>
          <div className="onboarding-step-title">
            {en ? 'Import your prospects' : 'Importez vos prospects'}
          </div>
          <div className="onboarding-step-desc">
            {en ? 'Add your contact list or let us build it for you.' : 'Ajoutez votre liste de contacts ou laissez-nous la constituer pour vous.'}
          </div>
        </div>
        <div className="onboarding-step">
          <div className="onboarding-step-number">4</div>
          <div className="onboarding-step-title">{t('dashboard.launchAndRefine')}</div>
          <div className="onboarding-step-desc">
            {t('dashboard.launchAndRefineDesc')}
          </div>
        </div>
      </div>
    </div>
  );
}

/* \u2500\u2500 KPIs revenue \u2014 la langue du produit \u2500\u2500
   Pipeline ouvert, deals dormants, revenu r\u00e9cup\u00e9r\u00e9, relances : le
   \u00ab 1 deal r\u00e9cup\u00e9r\u00e9 = l'outil est pay\u00e9 \u00bb en chiffres, au-dessus des
   m\u00e9triques d'emailing. Rend null tant que le CRM n'a rien donn\u00e9. */
function RevenueKpis({ stats }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  if (!stats) return null;
  const { pipeline = {}, reactivated = {}, emails = {} } = stats;
  if (!pipeline.openDeals && !reactivated.count) return null;

  const money = (n) => {
    if (!n) return '0\u00a0\u20ac';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M\u00a0\u20ac`;
    if (n >= 1000) return `${Math.round(n / 1000)}k\u00a0\u20ac`;
    return `${Math.round(n)}\u00a0\u20ac`;
  };

  const cards = [
    {
      label: en ? '\u{1F4BC} Open pipeline' : '\u{1F4BC} Pipeline ouvert',
      value: money(pipeline.totalValue),
      trend: en ? `${pipeline.openDeals} open deals` : `${pipeline.openDeals} deals ouverts`,
    },
    {
      label: en ? '\u{1F4A4} Dormant deals' : '\u{1F4A4} Deals dormants',
      value: String(pipeline.stagnantDeals || 0),
      trend: en ? `${money(pipeline.potentialRevenue)} to revive` : `${money(pipeline.potentialRevenue)} \u00e0 r\u00e9veiller`,
    },
    {
      label: en ? '\u{1F4B0} Revenue recovered' : '\u{1F4B0} Revenu r\u00e9cup\u00e9r\u00e9',
      value: money(reactivated.revenue),
      trend: en
        ? `${reactivated.count} deal${reactivated.count > 1 ? 's' : ''} reactivated`
        : `${reactivated.count} deal${reactivated.count > 1 ? 's' : ''} r\u00e9activ\u00e9${reactivated.count > 1 ? 's' : ''}`,
    },
    {
      label: en ? '\u{1F4E8} Follow-ups sent' : '\u{1F4E8} Relances envoy\u00e9es',
      value: String(emails.sent || 0),
      trend: en ? `${emails.replyRate || 0}% replies` : `${emails.replyRate || 0}% de r\u00e9ponses`,
    },
  ];

  return (
    <div className="kpi-grid" style={{ marginBottom: 16 }}>
      {cards.map((k, i) => (
        <div className="kpi-card" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-trend">{k.trend}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyKpis() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  // Langage revenue m\u00eame \u00e0 vide : on annonce ce que le CRM va remplir,
  // pas des m\u00e9triques d'emailing.
  const items = en ? [
    { label: '\u{1F4BC} Open pipeline' },
    { label: '\u{1F4A4} Dormant deals' },
    { label: '\u{1F4B0} Revenue recovered' },
    { label: '\u{1F4E8} Follow-ups sent' },
    { label: '\u{1F4AC} Reply rate' },
    { label: '\u{1F4C5} Qualified meetings' },
  ] : [
    { label: '\u{1F4BC} Pipeline ouvert' },
    { label: '\u{1F4A4} Deals dormants' },
    { label: '\u{1F4B0} Revenu r\u00e9cup\u00e9r\u00e9' },
    { label: '\u{1F4E8} Relances envoy\u00e9es' },
    { label: '\u{1F4AC} Taux de r\u00e9ponse' },
    { label: '\u{1F4C5} RDV qualifi\u00e9s' },
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
            {en ? 'Waiting for data' : 'En attente de données'}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyOverviewGrid({ onCreateCampaign }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  return (
    <div className="section-grid">
      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F3AF}'} {en ? 'Active campaigns' : 'Campagnes actives'}</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F4ED}'}</div>
          <div className="empty-text">
            {en ? 'No campaigns yet. Create your first campaign to see your performance here.'
              : 'Aucune campagne pour le moment. Cr\u00e9ez votre premi\u00e8re campagne pour voir vos performances ici.'}
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: '16px', fontSize: '13px' }}
            onClick={onCreateCampaign}
          >
            {en ? 'Create a campaign' : 'Cr\u00e9er une campagne'}
          </button>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F4C8}'} {en ? '4-week performance' : 'Performance 4 semaines'}</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F4CA}'}</div>
          <div className="empty-text">
            {en ? 'Performance charts will appear once your first campaign is active.'
              : 'Les graphiques de performance appara\u00eetront d\u00e8s que votre premi\u00e8re campagne sera active.'}
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F525}'} {en ? 'Recent opportunities' : 'Opportunit\u00e9s r\u00e9centes'}</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F48E}'}</div>
          <div className="empty-text">
            {en ? 'Interested prospects and scheduled meetings will appear here as replies come in.'
              : 'Les prospects int\u00e9ress\u00e9s et les RDV planifi\u00e9s s\'afficheront ici au fil des r\u00e9ponses.'}
          </div>
        </div>
      </div>

      <div className="card card-empty">
        <div className="card-header">
          <div className="card-title">{'\u{1F4A1}'} {en ? 'Baakalai Recommendations' : 'Recommandations Baakalai'}</div>
        </div>
        <div className="card-body">
          <div className="empty-icon">{'\u{1F916}'}</div>
          <div className="empty-text">
            {t('dashboard.emptyRecoText') || 'baakalai will analyze your campaigns and suggest refinements once it has enough data (>50 prospects, >7 days).'}
          </div>
        </div>
      </div>
    </div>
  );
}
