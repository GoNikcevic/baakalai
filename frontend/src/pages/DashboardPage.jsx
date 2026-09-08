/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Single scrolling page, 4 sections (Deals / Clients / CRM / Activation) stacked
   in order. Each section has its own labeled header + color accent so the
   indicators stay visually and semantically distinct — no cross-domain mixing,
   even without tab navigation. Global chrome (sync status, onboarding
   checklist) sits above all 4 sections.
   =============================================================================== */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT, useI18n } from '../i18n';
import { useSocket } from '../context/SocketContext';
import OnboardingChecklist from '../components/OnboardingChecklist';
import { request } from '../services/api-client';
import DealsTab from '../components/dashboardTabs/DealsTab';
import ClientsTab from '../components/dashboardTabs/ClientsTab';
import CrmTab from '../components/dashboardTabs/CrmTab';
import ActivationTab from '../components/dashboardTabs/ActivationTab';

const SECTIONS = [
  { key: 'deals', labelKey: 'dashboard.tabs.deals', icon: '\u{1F4BC}', color: 'var(--accent)' },
  { key: 'clients', labelKey: 'dashboard.tabs.clients', icon: '\u{1F465}', color: 'var(--danger)' },
  { key: 'crm', labelKey: 'dashboard.tabs.crm', icon: '\u{1F5C2}️', color: 'var(--blue)' },
  { key: 'activation', labelKey: 'dashboard.tabs.activation', icon: '\u{1F4E7}', color: 'var(--warning)' },
];

function SectionHeader({ icon, title, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginTop: 32, marginBottom: 16,
      paddingBottom: 8, borderBottom: `2px solid ${color}`,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
    </div>
  );
}

export default function DashboardPage() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const { campaigns, globalKpis, recommendations, chartData } = useApp();
  const { setShowCreatorModal } = useOutletContext() || {};
  const navigate = useNavigate();
  const openCreator = useCallback(() => navigate('/campaigns', { state: { openAssistant: true } }), [navigate]);
  const { socket } = useSocket();
  const [syncStatus, setSyncStatus] = useState(null);
  // Stats CRM (pipeline, dormants, récupéré) — fetch unique, partagé entre la
  // grille RevenueKpis et la ReactivationCard (toutes deux dans DealsTab).
  const [crmStats, setCrmStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/crm/reactivation-stats').then(d => {
      if (!cancelled) setCrmStats(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onLemlist = (data) => setSyncStatus(data.status === 'done' || data.status === 'error' ? null : { type: 'Lemlist', ...data });
    const onCrm = (data) => setSyncStatus(data.status === 'done' || data.status === 'error' ? null : { type: 'CRM', ...data });
    socket.on('lemlist:sync', onLemlist);
    socket.on('crm:sync', onCrm);
    return () => { socket.off('lemlist:sync', onLemlist); socket.off('crm:sync', onCrm); };
  }, [socket]);

  const campaignsList = useMemo(() => Object.values(campaigns), [campaigns]);
  const isEmpty = campaignsList.length === 0;
  const activeCount = useMemo(
    () => campaignsList.filter((c) => c.status === 'active').length,
    [campaignsList]
  );

  /* ── Subtitle ── */
  const subtitle = isEmpty
    ? t('dashboard.welcomeSubtitle')
    : (() => {
        const today = new Date();
        const weekStr = en
          ? 'Week of ' + today.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'Semaine du ' + today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
        return en
          ? `${activeCount} active campaign${activeCount > 1 ? 's' : ''} · ${weekStr}`
          : `${activeCount} campagne${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} · ${weekStr}`;
      })();

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <div className="page-subtitle">
            {!isEmpty && <span className="pulse-dot"></span>}
            <span style={{ marginLeft: 8 }}>{subtitle}</span>
          </div>
        </div>
      </div>

      {/* Sync in progress indicator */}
      {syncStatus && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 16,
          background: 'var(--blue-bg)', border: '1px solid rgba(59,130,246,0.15)',
          borderRadius: 10, fontSize: 13, color: 'var(--blue)',
          animation: 'fadeInUp 0.3s ease-out',
        }}>
          <div style={{
            width: 16, height: 16, border: '2px solid var(--blue)',
            borderTopColor: 'transparent', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span>{en ? `${syncStatus.type} analysis in progress` : `Analyse ${syncStatus.type} en cours`} — {syncStatus.message || `${syncStatus.progress || 0}%`}</span>
        </div>
      )}

      {/* Onboarding checklist for new users */}
      <OnboardingChecklist />

      {/* Deals — strictly deal/pipeline indicators */}
      <SectionHeader icon={SECTIONS[0].icon} title={t(SECTIONS[0].labelKey)} color={SECTIONS[0].color} />
      <DealsTab crmStats={crmStats} />

      {/* Clients — churn + upsell indicators */}
      <SectionHeader icon={SECTIONS[1].icon} title={t(SECTIONS[1].labelKey)} color={SECTIONS[1].color} />
      <ClientsTab />

      {/* CRM — data quality indicators only */}
      <SectionHeader icon={SECTIONS[2].icon} title={t(SECTIONS[2].labelKey)} color={SECTIONS[2].color} />
      <CrmTab />

      {/* Activation — emailing/campaigns indicators */}
      <SectionHeader icon={SECTIONS[3].icon} title={t(SECTIONS[3].labelKey)} color={SECTIONS[3].color} />
      <ActivationTab
        isEmpty={isEmpty}
        globalKpis={globalKpis}
        campaigns={campaignsList}
        recommendations={recommendations}
        chartData={chartData}
        onCreateCampaign={openCreator}
      />
    </div>
  );
}
