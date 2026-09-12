/* ===============================================================================
   BAKAL — Data Quality score trend header
   Compact card at the top of the Data Quality page: current overall score, 30-day
   delta badge (green when improving, red otherwise) and a small inline SVG sparkline
   of the main provider's score history (the provider with the most data points).
   Hidden entirely when there is no history yet (current === null).
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';

const SPARK_W = 120;
const SPARK_H = 32;
const SPARK_PAD = 3;

function Sparkline({ points }) {
  if (!points || points.length < 2) return null;
  const scores = points.map(p => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = (max - min) || 1;
  const coords = points.map((p, i) => {
    const x = SPARK_PAD + (i / (points.length - 1)) * (SPARK_W - SPARK_PAD * 2);
    const y = SPARK_H - SPARK_PAD - ((p.score - min) / range) * (SPARK_H - SPARK_PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = coords[coords.length - 1].split(',');
  return (
    <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2" fill="var(--accent)" />
    </svg>
  );
}

export default function ScoreTrendHeader() {
  const t = useT();
  const [data, setData] = useState(null);

  useEffect(() => {
    request('/data-quality/score-history').then(setData).catch(() => {});
  }, []);

  // No history yet (or endpoint unavailable) → no block at all.
  if (!data || data.current == null) return null;

  const mainProvider = (data.providers || []).reduce(
    (best, p) => ((p.points?.length || 0) > (best?.points?.length || 0) ? p : best),
    null
  );
  const delta = data.delta30d;
  const positive = delta != null && delta >= 0;
  // Déductions du dernier rapport du provider principal — même présentation
  // que les facteurs churn (liste facteur + poids), poids négatifs ici.
  const factors = mainProvider?.factors?.length
    ? mainProvider.factors
    : (data.providers || []).find(p => p.factors?.length)?.factors || [];

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-body" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {t('dataQuality.scoreTrend.title')}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>
            {data.current}
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>/100</span>
          </div>
        </div>
        {delta != null && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
            background: positive ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: positive ? 'var(--success)' : 'var(--danger)',
          }}>
            {t('dataQuality.scoreTrend.deltaBadge', { delta: `${positive ? '+' : ''}${delta}` })}
          </span>
        )}
        {mainProvider?.points?.length > 1 && (
          <div style={{ marginLeft: 'auto' }}>
            <Sparkline points={mainProvider.points} />
          </div>
        )}
        {factors.length > 0 && (
          <div style={{
            flexBasis: '100%', background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              {t('dataQuality.scoreTrend.factorsTitle')}
            </div>
            {factors.map((f, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                <span>{t(`dataQuality.scoreTrend.factor.${f.signal}`, { count: f.count })}</span>
                <span style={{ fontWeight: 600, color: f.weight <= -10 ? 'var(--danger)' : 'var(--warning)' }}>
                  {f.weight}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
