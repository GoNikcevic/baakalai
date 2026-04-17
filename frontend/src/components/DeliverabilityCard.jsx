import { useState, useEffect, useCallback } from 'react';
import api, { request, fetchDashboard } from '../services/api-client';
import { useApp } from '../context/useApp';
import { useT } from '../i18n';

export default function DeliverabilityCard() {
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const { setGlobalKpis } = useApp();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.request('/ai/deliverability-check');
      setData(result);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const syncResult = await request('/dashboard/refresh-stats', { method: 'POST' });
      console.log('[refresh-stats] Result:', JSON.stringify(syncResult));
      const fresh = await fetchDashboard();
      setGlobalKpis(fresh);
      await load();
    } catch (err) {
      console.error('Stats refresh failed:', err);
    }
    setRefreshing(false);
  }, [setGlobalKpis]);

  if (loading) return null;
  if (error) return null;
  if (!data || data.checks?.campaigns === 0) return null;

  const scoreColor = data.score >= 80 ? 'var(--success, #16a34a)' : data.score >= 50 ? 'var(--warning, #d97706)' : 'var(--danger, #dc2626)';
  const scoreLabel = data.score >= 80 ? t('deliverability.excellent') : data.score >= 50 ? t('deliverability.good') : data.score < 30 ? t('deliverability.critical') : t('deliverability.warning');

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {t('deliverability.title')}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            cursor: 'pointer',
            color: 'var(--text-muted)',
          }}
        >
          {refreshing ? '\u23F3 Sync...' : '\uD83D\uDD04 Rafra\u00eechir'}
        </button>
      </div>

      {/* Score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `3px solid ${scoreColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 700,
          color: scoreColor,
        }}>
          {data.score}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: scoreColor }}>{scoreLabel}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {data.checks?.campaigns} {t('campaigns.prospects') || 'campaigns'} {t('deliverability.checked') || 'checked'}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {data.alerts && data.alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.alerts.slice(0, 5).map((alert, i) => (
            <div key={i} style={{
              padding: '8px 10px',
              borderRadius: 6,
              background: alert.severity === 'critical' ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.08)',
              border: `1px solid ${alert.severity === 'critical' ? 'rgba(239,68,68,0.2)' : 'rgba(251,191,36,0.2)'}`,
              fontSize: 11,
              lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, color: alert.severity === 'critical' ? 'var(--danger, #dc2626)' : 'var(--warning, #d97706)' }}>
                {alert.severity === 'critical' ? '🔴' : '🟡'} {alert.message}
              </div>
              {alert.recommendation && (
                <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                  {t('deliverability.recommendation')}: {alert.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.alerts?.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--success, #16a34a)' }}>
          ✅ {t('deliverability.allGood') || 'No issues detected'}
        </div>
      )}
    </div>
  );
}
