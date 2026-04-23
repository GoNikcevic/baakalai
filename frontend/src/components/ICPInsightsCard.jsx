/**
 * ICP Insights Card
 *
 * Displays the user's Ideal Customer Profile analysis on the dashboard.
 * Shows top/worst segments, recommendations, and a refresh button.
 * Only rendered when user has >= 3 campaigns.
 */

import { useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n';
import { request } from '../services/api-client';

export default function ICPInsightsCard() {
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchAnalysis = useCallback(async () => {
    try {
      setError(null);
      const res = await request('/ai/icp-analysis');
      setData(res);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await request('/ai/icp-analysis/refresh', { method: 'POST' });
      setData(res);
    } catch (err) {
      setError(err.message || 'Error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Hide on error (not enough campaigns, API unavailable, etc.)
  if (error) return null;

  // Still loading initial data
  if (loading) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('icp.title')}</div>
        </div>
        <div className="card-body" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  // Not enough data
  if (data && data.notEnoughData) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('icp.title')}</div>
        </div>
        <div className="card-body" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {t('icp.notEnoughData')}
        </div>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{t('icp.title')}</div>
        </div>
        <div className="card-body" style={{ padding: '24px', textAlign: 'center', color: 'var(--danger, #ef4444)', fontSize: 13 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { topSegments = [], worstSegments = [], recommendations = [], summary = '' } = data;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="card-title">{t('icp.title')}</div>
        <button
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: '11px' }}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? t('icp.refreshing') : t('icp.refresh')}
        </button>
      </div>
      <div className="card-body" style={{ padding: '16px 24px' }}>
        {/* Summary */}
        {summary && (
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 16,
            padding: '10px 14px',
            background: 'var(--blue-bg, rgba(59,130,246,0.08))',
            borderRadius: 8,
            color: 'var(--text)',
            lineHeight: 1.5,
          }}>
            {summary}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Top Segments */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--success, #22c55e)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {t('icp.topSegments')}
            </div>
            {topSegments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topSegments.slice(0, 3).map((seg, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6,
                    background: 'var(--success-bg, rgba(34,197,94,0.08))',
                    fontSize: 12,
                  }}>
                    <span style={{ fontWeight: 500 }}>{seg.label}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {seg.replyRate != null && <>{t('icp.replyRate')}: {seg.replyRate}%</>}
                      {seg.meetings > 0 && <> &middot; {t('icp.meetings')}: {seg.meetings}</>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</div>
            )}
          </div>

          {/* Worst Segments */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger, #ef4444)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {t('icp.worstSegments')}
            </div>
            {worstSegments.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {worstSegments.slice(0, 3).map((seg, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', borderRadius: 6,
                    background: 'var(--danger-bg, rgba(239,68,68,0.08))',
                    fontSize: 12,
                  }}>
                    <span style={{ fontWeight: 500 }}>{seg.label}</span>
                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 8 }}>
                      {seg.replyRate != null && <>{t('icp.replyRate')}: {seg.replyRate}%</>}
                      {seg.meetings > 0 && <> &middot; {t('icp.meetings')}: {seg.meetings}</>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>-</div>
            )}
          </div>
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue, #3b82f6)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {t('icp.recommendations')}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)', lineHeight: 1.7 }}>
              {recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Cached indicator */}
        {data.cached && data.analyzedAt && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
            {new Date(data.analyzedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}

        {/* Error on refresh */}
        {error && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger, #ef4444)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
