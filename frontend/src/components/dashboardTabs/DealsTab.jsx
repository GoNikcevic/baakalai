/* ═══════════════════════════════════════════════════
   Dashboard · Deals tab
   Strictly deal/pipeline data: open pipeline, deals to follow up,
   top-3 deals to relaunch (deep-links to /deals-to-reactivate).
   No churn/upsell/emailing content here.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { request } from '../../services/api-client';
import DealPipelineKpis from '../DealPipelineKpis';

export default function DealsTab({ crmStats }) {
  return (
    <div>
      <DealPipelineKpis stats={crmStats} />
      <TopDealsToFollowUp />
    </div>
  );
}

/* ── Top 3 deals à relancer · mêmes fetch/style que le TOP 3 upsell du
   Clients tab (dashboardTabs/ClientsTab.jsx), avec un CTA vers la file
   complète pour que l'utilisateur aille approuver/envoyer les emails. */
function TopDealsToFollowUp() {
  const { lang } = useI18n();
  const en = lang === 'en';
  const [candidates, setCandidates] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/reactivation/queue?kind=deal_reactivation&sort=overdue').then(d => {
      if (!cancelled) setCandidates(d.candidates || []);
    }).catch(() => { if (!cancelled) setCandidates([]); });
    return () => { cancelled = true; };
  }, []);

  if (candidates === null) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{en ? 'Deals to follow up' : 'Deals à relancer'}</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {candidates.length > 0 && (
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.3 }}>
            TOP 3
          </div>
        )}
        {candidates.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
            {en ? 'No deal to follow up right now.' : 'Aucun deal à relancer pour l’instant.'}
          </div>
        ) : candidates.slice(0, 3).map((c, i, arr) => (
          <div key={c.id || i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13,
          }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.name}{c.company ? ` · ${c.company}` : ''}</div>
              {c.reason && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.reason}</div>}
            </div>
            {c.dealValue > 0 && <span style={{ fontWeight: 600, flexShrink: 0, marginLeft: 12 }}>{Math.round(c.dealValue)} €</span>}
          </div>
        ))}
        <Link
          to="/deals-to-reactivate"
          className="btn btn-primary btn-sm"
          style={{ alignSelf: 'flex-start', marginTop: 8 }}
        >
          {en ? 'Go follow up' : 'Aller relancer'}
        </Link>
      </div>
    </div>
  );
}
