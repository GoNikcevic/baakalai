/* ═══════════════════════════════════════════════════
   Dashboard — Clients tab
   Strictly client-scoped data: churn risk (real churn_score model,
   same one backing /churn-risk — not the age-only heuristic the old
   QuickWinCard used) and upsell opportunities. Both are teasers that
   deep-link to their full dedicated pages.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../context/useApp';
import { useT, useI18n } from '../../i18n';
import { request, getChurnSummary } from '../../services/api-client';

export default function ClientsTab() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const { opportunities } = useApp();
  const [churnSummary, setChurnSummary] = useState(null);
  const [upsellCandidates, setUpsellCandidates] = useState(null);
  const [upsellSummary, setUpsellSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getChurnSummary().then(d => { if (!cancelled) setChurnSummary(d); }).catch(() => {});
    request('/reactivation/queue?kind=auto_upsell&sort=score').then(d => {
      if (!cancelled) setUpsellCandidates(d.candidates || []);
    }).catch(() => { if (!cancelled) setUpsellCandidates([]); });
    request('/crm/upsell/summary').then(d => { if (!cancelled) setUpsellSummary(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Top 3 par score, sans seuil "à risque" — sinon la liste reste vide dès
  // que personne ne dépasse un cutoff arbitraire, alors que la bande
  // critique/élevé/modéré/faible au-dessus donne déjà cette lecture globale.
  const atRisk = useMemo(() => {
    return (opportunities || [])
      .filter(o => o.status === 'won' && o.churnScore != null)
      .sort((a, b) => (b.churnScore || 0) - (a.churnScore || 0))
      .slice(0, 3);
  }, [opportunities]);

  const churnBandColor = (score) => {
    if (score >= 76) return 'var(--danger)';
    if (score >= 51) return 'var(--warning)';
    if (score >= 26) return '#D97706';
    return 'var(--success)';
  };

  return (
    <div>
      {churnSummary && churnSummary.scored > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">{en ? 'Churn risk' : 'Risque de churn'}</div>
            <Link to="/churn-risk" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '12px' }}>
              {t('dashboard.viewAll')} &rarr;
            </Link>
          </div>
          <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: t('clients.critical'), count: churnSummary.critical, color: 'var(--danger)' },
              { label: t('clients.high'), count: churnSummary.high, color: 'var(--warning)' },
              { label: t('clients.medium'), count: churnSummary.medium, color: '#D97706' },
              { label: t('clients.low'), count: churnSummary.low, color: 'var(--success)' },
            ].map(b => (
              <div key={b.label} style={{
                flex: 1, minWidth: 90, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderLeft: `3px solid ${b.color}`, borderRadius: 8, padding: '10px 14px',
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: b.color }}>{b.count}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.label}</div>
              </div>
            ))}
          </div>
          {atRisk.length > 0 && (
            <div className="card-body" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.3, marginTop: 12 }}>
                TOP 3
              </div>
              {atRisk.map((c, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13,
                }}>
                  <span>{c.name}{c.company ? ` · ${c.company}` : ''}</span>
                  <span style={{ fontWeight: 600, color: churnBandColor(c.churnScore) }}>{c.churnScore}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">{en ? 'Upsell opportunities' : 'Opportunités d’upsell'}</div>
          <Link to="/clients-to-upsell" className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '12px' }}>
            {t('dashboard.viewAll')} &rarr;
          </Link>
        </div>
        {upsellSummary && upsellSummary.totalCandidates > 0 && (
          <div className="card-body" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingBottom: 0 }}>
            {[
              { label: en ? 'Potential clients' : 'Clients potentiels', value: upsellSummary.totalCandidates, color: 'var(--accent)' },
              { label: en ? 'Emails sent (14d)' : 'Emails envoyés (14j)', value: upsellSummary.emailsSent14d, color: 'var(--success)' },
              { label: en ? 'Average score' : 'Score moyen', value: `${upsellSummary.avgScore}/100`, color: 'var(--warning)' },
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
        )}
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upsellCandidates && upsellCandidates.length > 0 && (
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.3, marginTop: 12 }}>
              TOP 3
            </div>
          )}
          {upsellCandidates === null ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>...</div>
          ) : upsellCandidates.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
              {en ? 'No upsell opportunity detected yet.' : 'Aucune opportunité d’upsell détectée pour l’instant.'}
            </div>
          ) : upsellCandidates.slice(0, 3).map((c, i, arr) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13,
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.name}{c.company ? ` · ${c.company}` : ''}</div>
                {c.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.reason}</div>}
              </div>
              {c.dealValue > 0 && <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 12 }}>{Math.round(c.dealValue)} €</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
