/* ═══════════════════════════════════════════════════
   Dashboard — Activation tab
   Emailing/campaigns engine: KPIs, campaigns table, performance
   chart, AI recommendations, deliverability, ICP insights.
   What the old OverviewSection was, minus the Opportunities card
   (moved to CrmTab — scoring/CRM-export is a CRM-data operation,
   not an emailing metric).
   ═══════════════════════════════════════════════════ */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT, useI18n } from '../../i18n';
import { CumulativeValueBanner, BenchmarkBadge } from '../RetentionBiases';
import PerformanceChart from '../charts/PerformanceChart';
import { sanitizeHtml } from '../../services/sanitize';
import AnimatedCounter from '../AnimatedCounter';
import ICPInsightsCard from '../ICPInsightsCard';
import DeliverabilityCard from '../DeliverabilityCard';
import { sendRecoFeedback } from '../../services/api-client';
import Icon from '../Icon';

// Une icône par KPI — partagée entre la grille remplie et l'état vide.
const KPI_ICONS = {
  contacts: 'send',
  openRate: 'inbox',
  replyRate: 'message',
  interested: 'flame',
  meetings: 'calendar',
  stops: 'ban',
};

const KPI_LABELS = {
  fr: {
    contacts: 'Contacts atteints',
    openRate: "Taux d'ouverture",
    replyRate: 'Taux de réponse',
    interested: 'Prospects intéressés',
    meetings: 'RDV qualifiés',
    stops: 'Stops',
  },
  en: {
    contacts: 'Contacts reached',
    openRate: 'Open rate',
    replyRate: 'Reply rate',
    interested: 'Interested prospects',
    meetings: 'Qualified meetings',
    stops: 'Stops',
  },
};

export default function ActivationTab({ isEmpty, globalKpis, campaigns, recommendations, chartData, onCreateCampaign }) {
  return (
    <div>
      {isEmpty ? (
        <>
          <EmptyKpis />
          <EmptyOverviewGrid onCreateCampaign={onCreateCampaign} />
        </>
      ) : (
        <NonEmptyActivation
          globalKpis={globalKpis}
          campaigns={campaigns}
          recommendations={recommendations}
          chartData={chartData}
        />
      )}
      {campaigns.length >= 1 && <DeliverabilityCard />}
      {campaigns.length >= 3 && <ICPInsightsCard />}
    </div>
  );
}

function NonEmptyActivation({ globalKpis, campaigns, recommendations, chartData }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [ratedRecos, setRatedRecos] = useState({});

  const handleRecoFeedback = useCallback(async (idx, rec, feedback) => {
    setRatedRecos(prev => ({ ...prev, [idx]: feedback }));
    try {
      await sendRecoFeedback(rec.patternId || null, rec.text || '', feedback);
    } catch {
      /* ignore errors silently */
    }
  }, []);

  return (
    <div>
      {/* KPI Grid */}
      <div className="kpi-grid">
        {Object.entries(globalKpis).map(([key, k]) => (
          <div className="kpi-card" key={key}>
            <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name={KPI_ICONS[key]} size={14} />
              <span>{(en ? KPI_LABELS.en[key] : KPI_LABELS.fr[key]) || key}</span>
            </div>
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

      {/* Section grid */}
      <div className="section-grid">
        {/* Campaigns table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t('dashboard.activeCampaigns')}</div>
            <Link
              to="/campaigns"
              state={{ openHistory: true }}
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

        {/* AI Recommendations */}
        <div className="card">
          <div className="card-header">
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="bulb" size={16} color="var(--accent)" />
              <span>{en ? 'Baakalai Recommendations' : 'Recommandations Baakalai'}</span>
            </div>
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
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, color: 'var(--text-muted)' }}
                              title={en ? 'Useful' : 'Utile'}
                              aria-label={en ? 'Useful' : 'Utile'}
                            ><Icon name="thumbsUp" size={14} /></button>
                            <button
                              onClick={() => handleRecoFeedback(i, rec, 'not_useful')}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', lineHeight: 1, color: 'var(--text-muted)' }}
                              title={en ? 'Not useful' : 'Pas utile'}
                              aria-label={en ? 'Not useful' : 'Pas utile'}
                            ><Icon name="thumbsDown" size={14} /></button>
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
    <span className="status-badge status-prep">
      <Icon name="clock" size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{en ? 'Preparing' : 'En préparation'}
    </span>
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

/* ═══ Empty states ═══ */

function EmptyKpis() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const labels = en ? KPI_LABELS.en : KPI_LABELS.fr;

  return (
    <div className="kpi-grid">
      {Object.keys(KPI_ICONS).map((key) => (
        <div className="kpi-card" key={key}>
          <div className="kpi-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name={KPI_ICONS[key]} size={14} />
            <span>{labels[key]}</span>
          </div>
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
  const { lang } = useI18n();
  const en = lang === 'en';
  return (
    <div className="card card-empty">
      <div className="card-header">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="target" size={16} color="var(--accent)" />
          <span>{en ? 'Active campaigns' : 'Campagnes actives'}</span>
        </div>
      </div>
      <div className="card-body">
        <div className="empty-icon" style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'center' }}>
          <Icon name="inbox" size={40} strokeWidth={1.5} />
        </div>
        <div className="empty-text">
          {en ? 'No campaigns yet. Create your first campaign to see your performance here.'
            : 'Aucune campagne pour le moment. Créez votre première campagne pour voir vos performances ici.'}
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: '16px', fontSize: '13px' }}
          onClick={onCreateCampaign}
        >
          {en ? 'Create a campaign' : 'Créer une campagne'}
        </button>
      </div>
    </div>
  );
}
