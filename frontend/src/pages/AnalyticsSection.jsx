/* ===============================================================================
   BAKAL — Analytics Section (React + Recharts)
   KPI row, period selector, engagement line chart, campaign perf bars,
   channel breakdown, conversion funnel.
   =============================================================================== */

import { useState, useMemo } from 'react';
import { useApp } from '../context/useApp';
import EngagementChart from '../components/charts/EngagementChart';
import FunnelChart from '../components/charts/FunnelChart';

/* ─── Chart data for different periods ─── */

const ANALYTICS_DATA = {
  '4w': [
    { label: 'S1', open: 51, reply: 5.2, linkedin: 30 },
    { label: 'S2', open: 58, reply: 6.8, linkedin: 35 },
    { label: 'S3', open: 60, reply: 7.1, linkedin: 38 },
    { label: 'S4', open: 62, reply: 8.1, linkedin: 38 },
  ],
  '8w': [
    { label: 'S1', open: 42, reply: 3.5, linkedin: 22 },
    { label: 'S2', open: 45, reply: 4.1, linkedin: 25 },
    { label: 'S3', open: 48, reply: 4.8, linkedin: 28 },
    { label: 'S4', open: 51, reply: 5.2, linkedin: 30 },
    { label: 'S5', open: 54, reply: 5.9, linkedin: 32 },
    { label: 'S6', open: 58, reply: 6.8, linkedin: 35 },
    { label: 'S7', open: 60, reply: 7.1, linkedin: 38 },
    { label: 'S8', open: 62, reply: 8.1, linkedin: 38 },
  ],
  '12w': [
    { label: 'S1', open: 35, reply: 2.8, linkedin: 18 },
    { label: 'S2', open: 38, reply: 3.0, linkedin: 20 },
    { label: 'S3', open: 40, reply: 3.2, linkedin: 22 },
    { label: 'S4', open: 42, reply: 3.5, linkedin: 22 },
    { label: 'S5', open: 45, reply: 4.1, linkedin: 25 },
    { label: 'S6', open: 48, reply: 4.8, linkedin: 28 },
    { label: 'S7', open: 51, reply: 5.2, linkedin: 30 },
    { label: 'S8', open: 54, reply: 5.9, linkedin: 32 },
    { label: 'S9', open: 58, reply: 6.8, linkedin: 35 },
    { label: 'S10', open: 60, reply: 7.1, linkedin: 38 },
    { label: 'S11', open: 61, reply: 7.8, linkedin: 38 },
    { label: 'S12', open: 62, reply: 8.1, linkedin: 38 },
  ],
};

const PERIODS = ['4w', '8w', '12w'];

/* ─── Campaign Performance Row (React) ─── */

function CampaignPerfRow({ campaign }) {
  const isLinkedin = campaign.channel === 'linkedin';
  const openRate = isLinkedin ? null : campaign.kpis?.openRate;
  const replyRate = campaign.kpis?.replyRate;

  return (
    <div className="campaign-perf-row">
      <div className="campaign-perf-name">{campaign.name}</div>
      <div className="campaign-perf-bars">
        {openRate != null && (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Ouverture</div>
              <div className="campaign-perf-bar-track">
                <div
                  className="campaign-perf-bar-fill"
                  style={{ width: `${openRate}%`, background: openRate >= 50 ? 'var(--success)' : 'var(--warning)' }}
                />
              </div>
            </div>
            <div className="campaign-perf-value" style={{ color: openRate >= 50 ? 'var(--success)' : 'var(--warning)' }}>
              {openRate}%
            </div>
          </>
        )}
        {replyRate != null && (
          <>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px' }}>Reponse</div>
              <div className="campaign-perf-bar-track">
                <div
                  className="campaign-perf-bar-fill"
                  style={{ width: `${Math.min(replyRate * 10, 100)}%`, background: replyRate >= 8 ? 'var(--blue)' : 'var(--warning)' }}
                />
              </div>
            </div>
            <div className="campaign-perf-value" style={{ color: replyRate >= 8 ? 'var(--blue)' : 'var(--warning)' }}>
              {replyRate}%
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Component ─── */

export default function AnalyticsSection({ onNavigate }) {
  const { campaigns, globalKpis } = useApp();

  const [period, setPeriod] = useState('4w');

  const campaignList = useMemo(() => Object.values(campaigns), [campaigns]);
  const activeCampaigns = useMemo(() => campaignList.filter(c => c.status === 'active'), [campaignList]);
  const isEmpty = campaignList.length === 0;

  /* ─── KPIs ─── */

  const kpis = useMemo(() => {
    const totalInterested = activeCampaigns.reduce((s, c) => s + (c.kpis?.interested || 0), 0);
    const totalMeetings = activeCampaigns.reduce((s, c) => s + (c.kpis?.meetings || 0), 0);

    const openVal = globalKpis.openRate
      ? (typeof globalKpis.openRate === 'object' ? globalKpis.openRate.value : globalKpis.openRate)
      : '\u2014';
    const replyVal = globalKpis.replyRate
      ? (typeof globalKpis.replyRate === 'object' ? globalKpis.replyRate.value : globalKpis.replyRate)
      : '\u2014';

    return { openRate: openVal, replyRate: replyVal, interested: totalInterested, meetings: totalMeetings };
  }, [activeCampaigns, globalKpis]);

  /* ─── Engagement chart data ─── */

  const engagementData = useMemo(() => ANALYTICS_DATA[period] || ANALYTICS_DATA['4w'], [period]);

  /* ─── Channel breakdown ─── */

  const channelData = useMemo(() => {
    let emailCount = 0, linkedinCount = 0, multiCount = 0;
    campaignList.forEach(c => {
      if (c.channel === 'email') emailCount++;
      else if (c.channel === 'linkedin') linkedinCount++;
      else multiCount++;
    });
    const total = campaignList.length || 1;

    const emailCampaigns = activeCampaigns.filter(c => c.channel === 'email');
    const avgOpenRate = emailCampaigns.length > 0
      ? Math.round(emailCampaigns.reduce((s, c) => s + (c.kpis?.openRate || 0), 0) / emailCampaigns.length)
      : 0;

    const linkedinCampaigns = activeCampaigns.filter(c => c.channel === 'linkedin');
    const avgAcceptRate = linkedinCampaigns.length > 0
      ? Math.round(linkedinCampaigns.reduce((s, c) => s + (c.kpis?.acceptRate || 0), 0) / linkedinCampaigns.length)
      : 0;

    return { emailCount, linkedinCount, multiCount, total, avgOpenRate, avgAcceptRate };
  }, [campaignList, activeCampaigns]);

  /* ─── Funnel ─── */

  const funnelStages = useMemo(() => {
    const totalContacts = activeCampaigns.reduce((s, c) => s + (c.kpis?.contacts || 0), 0);
    const openRates = activeCampaigns.filter(c => c.kpis?.openRate);
    const avgOpen = openRates.length > 0
      ? openRates.reduce((s, c) => s + c.kpis.openRate, 0) / openRates.length
      : 0;
    const totalInterested = activeCampaigns.reduce((s, c) => s + (c.kpis?.interested || 0), 0);
    const totalMeetings = activeCampaigns.reduce((s, c) => s + (c.kpis?.meetings || 0), 0);

    const opened = Math.round(totalContacts * avgOpen / 100);
    const replied = Math.round(totalContacts * 0.081);

    return [
      { label: 'Contactes', value: totalContacts },
      { label: 'Ouvert', value: opened },
      { label: 'Repondu', value: replied },
      { label: 'Interesse', value: totalInterested },
      { label: 'RDV', value: totalMeetings },
    ];
  }, [activeCampaigns]);

  /* ─── Empty state ─── */

  if (isEmpty) {
    return (
      <div id="section-analytics">
        <div className="empty-state">
          <div className="empty-state-icon">{'📈'}</div>
          <div className="empty-state-title">Analytics non disponibles</div>
          <div className="empty-state-desc">
            Les graphiques de performance s'afficheront des que votre premiere campagne sera active avec des donnees de prospection.
          </div>
          {onNavigate && (
            <button className="btn btn-ghost" onClick={() => onNavigate('overview')}>
              Retour au dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ─── Main render ─── */

  return (
    <div id="section-analytics">

      {/* KPI Row */}
      <div className="analytics-kpi-row">
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">Taux d'ouverture</div>
          <div className="analytics-kpi-value">{kpis.openRate}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">Taux de reponse</div>
          <div className="analytics-kpi-value">{kpis.replyRate}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">Interesses</div>
          <div className="analytics-kpi-value">{kpis.interested}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">RDV obtenus</div>
          <div className="analytics-kpi-value">{kpis.meetings}</div>
        </div>
      </div>

      {/* Engagement Trends — Recharts */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Tendances d'engagement</div>
          <div className="analytics-period-selector">
            {PERIODS.map(p => (
              <button
                key={p}
                className={`analytics-period-btn${period === p ? ' active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="card-body">
          <EngagementChart data={engagementData} />
        </div>
      </div>

      {/* Campaign Performance — React components instead of innerHTML */}
      <div className="card">
        <div className="card-title">Performance par campagne</div>
        <div className="card-body">
          {activeCampaigns.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Aucune campagne active pour le moment.
            </div>
          ) : (
            activeCampaigns.map(c => <CampaignPerfRow key={c.id} campaign={c} />)
          )}
        </div>
      </div>

      {/* Channel Breakdown + Funnel — side by side, responsive */}
      <div className="analytics-bottom-grid">

        {/* Channel Breakdown */}
        <div className="card">
          <div className="card-title">Repartition par canal</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Channel bars */}
              <div style={{ display: 'flex', gap: '4px', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ flex: channelData.emailCount, background: 'var(--blue)', borderRadius: '6px 0 0 6px' }} />
                <div style={{ flex: channelData.linkedinCount, background: 'var(--purple)' }} />
                <div style={{ flex: channelData.multiCount, background: 'var(--orange)', borderRadius: '0 6px 6px 0' }} />
              </div>

              {/* Channel details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <ChannelRow label="Email" count={channelData.emailCount} color="var(--blue)" value={`${channelData.avgOpenRate}%`} metric="Ouverture moy." />
                <ChannelRow label="LinkedIn" count={channelData.linkedinCount} color="var(--purple)" value={`${channelData.avgAcceptRate}%`} metric="Accept. moy." />
                <ChannelRow label="Multi-canal" count={channelData.multiCount} color="var(--orange)" value={`${Math.round(channelData.multiCount / channelData.total * 100)}%`} metric="du portefeuille" />
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Funnel — Recharts */}
        <div className="card">
          <div className="card-title">Entonnoir de conversion</div>
          <div className="card-body">
            <FunnelChart stages={funnelStages} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Channel Row helper ─── */

function ChannelRow({ label, count, color, value, metric }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color }} />
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{count} campagne{count !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color }}>{value}</div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{metric}</div>
      </div>
    </div>
  );
}
