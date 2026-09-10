/* ===============================================================================
   BAKAL — Dashboard Page (React)
   Single scrolling page, 4 sections (Deals / Clients / CRM / Activation) stacked
   in order. Each section is a block on a slightly deeper background, titled and
   subtitled, so the indicators stay visually and semantically distinct — no
   cross-domain mixing, even without tab navigation. Global chrome (sync status, onboarding
   checklist) sits above all 4 sections.
   =============================================================================== */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT, useI18n } from '../i18n';
import { useSocket } from '../context/SocketContext';
import OnboardingChecklist from '../components/OnboardingChecklist';
import CRMDiagnosticReport from '../components/CRMDiagnosticReport';
import Icon from '../components/Icon';
import { request } from '../services/api-client';
import DealsTab from '../components/dashboardTabs/DealsTab';
import ClientsTab from '../components/dashboardTabs/ClientsTab';
import CrmTab from '../components/dashboardTabs/CrmTab';
import ActivationTab from '../components/dashboardTabs/ActivationTab';

const SECTIONS = [
  { key: 'deals', labelKey: 'dashboard.tabs.deals', descKey: 'dashboard.tabDescs.deals' },
  { key: 'clients', labelKey: 'dashboard.tabs.clients', descKey: 'dashboard.tabDescs.clients' },
  { key: 'crm', labelKey: 'dashboard.tabs.crm', descKey: 'dashboard.tabDescs.crm' },
  { key: 'activation', labelKey: 'dashboard.tabs.activation', descKey: 'dashboard.tabDescs.activation' },
];

/**
 * Une section du dashboard, posée sur un fond légèrement plus profond que la
 * page. La séparation ne passe plus par un trait de couleur sous le titre :
 * quatre traits de quatre couleurs hiérarchisaient des domaines qui sont sur un
 * pied d'égalité, et ne disaient rien de plus que le titre lui-même. Le bloc,
 * lui, montre où commence et où finit chaque domaine. Pas de bordure : les
 * cartes à l'intérieur en ont déjà une, et deux cadres imbriqués alourdissent.
 */
function Section({ title, description, children }) {
  return (
    <section style={{
      background: 'var(--bg-elevated, var(--paper-2))',
      borderRadius: 14, padding: 20, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>{title}</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 16px' }}>{description}</p>
      {children}
    </section>
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
  // Diagnostic CRM à la demande — le même rapport que celui affiché après le
  // premier import, rejouable depuis le haut du dashboard.
  const [showDiagnostic, setShowDiagnostic] = useState(false);

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
            <span style={{ marginLeft: isEmpty ? 0 : 8 }}>{subtitle}</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={() => setShowDiagnostic(true)}
            title={t('diagnostic.ctaHint')}
          >
            <Icon name="activity" size={15} style={{ marginRight: 7 }} />
            {t('diagnostic.cta')}
          </button>
        </div>
      </div>

      {/* Rapport de diagnostic CRM (plein écran) */}
      {showDiagnostic && (
        <CRMDiagnosticReport onClose={() => setShowDiagnostic(false)} />
      )}

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

      <div style={{ marginTop: 24 }}>
        {/* Deals — strictly deal/pipeline indicators */}
        <Section title={t(SECTIONS[0].labelKey)} description={t(SECTIONS[0].descKey)}>
          <DealsTab crmStats={crmStats} />
        </Section>

        {/* Clients — churn + upsell indicators */}
        <Section title={t(SECTIONS[1].labelKey)} description={t(SECTIONS[1].descKey)}>
          <ClientsTab />
        </Section>

        {/* CRM — data quality indicators only */}
        <Section title={t(SECTIONS[2].labelKey)} description={t(SECTIONS[2].descKey)}>
          <CrmTab />
        </Section>

        {/* Activation — emailing/campaigns indicators */}
        <Section title={t(SECTIONS[3].labelKey)} description={t(SECTIONS[3].descKey)}>
          <ActivationTab
            isEmpty={isEmpty}
            globalKpis={globalKpis}
            campaigns={campaignsList}
            recommendations={recommendations}
            chartData={chartData}
            onCreateCampaign={openCreator}
          />
        </Section>
      </div>
    </div>
  );
}
