/* ═══════════════════════════════════════════════════
   Dashboard — CRM tab
   Strictly data-quality indicators: overall score/trend, duplicates,
   and issue counts per strate (Général/Deal quality/Client quality).
   No lead-scoring/CRM-export card here — that mixed a different concern
   (opportunity scoring) into a section meant to read as "is my CRM data
   healthy", so it was dropped in favor of a single, focused teaser that
   deep-links to the full /data-quality page.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useT, useI18n } from '../../i18n';
import { request } from '../../services/api-client';
import ScoreTrendHeader from '../dataQuality/ScoreTrendHeader';

export default function CrmTab() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/data-quality/dashboard-summary').then(d => {
      if (!cancelled) setSummary(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const total = summary
    ? summary.duplicates + summary.general + summary.dealQuality + summary.clientQuality
    : 0;

  return (
    <div>
      <ScoreTrendHeader />

      <div className="card">
        <div className="card-header">
          <div className="card-title">{en ? 'Data quality' : 'Qualité des données'}</div>
          <Link to="/data-quality" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '12px' }}>
            {t('dashboard.viewAll')} &rarr;
          </Link>
        </div>
        <div className="card-body">
          {summary && total > 0 ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: en ? 'Duplicates' : 'Doublons', value: summary.duplicates, color: 'var(--danger)' },
                { label: t('dataQuality.tabs.general'), value: summary.general, color: 'var(--warning)' },
                { label: t('dataQuality.tabs.dealQuality'), value: summary.dealQuality, color: 'var(--blue)' },
                { label: t('dataQuality.tabs.clientQuality'), value: summary.clientQuality, color: 'var(--accent)' },
              ].map(b => (
                <div key={b.label} style={{
                  flex: 1, minWidth: 90, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${b.color}`, borderRadius: 8, padding: '10px 14px',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: b.color }}>{b.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              {summary
                ? (en ? 'No data quality issues detected.' : 'Aucun problème de qualité détecté.')
                : '...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
