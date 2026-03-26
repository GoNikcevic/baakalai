/* ===============================================================================
   BAKAL — Performance Page (React)
   Merges Analytics (charts, engagement, funnel) + Weekly Reports into one page.
   =============================================================================== */

import { useState, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import AnalyticsSection from './AnalyticsSection';
import { exportCampaignsCsv, exportReportPdf } from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';

export default function PerformancePage() {
  const { campaigns, reports } = useApp();
  const navigate = useNavigate();
  const openCreator = useCallback(() => navigate('/chat'), [navigate]);

  const campaignsList = useMemo(() => Object.values(campaigns), [campaigns]);
  const isEmpty = campaignsList.length === 0;

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Performance</h1>
          <div className="page-subtitle">
            Analytics et rapports hebdomadaires
          </div>
        </div>
      </div>

      {/* Analytics Section (charts, engagement, funnel) */}
      <AnalyticsSection />

      {/* Weekly Reports */}
      <div style={{ marginTop: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '16px' }}>Rapports hebdomadaires</h2>
        <ReportsSection isEmpty={isEmpty} reports={reports} onCreateCampaign={openCreator} />
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Reports Section (moved from DashboardPage)
   ═══════════════════════════════════════════════════ */

function ReportsSection({ isEmpty, reports, onCreateCampaign }) {
  if (isEmpty || !reports || reports.length === 0) {
    return (
      <div id="section-reports">
        <div className="empty-state">
          <div className="empty-state-icon">{'📋'}</div>
          <div className="empty-state-title">Aucun rapport disponible</div>
          <div className="empty-state-desc">
            Les rapports hebdomadaires sont générés automatiquement chaque lundi.
            Lancez votre première campagne pour recevoir votre premier bilan de
            performance.
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/chat')}>
            Créer ma première campagne
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="section-reports">
      {/* Export buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={exportCampaignsCsv}
        >
          Exporter CSV
        </button>
        <button
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={exportReportPdf}
        >
          Rapport PDF
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {reports.map((r, i) => (
          <div className="card" key={i}>
            <div className="card-header">
              <div>
                <div className="card-title">{r.week}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{r.dateRange}</div>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.scoreLabel}</span>
            </div>
            <div className="card-body">
              {/* Mini KPIs */}
              <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Contacts:</span> <strong>{r.metrics.contacts}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Ouverture:</span> <strong>{r.metrics.openRate}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Réponse:</span> <strong>{r.metrics.replyRate}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>Intéressés:</span> <strong>{r.metrics.interested}</strong></div>
                <div style={{ fontSize: '12px' }}><span style={{ color: 'var(--text-muted)' }}>RDV:</span> <strong>{r.metrics.meetings}</strong></div>
              </div>
              {/* Synthesis */}
              <div style={{ fontSize: '13px', lineHeight: '1.6' }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(r.synthesis) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
