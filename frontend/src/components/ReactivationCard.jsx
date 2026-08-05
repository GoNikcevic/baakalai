/**
 * Reactivation KPI Card — shown on Dashboard.
 * Shows deals reactivated, revenue recovered, pipeline potential.
 * This is the "hero metric" that proves ROI.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { useI18n } from '../i18n';

export default function ReactivationCard({ stats: statsProp }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();
  const [fetched, setFetched] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const stats = statsProp ?? fetched;

  useEffect(() => {
    // Le parent (Dashboard) fournit déjà les stats — ne re-fetch que monté seul.
    if (statsProp) return;
    let cancelled = false;
    request('/crm/reactivation-stats').then(d => {
      if (!cancelled) setFetched(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [statsProp]);

  if (!stats) return null;
  // Don't show if truly nothing to show (no CRM data at all)
  if (stats.reactivated.count === 0 && stats.emails.sent === 0 && stats.pipeline.stagnantDeals === 0) return null;

  // Zero reactivations but stagnant deals exist = show CTA mode
  const ctaMode = stats.reactivated.count === 0 && stats.emails.sent === 0 && stats.pipeline.stagnantDeals > 0;

  const fmt = (n) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  const fmtCurrency = (n) => {
    if (!n) return '0\u00A0\u20AC';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k\u00A0\u20AC`;
    return `${Math.round(n)}\u00A0\u20AC`;
  };

  if (ctaMode) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 16, color: '#fff',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          {en ? 'Stagnant deals detected' : 'Deals stagnants d\u00E9tect\u00E9s'}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1 }}>
          {fmt(stats.pipeline.stagnantDeals)} {en ? 'deals' : 'deals'}
          {stats.pipeline.potentialRevenue > 0 && (
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
              ({fmtCurrency(stats.pipeline.potentialRevenue)} {en ? 'potential' : 'potentiel'})
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6, marginBottom: 12 }}>
          {en
            ? 'These deals have been inactive for 14+ days. Set up reactivation to recover revenue automatically.'
            : 'Ces deals sont inactifs depuis 14+ jours. Activez la r\u00E9activation pour r\u00E9cup\u00E9rer du revenu automatiquement.'}
        </div>
        <button
          onClick={() => navigate('/activation?tab=triggers&create=deal_stagnant')}
          style={{
            background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          {en ? 'Activate deal reactivation' : 'Activer la r\u00E9activation'}
        </button>
      </div>
    );
  }

  return (
    <div style={{
      background: stats.reactivated.count > 0 ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'var(--bg-card)',
      borderRadius: 12, padding: '16px 20px', marginBottom: 16,
      border: stats.reactivated.count > 0 ? 'none' : '1px solid var(--border)',
      color: stats.reactivated.count > 0 ? '#fff' : 'var(--text)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {en ? 'Deal Reactivation' : 'R\u00E9activation de deals'}
        </div>
        {stats.conversionRate > 0 && (
          <div style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: stats.reactivated.count > 0 ? 'rgba(255,255,255,0.2)' : 'var(--bg-elevated)',
          }}>
            {stats.conversionRate}% {en ? 'conversion' : 'conversion'}
          </div>
        )}
      </div>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 24, marginBottom: stats.reactivated.count > 0 ? 12 : 0 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{stats.reactivated.count}</div>
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
            {en ? 'deals reactivated' : 'deals r\u00E9activ\u00E9s'}
          </div>
        </div>
        {stats.reactivated.revenue > 0 && (
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{fmtCurrency(stats.reactivated.revenue)}</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
              {en ? 'revenue recovered' : 'revenu r\u00E9cup\u00E9r\u00E9'}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{stats.emails.sent}</div>
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
            {en ? 'emails sent' : 'emails envoy\u00E9s'}
          </div>
        </div>
      </div>

      {/* Pipeline potential */}
      {stats.pipeline.stagnantDeals > 0 && (
        <div style={{
          fontSize: 12, padding: '8px 12px', borderRadius: 8, marginTop: 8,
          background: stats.reactivated.count > 0 ? 'rgba(255,255,255,0.15)' : 'var(--bg-elevated)',
        }}>
          {en
            ? <>{fmt(stats.pipeline.stagnantDeals)} stagnant deals worth <strong>{fmtCurrency(stats.pipeline.potentialRevenue)}</strong> in your pipeline</>
            : <>{fmt(stats.pipeline.stagnantDeals)} deals stagnants pour <strong>{fmtCurrency(stats.pipeline.potentialRevenue)}</strong> dans votre pipeline</>}
        </div>
      )}

      {/* Pending approvals */}
      {stats.emails.pending > 0 && (
        <div style={{
          fontSize: 12, marginTop: 8, padding: '6px 12px', borderRadius: 8,
          background: stats.reactivated.count > 0 ? 'rgba(255,255,255,0.15)' : '#fef3c7',
          color: stats.reactivated.count > 0 ? '#fff' : '#92400e',
        }}>
          {en
            ? <>{stats.emails.pending} reactivation email{stats.emails.pending > 1 ? 's' : ''} awaiting approval</>
            : <>{stats.emails.pending} email{stats.emails.pending > 1 ? 's' : ''} de r\u00E9activation en attente d'approbation</>}
        </div>
      )}

      {/* Expandable deal list */}
      {stats.reactivated.count > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
              fontSize: 11, opacity: 0.8, padding: 0, textDecoration: 'underline',
            }}
          >
            {expanded
              ? (en ? 'Hide details' : 'Masquer')
              : (en ? 'Show reactivated deals' : 'Voir les deals r\u00E9activ\u00E9s')}
          </button>
          {expanded && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {stats.reactivated.deals.slice(0, 10).map((d, i) => (
                <div key={i} style={{
                  fontSize: 12, display: 'flex', justifyContent: 'space-between',
                  padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.1)',
                }}>
                  <span>{d.name}{d.company ? ` (${d.company})` : ''}</span>
                  <span style={{ fontWeight: 600 }}>{d.dealValue ? fmtCurrency(d.dealValue) : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
