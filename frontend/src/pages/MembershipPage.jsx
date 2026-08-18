import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { useI18n } from '../i18n';

const CHURN_COLORS = { critical: '#DC2626', high: '#F59E0B', medium: '#6E57FA', low: '#16A34A' };

export default function MembershipPage() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request('/analytics/membership')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{en ? 'No data available' : 'Aucune donnée disponible'}</div>;

  const k = data.kpis || {};

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1 className="page-title">{en ? 'Membership Analytics' : 'Analytics Clients'}</h1>
        <div className="page-subtitle">{en ? 'Tenure, LTV, churn distribution, renewal pipeline' : 'Tenure, LTV, distribution churn, pipeline de renouvellement'}</div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: en ? 'Total clients' : 'Clients total', value: k.total_won || 0, color: '#6E57FA' },
          { label: en ? 'At risk' : 'À risque', value: k.at_risk || 0, color: '#DC2626' },
          { label: en ? 'Avg lead value' : 'Valeur moyenne', value: k.avg_deal_value ? `${k.avg_deal_value}€` : '—', color: '#16A34A' },
          { label: en ? 'Total revenue' : 'Revenu total', value: k.total_revenue ? `${Number(k.total_revenue).toLocaleString()}€` : '—', color: '#16A34A' },
          { label: en ? 'Avg cycle' : 'Cycle moyen', value: k.avg_cycle_days ? `${k.avg_cycle_days}j` : '—' },
          { label: en ? 'Avg churn score' : 'Score churn moyen', value: k.avg_churn_score || '—', color: k.avg_churn_score >= 50 ? '#DC2626' : '#F59E0B' },
        ].map((kpi, i) => (
          <div key={i} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color || 'var(--text-primary)' }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Churn distribution */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Churn Distribution' : 'Distribution Churn'}</div>
          {(data.churnDistribution || []).map(b => (
            <div key={b.band} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 70, fontSize: 12, fontWeight: 600, color: CHURN_COLORS[b.band] || '#737373', textTransform: 'capitalize' }}>{b.band}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 4, background: CHURN_COLORS[b.band] || '#6E57FA', width: `${Math.min((parseInt(b.count) / Math.max(parseInt(k.total_contacts) || 1, 1)) * 100, 100)}%` }} />
              </div>
              <span style={{ width: 40, fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{b.count}</span>
            </div>
          ))}
        </div>

        {/* Tenure distribution */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Client Tenure' : 'Ancienneté clients'}</div>
          {(data.tenure || []).map(t => (
            <div key={t.band} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span>{t.band}</span>
              <span style={{ fontWeight: 600 }}>{t.count} {en ? 'clients' : 'clients'}{t.total_value ? ` · ${Number(t.total_value).toLocaleString()}€` : ''}</span>
            </div>
          ))}
          {(!data.tenure || data.tenure.length === 0) && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{en ? 'No data yet' : 'Pas de données'}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Revenue by size */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Revenue by Company Size' : 'Revenu par taille entreprise'}</div>
          {(data.bySize || []).map(s => (
            <div key={s.segment} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span>{s.segment}</span>
              <span><strong>{s.won}</strong> {en ? 'won' : 'gagnés'} · {s.revenue ? `${Number(s.revenue).toLocaleString()}€` : '—'}</span>
            </div>
          ))}
        </div>

        {/* Performance by rep */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Performance by Rep' : 'Performance par commercial'}</div>
          {(data.byOwner || []).map(o => {
            const winRate = parseInt(o.total) > 0 ? Math.round((parseInt(o.won) / parseInt(o.total)) * 100) : 0;
            return (
              <div key={o.rep} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{o.rep}</span>
                <span><strong>{winRate}%</strong> win · {o.revenue ? `${Number(o.revenue).toLocaleString()}€` : '—'}</span>
              </div>
            );
          })}
          {(!data.byOwner || data.byOwner.length === 0) && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{en ? 'No data yet' : 'Pas de données'}</div>}
        </div>
      </div>

      {/* Monthly trend */}
      {data.monthlyTrend?.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Monthly Wins & Revenue' : 'Gains & revenus mensuels'}</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100 }}>
            {data.monthlyTrend.map(m => {
              const maxWins = Math.max(...data.monthlyTrend.map(x => parseInt(x.wins) || 0), 1);
              const h = Math.max(((parseInt(m.wins) || 0) / maxWins) * 80, 4);
              return (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>{m.wins}</div>
                  <div style={{ width: '100%', height: h, borderRadius: 4, background: '#6E57FA' }} title={`${m.month}: ${m.wins} wins, ${m.revenue}€`} />
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming renewals */}
      {data.upcomingRenewals?.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Upcoming Renewals (60 days)' : 'Renouvellements à venir (60 jours)'}</div>
          {data.upcomingRenewals.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.company} {r.deal_value ? `· ${r.deal_value}€` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en ? 'en-US' : 'fr-FR')}</div>
                {r.churn_score >= 50 && <div style={{ fontSize: 10, color: '#DC2626' }}>Churn {r.churn_score}%</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
