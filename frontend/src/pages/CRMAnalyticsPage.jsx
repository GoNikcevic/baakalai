/* ===============================================================================
   BAKAL — CRM Analytics Page
   Pipeline, Revenue Attribution, Lead Scoring, Trends, Channels, Health Score.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/useApp';
import api from '../services/api-client';
import { useT, useI18n } from '../i18n';
import EngagementChart from '../components/charts/EngagementChart';
import FunnelChart from '../components/charts/FunnelChart';

/* ─── Demo data ─── */

const DEMO_PIPELINE = {
  stages: [
    { stage: 'new', label: 'Nouveau', count: 12, percentage: 40 },
    { stage: 'interested', label: 'Intéressé', count: 8, percentage: 27 },
    { stage: 'meeting', label: 'RDV', count: 5, percentage: 17 },
    { stage: 'negotiation', label: 'Négociation', count: 3, percentage: 10 },
    { stage: 'won', label: 'Gagné', count: 2, percentage: 6 },
  ],
  conversions: [
    { from: 'new', to: 'interested', rate: 66.7 },
    { from: 'interested', to: 'meeting', rate: 62.5 },
    { from: 'meeting', to: 'negotiation', rate: 60.0 },
    { from: 'negotiation', to: 'won', rate: 66.7 },
  ],
  total: 30,
};

const DEMO_ATTRIBUTION = {
  campaigns: [
    { id: '1', name: 'DAF Île-de-France', channel: 'email', prospects: 150, meetings: 5, interested: 12, conversionRate: 3.3 },
    { id: '2', name: 'DRH PME Lyon', channel: 'email', prospects: 120, meetings: 3, interested: 8, conversionRate: 2.5 },
    { id: '3', name: 'Dirigeants Formation', channel: 'linkedin', prospects: 80, meetings: 4, interested: 10, conversionRate: 5.0 },
    { id: '4', name: 'CTO Scale-ups', channel: 'multi', prospects: 100, meetings: 2, interested: 6, conversionRate: 2.0 },
  ],
  totals: { prospects: 450, meetings: 14, interested: 36, avgConversion: 3.1 },
};

const DEMO_SCORING = {
  leads: [
    { id: '1', name: 'Marie Dupont', company: 'Acme Corp', title: 'DAF', status: 'meeting', score: 85, scoreBreakdown: { engagement: 45, fit: 40 }, campaign: 'DAF IDF' },
    { id: '2', name: 'Pierre Martin', company: 'TechStart', title: 'CTO', status: 'interested', score: 72, scoreBreakdown: { engagement: 35, fit: 37 }, campaign: 'CTO Scale-ups' },
    { id: '3', name: 'Sophie Leroy', company: 'FormaPro', title: 'Dirigeant', status: 'negotiation', score: 68, scoreBreakdown: { engagement: 40, fit: 28 }, campaign: 'Dirigeants Formation' },
    { id: '4', name: 'Jean Petit', company: 'FinanceRH', title: 'DRH', status: 'new', score: 45, scoreBreakdown: { engagement: 15, fit: 30 }, campaign: 'DRH PME Lyon' },
    { id: '5', name: 'Alice Bernard', company: 'DataFlow', title: 'VP Sales', status: 'interested', score: 38, scoreBreakdown: { engagement: 20, fit: 18 }, campaign: 'CTO Scale-ups' },
  ],
  distribution: { high: 2, medium: 1, low: 2 },
  avgScore: 61.6,
};

const DEMO_CHANNELS = {
  channels: [
    { channel: 'email', campaigns: 5, avgOpenRate: 55, avgReplyRate: 7.1, totalProspects: 400, interested: 20, meetings: 8 },
    { channel: 'linkedin', campaigns: 3, avgAcceptRate: 35, avgReplyRate: 9.2, totalProspects: 200, interested: 12, meetings: 4 },
    { channel: 'multi', campaigns: 2, avgOpenRate: 52, avgReplyRate: 6.8, totalProspects: 150, interested: 8, meetings: 3 },
  ],
  bestChannel: { channel: 'linkedin', metric: 'replyRate', value: 9.2 },
};

const DEMO_HEALTH = {
  score: 72,
  label: 'Bon',
  alerts: [
    { type: 'stale_leads', severity: 'warning', message: '5 leads sans activité depuis 7+ jours', count: 5 },
    { type: 'stuck_deals', severity: 'danger', message: '2 deals bloqués en négociation depuis 14+ jours', count: 2 },
    { type: 'no_followup', severity: 'info', message: '3 intéressés sans relance planifiée', count: 3 },
  ],
  breakdown: { pipelineVelocity: 65, leadQuality: 78, followupRate: 72, conversionHealth: 70 },
};

const DEMO_TRENDS = {
  weeks: [
    { label: 'S9', open: 48, reply: 5.2, linkedin: 28 },
    { label: 'S10', open: 52, reply: 6.1, linkedin: 32 },
    { label: 'S11', open: 55, reply: 6.8, linkedin: 34 },
    { label: 'S12', open: 58, reply: 7.4, linkedin: 36 },
  ],
};

/* ─── Helpers ─── */

const STAGE_COLORS = {
  new: 'var(--text-muted)',
  interested: 'var(--blue)',
  meeting: 'var(--success)',
  negotiation: 'var(--warning)',
  won: 'var(--purple)',
  lost: 'var(--danger)',
};

const STATUS_LABELS = {
  new: 'Nouveau',
  interested: 'Intéressé',
  meeting: 'RDV',
  negotiation: 'Négo',
  won: 'Gagné',
  lost: 'Perdu',
};

const CHANNEL_COLORS = {
  email: 'var(--blue)',
  linkedin: 'var(--purple)',
  multi: 'var(--orange)',
};

function ScoreBadge({ score }) {
  const color = score >= 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 36, padding: '2px 8px', borderRadius: 12,
      fontSize: 12, fontWeight: 700, color: 'white',
      background: color,
    }}>{score}</span>
  );
}

function HealthGauge({ score, label }) {
  const color = score > 80 ? 'var(--success)' : score > 60 ? 'var(--blue)' : score > 40 ? 'var(--warning)' : 'var(--danger)';
  const pct = Math.min(score, 100);
  return (
    <div className="crm-health-gauge">
      <div className="crm-health-score" style={{ color }}>{score}</div>
      <div className="crm-health-label">{label}</div>
      <div className="crm-health-bar">
        <div className="crm-health-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ─── Sections ─── */

const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'attribution', label: 'Attribution' },
  { key: 'scoring', label: 'Lead Scoring' },
  { key: 'trends', label: 'Tendances' },
  { key: 'channels', label: 'Canaux' },
  { key: 'health', label: 'Santé CRM' },
];

/* ═══ Main Component ═══ */

export default function CRMAnalyticsPage() {
  const { backendAvailable } = useApp();
  const [activeTab, setActiveTab] = useState('pipeline');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);

  const demoMode = typeof window !== 'undefined' && localStorage.getItem('bakal_demo_mode') === 'true';

  const fetchData = useCallback(async (tab) => {
    // Demo mode: always show demo data regardless of backend
    if (demoMode) {
      setData({
        pipeline: DEMO_PIPELINE,
        attribution: DEMO_ATTRIBUTION,
        scoring: DEMO_SCORING,
        channels: DEMO_CHANNELS,
        health: DEMO_HEALTH,
        trends: DEMO_TRENDS,
      });
      return;
    }
    // No backend + no demo → leave empty
    if (!backendAvailable) {
      setData({});
      return;
    }
    if (data[tab]) return; // cached
    setLoading(true);
    try {
      const result = await api.request('/analytics/' + tab);
      setData(prev => ({ ...prev, [tab]: result }));
    } catch {
      // Don't fall back to demo — leave the tab empty and let the UI render its empty state
      setData(prev => ({ ...prev, [tab]: null }));
    }
    setLoading(false);
  }, [backendAvailable, data, demoMode]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  const tabData = data[activeTab];

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">CRM Analytics</h1>
          <div className="page-subtitle">Pipeline, attribution, scoring et santé de votre CRM</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="crm-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`crm-tab${activeTab === t.key ? ' active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>}

      {!loading && activeTab === 'pipeline' && tabData && <PipelineSection data={tabData} />}
      {!loading && activeTab === 'attribution' && tabData && <AttributionSection data={tabData} />}
      {!loading && activeTab === 'scoring' && tabData && <ScoringSection data={tabData} />}
      {!loading && activeTab === 'trends' && tabData && <TrendsSection data={tabData} />}
      {!loading && activeTab === 'channels' && tabData && <ChannelsSection data={tabData} />}
      {!loading && activeTab === 'health' && <CRMHealthSection />}
    </div>
  );
}

/* ═══ Pipeline Section ═══ */

function PipelineSection({ data }) {
  const funnelStages = (data.stages || [])
    .filter(s => s.stage !== 'lost')
    .map(s => ({ label: s.label, value: s.count }));

  return (
    <div className="crm-section">
      {/* KPI row */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.total || 0}</div>
          <div className="crm-kpi-label">Total opportunités</div>
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
          <div className="card-title">Entonnoir du pipeline</div>
          <div className="card-body">
            <FunnelChart stages={funnelStages} />
          </div>
        </div>

        {/* Conversion rates */}
        <div className="card">
          <div className="card-title">Taux de conversion entre étapes</div>
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
          <div className="crm-kpi-label">Prospects total</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.totals?.meetings || 0}</div>
          <div className="crm-kpi-label">RDV obtenus</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>{data.totals?.interested || 0}</div>
          <div className="crm-kpi-label">Intéressés</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>{data.totals?.avgConversion || 0}%</div>
          <div className="crm-kpi-label">Conversion moy.</div>
        </div>
      </div>

      {/* Campaign table */}
      <div className="card">
        <div className="card-title">ROI par campagne</div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span style={{ flex: 2 }}>Campagne</span>
              <span>Canal</span>
              <span>Prospects</span>
              <span>Intéressés</span>
              <span>RDV</span>
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

function ScoringSection({ data }) {
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
          <div className="crm-kpi-label">Score moyen</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.distribution?.high || 0}</div>
          <div className="crm-kpi-label">Score élevé (70+)</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--warning)' }}>{data.distribution?.medium || 0}</div>
          <div className="crm-kpi-label">Score moyen (40-69)</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--danger)' }}>{data.distribution?.low || 0}</div>
          <div className="crm-kpi-label">Score faible (&lt;40)</div>
        </div>
      </div>

      {/* Filter + Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Scoreboard des leads</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'high', 'medium', 'low'].map(f => (
              <button
                key={f}
                className={`crm-filter-btn${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'Tous' : f === 'high' ? 'Élevé' : f === 'medium' ? 'Moyen' : 'Faible'}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span>Score</span>
              <span style={{ flex: 2 }}>Nom</span>
              <span>Entreprise</span>
              <span>Titre</span>
              <span>Statut</span>
              <span>Campagne</span>
              <span>Engagement</span>
              <span>Fit</span>
            </div>
            {filtered.map(l => (
              <div className="crm-table-row" key={l.id}>
                <span><ScoreBadge score={l.score} /></span>
                <span style={{ flex: 2, fontWeight: 600 }}>{l.name}</span>
                <span>{l.company}</span>
                <span style={{ color: 'var(--text-muted)' }}>{l.title}</span>
                <span>
                  <span className="crm-status-dot" style={{ background: STAGE_COLORS[l.status] || 'var(--text-muted)' }} />
                  {STATUS_LABELS[l.status] || l.status}
                </span>
                <span style={{ fontSize: 12 }}>{l.campaign}</span>
                <span style={{ color: 'var(--blue)' }}>{l.scoreBreakdown?.engagement || 0}</span>
                <span style={{ color: 'var(--purple)' }}>{l.scoreBreakdown?.fit || 0}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
                Aucun lead dans cette catégorie.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Trends Section ═══ */

function TrendsSection({ data }) {
  const chartData = useMemo(() => {
    if (data.weeks && data.weeks.length > 0) {
      return data.weeks.map(w => ({
        label: w.label,
        open: w.openRate ?? w.open ?? 0,
        reply: w.replyRate ?? w.reply ?? 0,
        linkedin: w.linkedin ?? 0,
      }));
    }
    return [];
  }, [data.weeks]);

  return (
    <div className="crm-section">
      <div className="card">
        <div className="card-title">Tendances KPI (semaine par semaine)</div>
        <div className="card-body">
          {chartData.length > 0 ? (
            <EngagementChart data={chartData} />
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Pas assez de données historiques. Les tendances s'afficheront après quelques semaines d'activité.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Channels Section ═══ */

function ChannelsSection({ data }) {
  const channels = data.channels || [];
  const best = data.bestChannel;

  return (
    <div className="crm-section">
      {/* Best channel highlight */}
      {best && (
        <div className="crm-highlight-card" style={{ borderColor: CHANNEL_COLORS[best.channel] }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Meilleur canal :</span>
          <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[best.channel], marginLeft: 8 }}>
            {best.channel}
          </span>
          <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
            {best.value}% taux de réponse
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
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ch.campaigns} campagnes</span>
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
                    <div className="crm-channel-stat-label">Ouverture</div>
                  </div>
                )}
                {ch.avgAcceptRate != null && (
                  <div className="crm-channel-stat">
                    <div className="crm-channel-stat-value">{ch.avgAcceptRate}%</div>
                    <div className="crm-channel-stat-label">Acceptation</div>
                  </div>
                )}
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value">{ch.avgReplyRate}%</div>
                  <div className="crm-channel-stat-label">Réponse</div>
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

/* ═══ CRM Health Section — Live Data Cleaning ═══ */

function getIssueConfig(en) { return {
  duplicate_email: { icon: '\uD83D\uDD04', label: en ? 'Duplicates (email)' : 'Doublons (email)', severity: 'high', color: 'var(--danger)' },
  duplicate_name: { icon: '\uD83D\uDC65', label: en ? 'Duplicates (name+company)' : 'Doublons (nom+entreprise)', severity: 'medium', color: 'var(--warning)' },
  missing_email: { icon: '\uD83D\uDCE7', label: en ? 'Missing email' : 'Email manquant', severity: 'high', color: 'var(--danger)' },
  missing_name: { icon: '\uD83D\uDC64', label: 'Nom manquant', severity: 'medium', color: 'var(--warning)' },
  missing_company: { icon: '\uD83C\uDFE2', label: 'Entreprise manquante', severity: 'low', color: 'var(--text-muted)' },
  invalid_email: { icon: '\u26A0\uFE0F', label: en ? 'Invalid email' : 'Email invalide', severity: 'high', color: 'var(--danger)' },
  inactive: { icon: '\uD83D\uDCA4', label: en ? 'Inactive contacts (6+ months)' : 'Contacts inactifs (6+ mois)', severity: 'low', color: 'var(--text-muted)' },
  format_name_caps: { icon: 'Aa', label: en ? 'Names in ALL CAPS' : 'Noms en MAJUSCULES', severity: 'low', color: 'var(--blue)' },
}; }

function CRMHealthSection() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const ISSUE_CONFIG = getIssueConfig(en);
  const [report, setReport] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [fixing, setFixing] = useState(null);
  const [fixResults, setFixResults] = useState(null);
  const [provider] = useState('pipedrive');

  const handleScan = useCallback(async () => {
    setScanning(true);
    setReport(null);
    setFixResults(null);
    try {
      const result = await api.request(`/crm/scan/${provider}`, { method: 'POST' });
      setReport(result);
    } catch (err) {
      setReport({ error: err.message });
    }
    setScanning(false);
  }, [provider]);

  // Auto-scan on mount
  useEffect(() => { handleScan(); }, []);

  const handleFix = useCallback(async (issue) => {
    setFixing(issue.type);
    try {
      let fixes = [];
      if (issue.type === 'format_name_caps') {
        fixes = [{ type: issue.type, action: 'auto_fix_caps', contacts: issue.contacts }];
      } else if (issue.suggestedAction === 'delete' || issue.suggestedAction === 'archive') {
        fixes = [{ type: issue.type, action: 'delete', contactIds: issue.contacts.map(c => c.id) }];
      } else if (issue.suggestedAction === 'merge' && issue.contacts.length >= 2) {
        fixes = [{ type: issue.type, action: 'merge', contactIds: issue.contacts.map(c => c.id) }];
      }
      if (fixes.length > 0) {
        const result = await api.request(`/crm/clean/${provider}`, {
          method: 'POST',
          body: JSON.stringify({ reportId: report?.reportId, fixes }),
        });
        setFixResults(prev => ({ ...(prev || {}), [issue.type]: result }));
        // Re-scan after fix
        setTimeout(handleScan, 1000);
      }
    } catch (err) {
      setFixResults(prev => ({ ...(prev || {}), [issue.type]: { error: err.message } }));
    }
    setFixing(null);
  }, [provider, report, handleScan]);

  if (scanning) {
    return (
      <div className="crm-section" style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>{'\uD83D\uDD0D'}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{en ? 'CRM scan in progress...' : 'Scan CRM en cours...'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{en ? 'Analyzing Pipedrive contacts' : 'Analyse des contacts Pipedrive'}</div>
      </div>
    );
  }

  if (report?.error) {
    return (
      <div className="crm-section">
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 14, color: 'var(--danger)' }}>{report.error}</div>
            <button className="btn btn-primary" style={{ marginTop: 16, fontSize: 12 }} onClick={handleScan}>
              {en ? 'Retry' : 'R\u00E9essayer'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const scoreColor = report.score >= 80 ? 'var(--success)' : report.score >= 50 ? 'var(--warning)' : 'var(--danger)';
  const scoreLabel = report.score >= 80 ? 'Excellent' : report.score >= 50 ? 'Bon' : report.score < 30 ? 'Critique' : 'À améliorer';
  const summary = report.summary || {};

  return (
    <div className="crm-section">
      {/* Score + Summary */}
      <div className="crm-grid-2">
        <div className="card">
          <div className="card-title">{en ? 'CRM Health Score' : 'Score de sant\u00E9 CRM'}</div>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'center' }}>
            <HealthGauge score={report.score} label={scoreLabel} />
          </div>
          <div style={{ textAlign: 'center', padding: '0 16px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
            {report.totalContacts} {en ? 'contacts analyzed' : 'contacts analys\u00E9s'}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{en ? 'Summary' : 'R\u00E9sum\u00E9'}</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: en ? 'Email duplicates' : 'Doublons email', value: summary.duplicateEmails || 0, color: 'var(--danger)' },
                { label: en ? 'Name duplicates' : 'Doublons nom', value: summary.duplicateNames || 0, color: 'var(--warning)' },
                { label: 'Emails manquants', value: summary.missingEmails || 0, color: 'var(--danger)' },
                { label: 'Emails invalides', value: summary.invalidEmails || 0, color: 'var(--danger)' },
                { label: en ? 'Inactive contacts' : 'Contacts inactifs', value: summary.inactive || 0, color: 'var(--text-muted)' },
                { label: 'Problèmes de format', value: summary.formatIssues || 0, color: 'var(--blue)' },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>{item.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: item.value > 0 ? item.color : 'var(--success)' }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Issues list with action buttons */}
      {(report.issues || []).length > 0 && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {report.issues.map((issue, i) => {
            const config = ISSUE_CONFIG[issue.type] || { icon: '?', label: issue.type, color: 'var(--text-muted)' };
            const count = issue.count || issue.contacts?.length || 0;
            const fixResult = fixResults?.[issue.type];
            const isFixing = fixing === issue.type;

            return (
              <div key={i} className="card" style={{ borderLeft: `3px solid ${config.color}` }}>
                <div className="card-body" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {config.icon} {config.label}
                        <span style={{ fontSize: 12, color: config.color, marginLeft: 8 }}>{count} contact{count > 1 ? 's' : ''}</span>
                      </div>
                      {/* Preview of affected contacts */}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {(issue.contacts || []).slice(0, 3).map(c => c.name || c.email || '?').join(', ')}
                        {count > 3 && ` +${count - 3} autres`}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {fixResult && !fixResult.error && (
                        <span style={{ fontSize: 11, color: 'var(--success)' }}>
                          {'\u2705'} {fixResult.applied} corrigé{fixResult.applied > 1 ? 's' : ''}
                        </span>
                      )}
                      {fixResult?.error && (
                        <span style={{ fontSize: 11, color: 'var(--danger)' }}>{fixResult.error}</span>
                      )}
                      {issue.suggestedAction && !fixResult && (
                        <button
                          className="btn btn-ghost"
                          style={{
                            fontSize: 11,
                            padding: '4px 12px',
                            border: `1px solid ${config.color}`,
                            color: config.color,
                          }}
                          disabled={isFixing}
                          onClick={() => handleFix(issue)}
                        >
                          {isFixing ? '\u23F3...' :
                            issue.suggestedAction === 'merge' ? (en ? 'Merge' : 'Fusionner') :
                            issue.suggestedAction === 'auto_fix' ? (en ? 'Fix' : 'Corriger') :
                            issue.suggestedAction === 'enrich' ? (en ? 'Enrich' : 'Enrichir') :
                            issue.suggestedAction === 'archive' ? (en ? 'Archive' : 'Archiver') :
                            issue.suggestedAction === 'fix' ? (en ? 'Fix' : 'Corriger') :
                            (en ? 'View' : 'Voir')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(report.issues || []).length === 0 && (
        <div className="card" style={{ marginTop: 20, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{'\u2705'}</div>
          <div style={{ fontSize: 14, color: 'var(--success)', fontWeight: 600 }}>{en ? 'CRM clean — no issues detected' : 'CRM propre — aucun probl\u00E8me d\u00E9tect\u00E9'}</div>
        </div>
      )}

      {/* Rescan button */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '8px 20px', color: 'var(--text-muted)' }}
          onClick={handleScan}
        >
          {'\uD83D\uDD04'} {en ? 'Run scan again' : 'Relancer le scan'}
        </button>
      </div>
    </div>
  );
}
