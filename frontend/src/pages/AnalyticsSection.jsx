/* ===============================================================================
   BAKAL — Analytics Section (React)
   Ported from app/analytics.js.
   KPI row, period selector, SVG line chart, campaign bars, channel breakdown,
   conversion funnel, empty state.
   Used as a tab within the Dashboard page.
   =============================================================================== */

import { useState, useMemo } from 'react';
import { useApp } from '../context/useApp';

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

/* ─── SVG Line Chart (pure function, returns SVG string) ─── */

function buildLineChartSvg(data, lines, options = {}) {
  const width = 700;
  const height = 200;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 10;
  const paddingBottom = 30;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Find max value for scaling
  let maxVal = 0;
  lines.forEach(line => {
    data.forEach(d => {
      const v = d[line.key];
      if (v > maxVal) maxVal = v;
    });
  });
  maxVal = Math.ceil(maxVal / 10) * 10 || 100;

  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
  const suffix = options.suffix || '%';

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width:100%;height:100%;">`;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = paddingTop + (chartHeight / 4) * i;
    const val = Math.round(maxVal - (maxVal / 4) * i);
    svg += `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="4,4"/>`;
    svg += `<text x="${paddingLeft - 8}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end" font-family="Inter, sans-serif">${val}${suffix}</text>`;
  }

  // X-axis labels
  data.forEach((d, i) => {
    const x = paddingLeft + i * xStep;
    svg += `<text x="${x}" y="${height - 5}" fill="var(--text-muted)" font-size="10" text-anchor="middle" font-family="Inter, sans-serif">${d.label}</text>`;
  });

  // Draw each line
  lines.forEach(line => {
    const points = data.map((d, i) => {
      const x = paddingLeft + i * xStep;
      const y = paddingTop + chartHeight - (d[line.key] / maxVal) * chartHeight;
      return `${x},${y}`;
    }).join(' ');

    const firstX = paddingLeft;
    const lastX = paddingLeft + (data.length - 1) * xStep;
    const bottomY = paddingTop + chartHeight;

    // Area fill
    svg += `<polygon points="${firstX},${bottomY} ${points} ${lastX},${bottomY}" fill="${line.color}" opacity="0.06"/>`;
    // Line
    svg += `<polyline points="${points}" fill="none" stroke="${line.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    // Dots
    data.forEach((d, i) => {
      const x = paddingLeft + i * xStep;
      const y = paddingTop + chartHeight - (d[line.key] / maxVal) * chartHeight;
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${line.color}" stroke="var(--bg-card)" stroke-width="2"/>`;
    });
  });

  svg += '</svg>';
  return svg;
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
      : '—';
    const replyVal = globalKpis.replyRate
      ? (typeof globalKpis.replyRate === 'object' ? globalKpis.replyRate.value : globalKpis.replyRate)
      : '—';

    return { openRate: openVal, replyRate: replyVal, interested: totalInterested, meetings: totalMeetings };
  }, [activeCampaigns, globalKpis]);

  /* ─── Engagement chart SVG ─── */

  const engagementSvg = useMemo(() => {
    const data = ANALYTICS_DATA[period] || ANALYTICS_DATA['4w'];
    return buildLineChartSvg(data, [
      { key: 'open', color: 'var(--blue)' },
      { key: 'reply', color: 'var(--success)' },
      { key: 'linkedin', color: 'var(--purple)' },
    ]);
  }, [period]);

  /* ─── Campaign performance bars ─── */

  const campaignPerfHtml = useMemo(() => {
    if (activeCampaigns.length === 0) {
      return '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px;">Aucune campagne active pour le moment.</div>';
    }
    let html = '';
    activeCampaigns.forEach(c => {
      const isLinkedin = c.channel === 'linkedin';
      const openRate = isLinkedin ? null : c.kpis?.openRate;
      const replyRate = c.kpis?.replyRate;

      html += `<div class="campaign-perf-row"><div class="campaign-perf-name">${c.name}</div><div class="campaign-perf-bars">`;

      if (openRate !== null && openRate !== undefined) {
        const openColor = openRate >= 50 ? 'var(--success)' : 'var(--warning)';
        html += `<div style="flex:1;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Ouverture</div><div class="campaign-perf-bar-track"><div class="campaign-perf-bar-fill" style="width:${openRate}%;background:${openColor};"></div></div></div><div class="campaign-perf-value" style="color:${openColor}">${openRate}%</div>`;
      }

      if (replyRate !== null && replyRate !== undefined) {
        const replyColor = replyRate >= 8 ? 'var(--blue)' : 'var(--warning)';
        html += `<div style="flex:1;"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">Réponse</div><div class="campaign-perf-bar-track"><div class="campaign-perf-bar-fill" style="width:${Math.min(replyRate * 10, 100)}%;background:${replyColor};"></div></div></div><div class="campaign-perf-value" style="color:${replyColor}">${replyRate}%</div>`;
      }

      html += `</div></div>`;
    });
    return html;
  }, [activeCampaigns]);

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
      { label: 'Contactés', value: totalContacts, color: 'var(--text-muted)', width: 100 },
      { label: 'Ouvert', value: opened, color: 'var(--blue)', width: Math.round(avgOpen) || 60 },
      { label: 'Répondu', value: replied, color: 'var(--success)', width: Math.min(Math.round(8.1 * 5), 50) },
      { label: 'Intéressé', value: totalInterested, color: 'var(--warning)', width: Math.round(totalInterested / (totalContacts || 1) * 100 * 5) || 15 },
      { label: 'RDV', value: totalMeetings, color: 'var(--purple)', width: Math.round(totalMeetings / (totalContacts || 1) * 100 * 10) || 8 },
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
            Les graphiques de performance s'afficheront dès que votre première campagne sera active avec des données de prospection.
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
          <div className="analytics-kpi-value" id="analytics-open-rate">{kpis.openRate}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">Taux de réponse</div>
          <div className="analytics-kpi-value" id="analytics-reply-rate">{kpis.replyRate}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">Intéressés</div>
          <div className="analytics-kpi-value" id="analytics-interested">{kpis.interested}</div>
        </div>
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-label">RDV obtenus</div>
          <div className="analytics-kpi-value" id="analytics-meetings">{kpis.meetings}</div>
        </div>
      </div>

      {/* Engagement Trends */}
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
          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '11px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--blue)', display: 'inline-block' }} />
              Ouverture
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
              Réponse
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--purple)', display: 'inline-block' }} />
              LinkedIn
            </span>
          </div>
          <div
            id="engagementChartWrap"
            style={{ width: '100%', height: '200px' }}
            dangerouslySetInnerHTML={{ __html: engagementSvg }}
          />
        </div>
      </div>

      {/* Campaign Performance */}
      <div className="card">
        <div className="card-title">Performance par campagne</div>
        <div
          className="card-body"
          id="campaignPerfChart"
          dangerouslySetInnerHTML={{ __html: campaignPerfHtml }}
        />
      </div>

      {/* Channel Breakdown + Funnel — side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Channel Breakdown */}
        <div className="card">
          <div className="card-title">Répartition par canal</div>
          <div className="card-body" id="channelBreakdown">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Channel bars */}
              <div style={{ display: 'flex', gap: '4px', height: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ flex: channelData.emailCount, background: 'var(--blue)', borderRadius: '6px 0 0 6px' }} />
                <div style={{ flex: channelData.linkedinCount, background: 'var(--purple)' }} />
                <div style={{ flex: channelData.multiCount, background: 'var(--orange)', borderRadius: '0 6px 6px 0' }} />
              </div>

              {/* Channel details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {/* Email */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--blue)' }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Email</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{channelData.emailCount} campagne{channelData.emailCount !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--blue)' }}>{channelData.avgOpenRate}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Ouverture moy.</div>
                  </div>
                </div>

                {/* LinkedIn */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--purple)' }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>LinkedIn</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{channelData.linkedinCount} campagne{channelData.linkedinCount !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--purple)' }}>{channelData.avgAcceptRate}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Accept. moy.</div>
                  </div>
                </div>

                {/* Multi-canal */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: 'var(--orange)' }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>Multi-canal</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{channelData.multiCount} campagne{channelData.multiCount !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--orange)' }}>{Math.round(channelData.multiCount / channelData.total * 100)}%</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>du portefeuille</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Conversion Funnel */}
        <div className="card">
          <div className="card-title">Entonnoir de conversion</div>
          <div className="card-body" id="funnelChart">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
              {funnelStages.map((stage, i) => {
                const w = Math.max(stage.width, 8);
                const totalContacts = funnelStages[0].value || 1;
                return (
                  <div key={stage.label}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                      <div style={{ width: '80px', textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>{stage.label}</div>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: `${w}%`,
                          height: '36px',
                          background: stage.color,
                          borderRadius: '6px',
                          opacity: 1 - i * 0.15,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'width 0.6s ease',
                          minWidth: '40px',
                        }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{stage.value}</span>
                        </div>
                        {i > 0 && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {totalContacts > 0 ? (stage.value / totalContacts * 100).toFixed(1) : 0}%
                          </span>
                        )}
                      </div>
                    </div>
                    {i < funnelStages.length - 1 && (
                      <div style={{ width: '2px', height: '8px', background: 'var(--border)', marginLeft: '88px' }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
