/* ===============================================================================
   BAKAL — CRM Analytics Page
   Pipeline, Revenue Attribution, Lead Scoring, Trends, Channels, Health Score.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useSocket } from '../context/SocketContext';
import api from '../services/api-client';
import { useI18n, useT } from '../i18n';
import EngagementChart from '../components/charts/EngagementChart';
import FunnelChart from '../components/charts/FunnelChart';
import LoadingTips from '../components/LoadingTips';

/* ─── Helpers ─── */

const STAGE_COLORS = {
  new: 'var(--text-muted)',
  interested: 'var(--blue)',
  meeting: 'var(--success)',
  negotiation: 'var(--warning)',
  won: 'var(--purple)',
  lost: 'var(--danger)',
};

/* ─── Vocabulary mapping (sales vs membership orgs) ─── */

function getVocabulary(mode, en) {
  if (mode === 'membership') {
    return {
      deal: en ? 'Membership' : 'Adhésion',
      won: en ? 'Renewed' : 'Renouvelé',
      lost: en ? 'Lapsed' : 'Expiré',
      pipeline: en ? 'Member Lifecycle' : 'Cycle de vie membre',
      new: en ? 'New member' : 'Nouveau membre',
      interested: en ? 'Engaged' : 'Engagé',
      meeting: en ? 'Active' : 'Actif',
      negotiation: en ? 'At risk' : 'À risque',
    };
  }
  return {
    deal: en ? 'Deal' : 'Deal',
    won: en ? 'Won' : 'Gagné',
    lost: en ? 'Lost' : 'Perdu',
    pipeline: 'Pipeline',
    new: en ? 'New' : 'Nouveau',
    interested: en ? 'Interested' : 'Intéressé',
    meeting: en ? 'Meeting' : 'RDV',
    negotiation: en ? 'Negotiation' : 'Négo',
  };
}

function getStatusLabels(vocab) {
  return {
    new: vocab.new,
    interested: vocab.interested,
    meeting: vocab.meeting,
    negotiation: vocab.negotiation,
    won: vocab.won,
    lost: vocab.lost,
  };
}

const CHANNEL_COLORS = {
  email: 'var(--blue)',
  linkedin: 'var(--purple)',
  multi: 'var(--orange)',
};

function ScoreBadge({ score }) {
  const color = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
  const label = score >= 70 ? 'High' : score >= 40 ? 'Med' : 'Low';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 36, padding: '2px 8px', borderRadius: 12,
      fontSize: 12, fontWeight: 700, color: 'white',
      background: color,
    }} title={label}>{score}</span>
  );
}

function HelpTip({ text }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 5, verticalAlign: 'middle', flexShrink: 0 }} className="helptip-wrap">
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: '50%',
          fontSize: 10, fontWeight: 700, cursor: 'help',
          background: 'var(--border)', color: 'var(--text-muted)',
        }}
      >?</span>
      <span className="helptip-bubble">{text}</span>
      <style>{`
        .helptip-wrap .helptip-bubble {
          visibility: hidden; opacity: 0;
          position: absolute; bottom: calc(100% + 8px); left: 50%;
          transform: translateX(-50%); width: 260px;
          padding: 10px 12px; border-radius: 8px;
          background: var(--bg-primary, #fff); color: var(--text-primary, #0a0a0a);
          font-size: 12px; font-weight: 400; line-height: 1.5;
          box-shadow: 0 4px 16px rgba(0,0,0,.12); border: 1px solid var(--border, #e5e5e5);
          pointer-events: none; transition: opacity .15s; z-index: 999;
          white-space: normal; text-align: left;
        }
        .helptip-wrap:hover .helptip-bubble { visibility: visible; opacity: 1; }
      `}</style>
    </span>
  );
}

/* ─── Sections ─── */

// Essential tabs shown by default; advanced tabs behind "More"
function getTabs(t, vocab) { return [
  { key: 'pipeline', label: vocab?.pipeline || 'Pipeline', desc: t('analytics.tabDescPipeline'), essential: true },
  { key: 'scoring', label: t('analytics.contactScore'), desc: t('analytics.tabDescScoring'), essential: true },
  { key: 'segments', label: t('analytics.segments'), desc: t('analytics.tabDescSegments'), essential: true },
  { key: 'attribution', label: 'Attribution', desc: t('analytics.tabDescAttribution') },
  { key: 'trends', label: t('analytics.trends'), desc: t('analytics.tabDescTrends') },
  { key: 'channels', label: t('analytics.channels'), desc: t('analytics.tabDescChannels') },
  { key: 'forecast', label: 'Forecast', desc: t('analytics.tabDescForecast') },
  { key: 'renewals', label: t('analytics.renewals'), desc: t('analytics.tabDescRenewals') },
]; }

/* ═══ Main Component ═══ */

export default function CRMAnalyticsPage() {
  const navigate = useNavigate();
  const { backendAvailable, opportunities } = useApp();
  const { socket } = useSocket();
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';

  // Detect vocabulary mode: membership orgs vs sales teams
  const mode = useMemo(() => {
    const opps = Object.values(opportunities || {});
    if (opps.length === 0) return 'sales'; // default to sales when no data
    const hasDeals = opps.some(o => o.deal_value > 0 || o.status === 'won' || o.status === 'lost');
    return hasDeals ? 'sales' : 'membership';
  }, [opportunities]);
  const vocab = useMemo(() => getVocabulary(mode, en), [mode, en]);
  const STATUS_LABELS = useMemo(() => getStatusLabels(vocab), [vocab]);

  const [activeTab, setActiveTab] = useState('pipeline');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [showAllTabs, setShowAllTabs] = useState(false);
  const TABS = getTabs(t, vocab);
  const fetchedRef = useRef(new Set());

  const fetchData = useCallback(async (tab, force) => {
    if (!backendAvailable) {
      setData({});
      return;
    }
    if (!force && fetchedRef.current.has(tab)) return;
    fetchedRef.current.add(tab);
    setLoading(true);
    try {
      const result = await api.request('/analytics/' + tab);
      setData(prev => ({ ...prev, [tab]: result }));
    } catch {
      setData(prev => ({ ...prev, [tab]: null }));
    }
    setLoading(false);
  }, [backendAvailable]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  // Auto-refresh after CRM sync completes
  useEffect(() => {
    if (!socket) return;
    const onCrmSync = (ev) => {
      if (ev.status === 'done') {
        fetchedRef.current.clear();
        fetchData(activeTab, true);
      }
    };
    socket.on('crm:sync', onCrmSync);
    return () => socket.off('crm:sync', onCrmSync);
  }, [socket, activeTab, fetchData]);

  const tabData = data[activeTab];
  const contactCount = Object.keys(opportunities || {}).length;
  const hasData = contactCount > 0;

  // KPI summary from pipeline data
  const pipelineData = data.pipeline;
  const kpis = useMemo(() => {
    if (!pipelineData) return null;
    const stages = pipelineData.stages || [];
    const total = pipelineData.total || 0;
    const won = stages.find(s => s.stage === 'won')?.count || 0;
    const lost = stages.find(s => s.stage === 'lost')?.count || 0;
    const active = total - won - lost;
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    return { total, active, won, winRate };
  }, [pipelineData]);

  // Fetch pipeline for KPIs on mount
  useEffect(() => {
    if (backendAvailable && !data.pipeline) fetchData('pipeline');
  }, [backendAvailable, data.pipeline, fetchData]);

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">CRM Analytics</h1>
          <div className="page-subtitle">{t('analytics.subtitle')}</div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {kpis && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12, marginBottom: 20,
        }}>
          {(() => {
            const ch = pipelineData?.comparison?.changes;
            return [
              { label: en ? 'Total contacts' : 'Contacts total', value: kpis.total, delta: ch?.total },
              { label: en ? `Active ${vocab.deal.toLowerCase()}s` : `${vocab.deal}s actifs`, value: kpis.active },
              { label: vocab.won, value: kpis.won, delta: ch?.won },
              { label: en ? 'Win rate' : 'Taux de conversion', value: kpis.winRate + '%', delta: ch?.winRate, suffix: 'pp' },
            ].map((kpi, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '14px 18px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.value}</div>
                {kpi.delta != null && kpi.delta !== 0 ? (
                  <div style={{
                    fontSize: 11, marginTop: 4,
                    color: kpi.delta > 0 ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {kpi.delta > 0 ? '\u25B2' : '\u25BC'}{' '}
                    {kpi.delta > 0 ? '+' : ''}{kpi.delta}{kpi.suffix || ''}{' '}
                    {en ? 'vs last 30d' : 'vs 30j préc.'}
                  </div>
                ) : kpi.delta === 0 ? (
                  <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
                    {'—'} {en ? 'vs last 30d' : 'vs 30j préc.'}
                  </div>
                ) : null}
              </div>
            ));
          })()}
        </div>
      )}

      {/* Tab bar — essential tabs + expandable advanced tabs */}
      <div className="crm-tabs">
        {TABS.filter(tab => tab.essential || showAllTabs || activeTab === tab.key).map(tab => (
          <button
            key={tab.key}
            className={`crm-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        {!showAllTabs && (
          <button
            className="crm-tab"
            onClick={() => setShowAllTabs(true)}
            style={{ color: 'var(--text-muted)', fontSize: 12 }}
          >
            {en ? 'More' : 'Plus'} +
          </button>
        )}
      </div>

      {/* Active tab description */}
      {(() => {
        const active = TABS.find(t => t.key === activeTab);
        return active?.desc ? (
          <div style={{
            fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 16px',
            lineHeight: 1.4,
          }}>
            {active.desc}
          </div>
        ) : null;
      })()}

      {/* Content */}
      {loading && <LoadingTips />}

      {/* Empty state — no data */}
      {!loading && !tabData && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{hasData ? '—' : '—'}</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
            {hasData
              ? (en ? 'No data for this view yet' : 'Pas encore de données pour cette vue')
              : (en ? 'Connect your CRM to get started' : 'Connectez votre CRM pour commencer')}
          </div>
          <div style={{ fontSize: 13, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            {hasData
              ? (en ? `Data will appear here once your contacts and ${vocab.deal.toLowerCase()}s have enough activity.` : `Les données apparaîtront ici quand vos contacts et ${vocab.deal.toLowerCase()}s auront assez d'activité.`)
              : (en ? 'Go to Settings, connect your CRM (Salesforce, HubSpot, Pipedrive...) and sync your data.' : 'Allez dans Paramètres, connectez votre CRM (Salesforce, HubSpot, Pipedrive...) et synchronisez vos données.')}
          </div>
          {!hasData && (
            <button
              className="btn btn-primary"
              style={{ marginTop: 16, fontSize: 13, padding: '8px 20px' }}
              onClick={() => navigate('/settings')}
            >
              {en ? 'Go to Settings' : 'Aller aux Paramètres'}
            </button>
          )}
        </div>
      )}

      {/* CSV Export button */}
      {!loading && tabData && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            onClick={() => api.downloadAnalyticsCSV(activeTab)}
          >
            CSV
          </button>
        </div>
      )}

      {!loading && activeTab === 'pipeline' && tabData && <PipelineSection data={tabData} statusLabels={STATUS_LABELS} vocab={vocab} />}
      {!loading && activeTab === 'attribution' && tabData && <AttributionSection data={tabData} />}
      {!loading && activeTab === 'scoring' && tabData && <ScoringSection data={tabData} statusLabels={STATUS_LABELS} />}
      {!loading && activeTab === 'trends' && tabData && <TrendsSection data={tabData} />}
      {!loading && activeTab === 'channels' && tabData && <ChannelsSection data={tabData} />}
      {!loading && activeTab === 'forecast' && tabData && <ForecastSection data={tabData} statusLabels={STATUS_LABELS} vocab={vocab} />}
      {!loading && activeTab === 'segments' && tabData && <SegmentsSection data={tabData} />}
      {!loading && activeTab === 'renewals' && tabData && <RenewalsSection data={tabData} />}
    </div>
  );
}

/* ═══ Pipeline Section ═══ */

function PipelineSection({ data, statusLabels, vocab }) {
  const t = useT();
  const STATUS_LABELS = statusLabels;
  const funnelStages = (data.stages || [])
    .filter(s => s.stage !== 'lost')
    .map(s => ({ label: s.label, value: s.count }));

  return (
    <div className="crm-section">
      {/* KPI row */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.total || 0}</div>
          <div className="crm-kpi-label">{t('analytics.totalOpportunities')}</div>
        </div>
        {(data.stages || []).map(s => (
          <div className="crm-kpi-card" key={s.stage}>
            <div className="crm-kpi-value" style={{ color: STAGE_COLORS[s.stage] }}>{s.count}</div>
            <div className="crm-kpi-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="crm-grid-2">
        {/* Visual funnel */}
        <div className="card">
          <div className="card-title">{t('analytics.pipelineFunnel')}</div>
          <div className="card-body">
            <FunnelChart stages={funnelStages} />
          </div>
        </div>

        {/* Conversion rates */}
        <div className="card">
          <div className="card-title">{t('analytics.conversionRates')}</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(data.conversions || []).map((c, i) => (
                <div key={i} className="crm-conversion-row">
                  <div className="crm-conversion-labels">
                    <span style={{ color: STAGE_COLORS[c.from] }}>{STATUS_LABELS[c.from]}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>→</span>
                    <span style={{ color: STAGE_COLORS[c.to] }}>{STATUS_LABELS[c.to]}</span>
                  </div>
                  <div className="crm-conversion-bar-track">
                    <div className="crm-conversion-bar-fill" style={{ width: `${c.rate}%`, background: STAGE_COLORS[c.to] }} />
                  </div>
                  <div className="crm-conversion-rate">{c.rate}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Attribution Section ═══ */

function AttributionSection({ data }) {
  const t = useT();
  const sorted = useMemo(() =>
    [...(data.campaigns || [])].sort((a, b) => b.conversionRate - a.conversionRate),
    [data.campaigns]
  );

  return (
    <div className="crm-section">
      {/* Totals */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.totals?.prospects || 0}</div>
          <div className="crm-kpi-label">{t('analytics.totalProspects')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.totals?.meetings || 0}</div>
          <div className="crm-kpi-label">{t('analytics.meetingsBooked')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>{data.totals?.interested || 0}</div>
          <div className="crm-kpi-label">{t('analytics.interested')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>{data.totals?.avgConversion || 0}%</div>
          <div className="crm-kpi-label">{t('analytics.avgConversion')}</div>
        </div>
      </div>

      {/* Campaign table */}
      <div className="card">
        <div className="card-title">{t('analytics.roiByCampaign')}</div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span style={{ flex: 2 }}>{t('analytics.campaign')}</span>
              <span>{t('analytics.channel')}</span>
              <span>Prospects</span>
              <span>{t('analytics.interested')}</span>
              <span>{t('analytics.meetings')}</span>
              <span>Conversion</span>
            </div>
            {sorted.map(c => (
              <div className="crm-table-row" key={c.id}>
                <span style={{ flex: 2, fontWeight: 600 }}>{c.name}</span>
                <span>
                  <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[c.channel] || 'var(--text-muted)' }}>
                    {c.channel}
                  </span>
                </span>
                <span>{c.prospects}</span>
                <span>{c.interested}</span>
                <span style={{ fontWeight: 600, color: 'var(--success)' }}>{c.meetings}</span>
                <span>
                  <span style={{
                    fontWeight: 700,
                    color: c.conversionRate >= 3 ? 'var(--success)' : c.conversionRate >= 2 ? 'var(--warning)' : 'var(--danger)',
                  }}>{c.conversionRate}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Scoring Section ═══ */

function ScoringSection({ data, statusLabels }) {
  const STATUS_LABELS = statusLabels;
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    const leads = data.leads || [];
    if (filter === 'high') return leads.filter(l => l.score >= 70);
    if (filter === 'medium') return leads.filter(l => l.score >= 40 && l.score < 70);
    if (filter === 'low') return leads.filter(l => l.score < 40);
    return leads;
  }, [data.leads, filter]);

  return (
    <div className="crm-section">
      {/* Stats */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.avgScore?.toFixed(1) || '—'}</div>
          <div className="crm-kpi-label">{t('analytics.avgScore')}<HelpTip text={t('analytics.helpContactScore')} /></div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.distribution?.high || 0}</div>
          <div className="crm-kpi-label">{t('analytics.scoreHigh')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--warning)' }}>{data.distribution?.medium || 0}</div>
          <div className="crm-kpi-label">{t('analytics.scoreMedium')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--danger)' }}>{data.distribution?.low || 0}</div>
          <div className="crm-kpi-label">{t('analytics.scoreLow')}</div>
        </div>
      </div>

      {/* Filter + Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">{t('analytics.contactScoreboard')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'high', 'medium', 'low'].map(f => (
              <button
                key={f}
                className={`crm-filter-btn${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? t('analytics.all') : f === 'high' ? t('analytics.high') : f === 'medium' ? t('analytics.medium') : t('analytics.low')}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span>Score</span>
              <span style={{ flex: 2 }}>{en ? 'Name' : 'Nom'}</span>
              <span>{en ? 'Company' : 'Entreprise'}</span>
              <span>{en ? 'Status' : 'Statut'}</span>
              <span>{en ? 'Activity' : 'Activité'}<HelpTip text={t('analytics.helpActivity')} /></span>
              <span>Fit<HelpTip text={t('analytics.helpFit')} /></span>
              <span>{en ? 'Last active' : 'Dern. activité'}</span>
            </div>
            {filtered.map(l => (
              <div className="crm-table-row" key={l.id}>
                <span><ScoreBadge score={l.score} /></span>
                <span style={{ flex: 2, fontWeight: 600 }}>{l.name}</span>
                <span>{l.company}</span>
                <span>
                  <span className="crm-status-dot" style={{ background: STAGE_COLORS[l.status] || 'var(--text-muted)' }} />
                  {STATUS_LABELS[l.status] || l.status}
                </span>
                <span style={{ color: 'var(--blue)' }}>{l.breakdown?.activity ?? l.scoreBreakdown?.engagement ?? 0}</span>
                <span style={{ color: 'var(--purple)' }}>{l.breakdown?.fit ?? l.scoreBreakdown?.fit ?? 0}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.lastActivity || l.updatedAt?.split?.('T')?.[0] || '—'}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                {t('analytics.noLeads')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Trends Section ═══ */

function TrendsSection({ data: initialData }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [trendData, setTrendData] = useState(initialData);
  const defaultFrom = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    if (fromDate === defaultFrom && toDate === defaultTo) {
      setTrendData(initialData);
      return;
    }
    let cancelled = false;
    api.request(`/analytics/trends?from=${fromDate}&to=${toDate}`).then(result => {
      if (!cancelled) setTrendData(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [fromDate, toDate, defaultFrom, defaultTo, initialData]);

  const chartData = useMemo(() => {
    if (trendData?.weeks && trendData.weeks.length > 0) {
      return trendData.weeks.map(w => ({
        label: w.label,
        open: w.openRate ?? w.open ?? 0,
        reply: w.replyRate ?? w.reply ?? 0,
        linkedin: w.linkedin ?? 0,
      }));
    }
    return [];
  }, [trendData?.weeks]);

  return (
    <div className="crm-section">
      <div className="card">
        <div className="card-title">{t('analytics.weeklyTrends')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', padding: '0 16px' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'From' : 'De'}</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'To' : '\u00C0'}</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
        </div>
        <div className="card-body">
          {chartData.length > 0 ? (
            <EngagementChart data={chartData} />
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {t('analytics.noTrendsData')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Channels Section ═══ */

function ChannelsSection({ data }) {
  const t = useT();
  const channels = data.channels || [];
  const best = data.bestChannel;

  return (
    <div className="crm-section">
      {/* Best channel highlight */}
      {best && (
        <div className="crm-highlight-card" style={{ borderColor: CHANNEL_COLORS[best.channel] }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('analytics.bestChannel')}:</span>
          <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[best.channel], marginLeft: 8 }}>
            {best.channel}
          </span>
          <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
            {best.value}% {t('analytics.replyRate')}
          </span>
        </div>
      )}

      <div className="crm-grid-3">
        {channels.map(ch => (
          <div className="card" key={ch.channel}>
            <div className="card-header">
              <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[ch.channel] || 'var(--text-muted)' }}>
                {ch.channel}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ch.campaigns} {t('analytics.campaigns')}</span>
            </div>
            <div className="card-body">
              <div className="crm-channel-stats">
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value">{ch.totalProspects}</div>
                  <div className="crm-channel-stat-label">Prospects</div>
                </div>
                {ch.avgOpenRate != null && (
                  <div className="crm-channel-stat">
                    <div className="crm-channel-stat-value">{ch.avgOpenRate}%</div>
                    <div className="crm-channel-stat-label">{t('analytics.openRate')}</div>
                  </div>
                )}
                {ch.avgAcceptRate != null && (
                  <div className="crm-channel-stat">
                    <div className="crm-channel-stat-value">{ch.avgAcceptRate}%</div>
                    <div className="crm-channel-stat-label">{t('analytics.acceptRate')}</div>
                  </div>
                )}
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value">{ch.avgReplyRate}%</div>
                  <div className="crm-channel-stat-label">{t('analytics.replyRate')}</div>
                </div>
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value" style={{ color: 'var(--success)' }}>{ch.meetings}</div>
                  <div className="crm-channel-stat-label">RDV</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Forecast Section ═══ */

function ForecastSection({ data: initialData, statusLabels, vocab }) {
  const STATUS_LABELS = statusLabels;
  const { lang } = useI18n();
  const en = lang === 'en';
  const [forecastData, setForecastData] = useState(initialData);
  const defaultFrom = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    if (fromDate === defaultFrom && toDate === defaultTo) {
      setForecastData(initialData);
      return;
    }
    let cancelled = false;
    api.request(`/analytics/forecast?from=${fromDate}&to=${toDate}`).then(result => {
      if (!cancelled) setForecastData(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [fromDate, toDate, defaultFrom, defaultTo, initialData]);

  const data = forecastData;
  const pipeline = data.pipeline || {};
  const retention = data.retention || {};
  const cycle = data.salesCycle || {};

  return (
    <div className="crm-section">
      {/* Date range picker */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'From' : 'De'}</label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'To' : '\u00C0'}</label>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
      </div>

      {/* KPI row */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>${(pipeline.totalValue || 0).toLocaleString()}</div>
          <div className="crm-kpi-label">{`Total ${vocab.pipeline}`}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>${(pipeline.weightedForecast || 0).toLocaleString()}</div>
          <div className="crm-kpi-label">{t('analytics.weightedForecast')}<HelpTip text={t('analytics.helpForecast')} /></div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{cycle.avgDays || '—'}</div>
          <div className="crm-kpi-label">{t('analytics.avgSalesCycle')}<HelpTip text={t('analytics.helpSalesCycle')} /></div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>${(retention.totalWonRevenue || 0).toLocaleString()}</div>
          <div className="crm-kpi-label">{`${vocab.won} Revenue`}</div>
        </div>
      </div>

      <div className="crm-grid-2">
        {/* Pipeline by stage */}
        <div className="card">
          <div className="card-title">{`${vocab.pipeline} by Stage (Weighted)`}</div>
          <div className="card-body">
            <div className="crm-table">
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>Stage</span>
                <span>{`${vocab.deal}s`}</span>
                <span>Value</span>
                <span>Win %</span>
                <span>Weighted</span>
              </div>
              {(pipeline.byStage || []).map(s => (
                <div className="crm-table-row" key={s.stage}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{s.label}</span>
                  <span>{s.deals}</span>
                  <span>${s.totalValue.toLocaleString()}</span>
                  <span style={{ color: s.probability >= 50 ? 'var(--success)' : 'var(--warning)' }}>{s.probability}%</span>
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>${s.weightedValue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Retention / churn risk */}
        <div className="card">
          <div className="card-title">Revenue Retention</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>Safe Revenue</span>
                <span style={{ fontWeight: 700, color: 'var(--success)' }}>${(retention.safeRevenue || 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>At-Risk Revenue (churn 50+)</span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>${(retention.atRiskRevenue || 0).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>At-Risk Clients</span>
                <span style={{ fontWeight: 700, color: 'var(--warning)' }}>{retention.atRiskCount || 0}</span>
              </div>
              {retention.totalWonRevenue > 0 && (
                <div style={{ height: 8, borderRadius: 4, background: 'var(--danger)', overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${Math.round(((retention.safeRevenue || 0) / retention.totalWonRevenue) * 100)}%`, background: 'var(--success)', borderRadius: 4 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue History */}
      {(data.revenueHistory || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">{`Monthly ${vocab.won} Revenue`}</div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
              {data.revenueHistory.map((m, i) => {
                const max = Math.max(...data.revenueHistory.map(r => r.revenue));
                const pct = max > 0 ? (m.revenue / max) * 100 : 0;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)' }}>${(m.revenue / 1000).toFixed(0)}k</div>
                    <div style={{ width: '100%', height: `${Math.max(pct, 4)}%`, background: 'var(--purple)', borderRadius: 4 }} />
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{m.month.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Projected deals */}
      {(data.projectedDeals || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">{`Top Projected ${vocab.deal}s`}</div>
          <div className="card-body">
            <div className="crm-table">
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>Name</span>
                <span>Company</span>
                <span>Stage</span>
                <span>Value</span>
                <span>Win %</span>
                <span>Weighted</span>
                <span>Est. Close</span>
              </div>
              {data.projectedDeals.slice(0, 10).map(d => (
                <div className="crm-table-row" key={d.id}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{d.name}</span>
                  <span>{d.company}</span>
                  <span>
                    <span className="crm-status-dot" style={{ background: STAGE_COLORS[d.stage] || 'var(--text-muted)' }} />
                    {STATUS_LABELS[d.stage] || d.stage}
                  </span>
                  <span>${d.dealValue.toLocaleString()}</span>
                  <span style={{ color: d.probability >= 50 ? 'var(--success)' : 'var(--warning)' }}>{d.probability}%</span>
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>${d.weightedValue.toLocaleString()}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.projectedCloseDate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {(pipeline.byStage || []).every(s => s.deals === 0) && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {`No ${vocab.deal.toLowerCase()}s with values in ${vocab.pipeline.toLowerCase()}. Add ${vocab.deal.toLowerCase()} values to your contacts to see revenue forecasts.`}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Segments Section ═══ */

const SEGMENT_CONFIG = {
  champions: { color: 'var(--purple)', icon: '\u2B50' },
  active: { color: 'var(--success)', icon: '\u26A1' },
  new: { color: 'var(--blue)', icon: '\u2728' },
  at_risk: { color: 'var(--orange, #f97316)', icon: '\u26A0\uFE0F' },
  dormant: { color: 'var(--text-muted)', icon: '\uD83D\uDCA4' },
};

function SegmentsSection({ data }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [selected, setSelected] = useState(null);

  const segmentLabels = {
    champions: t('analytics.segmentChampions'),
    active: t('analytics.segmentActive'),
    new: t('analytics.segmentNew'),
    at_risk: t('analytics.segmentAtRisk'),
    dormant: t('analytics.segmentDormant'),
  };

  const segments = data.segments || [];
  const selectedSegment = segments.find(s => s.key === selected);

  function metricLine(seg) {
    if (seg.key === 'champions' || seg.key === 'active') {
      return `${t('analytics.segmentTotalValue')}: $${(seg.totalValue || 0).toLocaleString()}`;
    }
    if (seg.key === 'at_risk') {
      return `${t('analytics.segmentAvgChurn')}: ${seg.avgChurnScore || 0}`;
    }
    if (seg.key === 'dormant') {
      return `${t('analytics.segmentDaysInactive')}: ${seg.daysSinceActivity || 0}`;
    }
    return '';
  }

  return (
    <div className="crm-section">
      {/* Segment cards grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        {segments.map(seg => {
          const cfg = SEGMENT_CONFIG[seg.key] || { color: 'var(--text-muted)', icon: '?' };
          const isSelected = selected === seg.key;
          return (
            <div
              key={seg.key}
              onClick={() => setSelected(isSelected ? null : seg.key)}
              style={{
                background: 'var(--bg-card)',
                border: `2px solid ${isSelected ? cfg.color : 'var(--border)'}`,
                borderRadius: 12, padding: '16px 18px', cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{segmentLabels[seg.key] || seg.key}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: cfg.color }}>{seg.count}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {t('analytics.segmentContacts')}
              </div>
              {metricLine(seg) && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                  {metricLine(seg)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Contact table for selected segment */}
      {selectedSegment && (
        <div className="card">
          <div className="card-title">
            {SEGMENT_CONFIG[selectedSegment.key]?.icon} {segmentLabels[selectedSegment.key]} ({selectedSegment.count})
          </div>
          <div className="card-body">
            <div className="crm-table">
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>{en ? 'Name' : 'Nom'}</span>
                <span>Email</span>
                <span>{en ? 'Company' : 'Entreprise'}</span>
                <span>{en ? 'Churn' : 'Churn'}<HelpTip text={t('analytics.helpChurn')} /></span>
                <span>{en ? 'Value' : 'Valeur'}</span>
                <span>{en ? 'Last activity' : 'Derni\u00e8re activit\u00e9'}</span>
              </div>
              {(selectedSegment.contacts || []).map(c => (
                <div className="crm-table-row" key={c.id}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</span>
                  <span>{c.company}</span>
                  <span>
                    {c.churn_score > 0 ? <ScoreBadge score={c.churn_score} /> : '\u2014'}
                  </span>
                  <span>{c.deal_value > 0 ? `$${c.deal_value.toLocaleString()}` : '\u2014'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {c.last_activity ? new Date(c.last_activity).toLocaleDateString() : '\u2014'}
                  </span>
                </div>
              ))}
              {(selectedSegment.contacts || []).length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                  {t('analytics.segmentNoContacts')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hint when no segment selected */}
      {!selectedSegment && (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
          {t('analytics.segmentSelectToView')}
        </div>
      )}
    </div>
  );
}

/* ═══ Renewals Section ═══ */

function RenewalsSection({ data }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';

  const allContacts = useMemo(() => {
    const groups = [
      ...(data.overdue?.contacts || []),
      ...(data.next30?.contacts || []),
      ...(data.next60?.contacts || []),
      ...(data.next90?.contacts || []),
    ];
    return groups.sort((a, b) => a.days_until - b.days_until);
  }, [data]);

  function urgencyColor(days) {
    if (days < 0) return 'var(--danger)';
    if (days <= 30) return 'var(--orange, #f97316)';
    if (days <= 60) return 'var(--warning)';
    return 'var(--success)';
  }

  function urgencyBg(days) {
    if (days < 0) return 'rgba(239, 68, 68, 0.06)';
    if (days <= 30) return 'rgba(249, 115, 22, 0.06)';
    if (days <= 60) return 'rgba(234, 179, 8, 0.06)';
    return 'transparent';
  }

  return (
    <div className="crm-section">
      {/* KPI cards */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--danger)' }}>{data.overdue?.count || 0}</div>
          <div className="crm-kpi-label">{en ? 'Overdue' : 'En retard'}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--orange, #f97316)' }}>{data.next30?.count || 0}</div>
          <div className="crm-kpi-label">{en ? 'Next 30 days' : '30 prochains jours'}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--warning)' }}>{data.next60?.count || 0}</div>
          <div className="crm-kpi-label">{en ? 'Next 60 days' : '60 prochains jours'}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.next90?.count || 0}</div>
          <div className="crm-kpi-label">{en ? 'Next 90 days' : '90 prochains jours'}</div>
        </div>
      </div>

      {/* Contacts table */}
      <div className="card">
        <div className="card-title">{t('analytics.renewalsUpcoming')}</div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span style={{ flex: 2 }}>{en ? 'Name' : 'Nom'}</span>
              <span>Email</span>
              <span>{en ? 'Company' : 'Entreprise'}</span>
              <span>{en ? 'Renewal date' : 'Date renouvellement'}</span>
              <span>{en ? 'Days' : 'Jours'}</span>
              <span>{en ? 'Value' : 'Valeur'}</span>
            </div>
            {allContacts.map(c => (
              <div
                className="crm-table-row"
                key={c.id}
                style={{ background: urgencyBg(c.days_until) }}
              >
                <span style={{ flex: 2, fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</span>
                <span>{c.company}</span>
                <span style={{ fontSize: 12 }}>{c.renewal_date}</span>
                <span style={{ fontWeight: 700, color: urgencyColor(c.days_until) }}>
                  {c.days_until < 0
                    ? (en ? `${Math.abs(c.days_until)}d overdue` : `${Math.abs(c.days_until)}j en retard`)
                    : (en ? `${c.days_until}d` : `${c.days_until}j`)}
                </span>
                <span>{c.deal_value > 0 ? `$${c.deal_value.toLocaleString()}` : '\u2014'}</span>
              </div>
            ))}
            {allContacts.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                {t('analytics.renewalsEmpty')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Later count */}
      {(data.later?.count || 0) > 0 && (
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          {en
            ? `${data.later.count} more renewal(s) beyond 90 days`
            : `${data.later.count} renouvellement(s) suppl\u00e9mentaire(s) au-del\u00e0 de 90 jours`}
        </div>
      )}
    </div>
  );
}
