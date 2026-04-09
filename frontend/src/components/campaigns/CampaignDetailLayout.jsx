/* ═══════════════════════════════════════════════════
   Campaign Detail Layout — Tabbed view
   Single page per campaign with Settings / Copy / Prospects /
   Performance / History tabs.
   ═══════════════════════════════════════════════════ */

import { useState } from 'react';
import api from '../../services/api-client';
import SettingsTab from './tabs/SettingsTab';
import CopyTab from './tabs/CopyTab';
import ProspectsTab from './tabs/ProspectsTab';
import PerformanceTab from './tabs/PerformanceTab';
import HistoryTab from './tabs/HistoryTab';
import ABTestTab from './tabs/ABTestTab';
import OptimizeCampaignModal from './OptimizeCampaignModal';
import LoadingOverlay from '../shared/LoadingOverlay';

const LEMLIST_LAUNCH_STEPS = [
  'Création de la campagne sur Lemlist…',
  'Déploiement des séquences email & LinkedIn…',
  'Ajout des prospects dans la liste…',
  'Activation de la campagne…',
];

export default function CampaignDetailLayout({ campaign: c, onBack, setCampaigns }) {
  const isPrep = c.status === 'prep';
  const isActive = c.status === 'active';
  const isArchived = c.status === 'archived';

  const [activeTab, setActiveTab] = useState(isPrep ? 'copy' : 'performance');
  const [archiving, setArchiving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchAlert, setLaunchAlert] = useState(null);
  const [showOptimize, setShowOptimize] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [optimizeBanner, setOptimizeBanner] = useState(null);

  // Show A/B tab if campaign has an active test config
  const hasABTest = !!c.abConfig;

  // Tab definitions — show conditionally based on status
  const tabs = [
    { key: 'settings', label: 'Paramètres', icon: '⚙️' },
    { key: 'copy', label: 'Copy & Séquences', icon: '✉️' },
    { key: 'prospects', label: 'Prospects', icon: '👥' },
    ...(hasABTest ? [{ key: 'abtest', label: 'A/B Test', icon: '🧬' }] : []),
    ...(isActive
      ? [
          { key: 'performance', label: 'Performance', icon: '📊' },
          { key: 'history', label: 'Historique', icon: '📜' },
        ]
      : []),
  ];

  /* ── Archive handler ── */
  const handleArchive = async () => {
    if (!window.confirm(`Archiver la campagne "${c.name}" ? Elle reste consultable via le filtre "Archivées".`)) return;
    setArchiving(true);
    try {
      const backendId = c._backendId || c.id;
      await api.request('/campaigns/' + backendId, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
    } catch (err) {
      console.error('Failed to archive campaign:', err);
      window.alert(`Impossible d'archiver la campagne : ${err.message || 'erreur inconnue'}`);
      setArchiving(false);
      return;
    }
    if (setCampaigns) {
      setCampaigns((prev) => ({
        ...prev,
        [c.id]: { ...prev[c.id], status: 'archived' },
      }));
    }
    onBack();
  };

  /* ── Launch handler (prep only) ── */
  const handleLaunch = async () => {
    if (!c.sequence || c.sequence.length === 0) {
      setLaunchAlert({
        type: 'error',
        title: 'Impossible de lancer — séquences manquantes',
        desc: "Génère d'abord les séquences via Baakalai depuis l'onglet Copy & Séquences.",
      });
      return;
    }
    setLaunching(true);
    setLaunchAlert(null);
    const backendId = c._backendId || c.id;
    try {
      const result = await api.launchCampaignToLemlist(backendId);
      setCampaigns((prev) => ({
        ...prev,
        [c.id]: {
          ...prev[c.id],
          status: 'active',
          iteration: 1,
          kpis: { contacts: result.leads?.pushed || 0, openRate: 0, replyRate: 0, interested: 0, meetings: 0, stops: 0 },
        },
      }));
      const stepsOk = (result.sequenceSteps || []).filter(s => s.ok).length;
      const stepsTotal = (result.sequenceSteps || []).length;
      const baseDesc = `${result.leads?.pushed || 0} prospects ajoutés · ${stepsOk}/${stepsTotal} étapes créées`;
      const statusLine = result.started
        ? ' · ✅ Campagne démarrée automatiquement'
        : result.startError
          ? ` · ⚠️ Démarrage auto échoué (${result.startError}) — démarre manuellement depuis Lemlist`
          : ' · ℹ️ Campagne en draft sur Lemlist (pas de leads/étapes à envoyer)';
      setLaunchAlert({
        type: 'success',
        title: '🚀 Campagne déployée vers Lemlist',
        desc: baseDesc + statusLine,
      });
    } catch (err) {
      setLaunchAlert({
        type: 'error',
        title: 'Échec du lancement Lemlist',
        desc: err.message || 'Erreur inconnue — vérifie ta clé API Lemlist dans Intégrations.',
      });
    }
    setLaunching(false);
  };

  /* ── Tags ── */
  const tags = [c.channelLabel, c.sector, c.size, c.angle, c.zone].filter(Boolean);

  return (
    <div className="campaign-detail">
      <LoadingOverlay
        show={launching}
        title="🚀 Déploiement vers Lemlist"
        steps={LEMLIST_LAUNCH_STEPS}
      />

      {/* Back button */}
      <button className="campaign-detail-back" onClick={onBack}>
        ← Retour aux campagnes
      </button>

      {/* Header */}
      <div className="campaign-detail-header">
        <div>
          <div className="campaign-detail-title">{c.name}</div>
          <div className="campaign-detail-tags">
            {tags.map((t, i) => (
              <span className="campaign-tag" key={i}>{t}</span>
            ))}
            {isPrep && (
              <span className="campaign-tag" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                ⏳ En préparation
              </span>
            )}
            {isActive && (
              <span className="campaign-tag" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
                ● Active
              </span>
            )}
            {isArchived && (
              <span className="campaign-tag" style={{ borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}>
                📦 Archivée
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {!isArchived && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '8px 14px', color: 'var(--text-muted)' }}
              onClick={handleArchive}
              disabled={archiving}
            >
              {archiving ? '...' : '📦 Archiver'}
            </button>
          )}
          {isActive && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: '12px', padding: '8px 14px' }}
                onClick={() => setShowOptimize(true)}
              >
                🔄 Optimiser la campagne
              </button>
              <button
                onClick={() => setShowHelp(prev => !prev)}
                onMouseEnter={() => setShowHelp(true)}
                onMouseLeave={() => setShowHelp(false)}
                aria-label="Aide — Comment fonctionne l'optimisation"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-muted)',
                  cursor: 'help',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ?
              </button>
              {showHelp && <OptimizeHelpTooltip />}
            </div>
          )}
          {isPrep && (
            <button
              className="btn btn-success"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={handleLaunch}
              disabled={launching}
            >
              {launching ? '⏳ Déploiement Lemlist...' : '🚀 Lancer vers Lemlist'}
            </button>
          )}
        </div>
      </div>

      {/* Optimization banner */}
      {optimizeBanner && (
        <div
          style={{
            background: 'rgba(0, 214, 143, 0.1)',
            border: '1px solid rgba(0, 214, 143, 0.3)',
            borderRadius: '12px',
            padding: '14px 16px',
            margin: '16px 0',
            fontSize: 13,
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 18 }}>✅</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{optimizeBanner.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {optimizeBanner.desc}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '6px 12px' }}
            onClick={() => setOptimizeBanner(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Optimize modal */}
      {showOptimize && (
        <OptimizeCampaignModal
          campaign={c}
          onClose={() => setShowOptimize(false)}
          onSuccess={(result) => {
            const stepsCount = result?.variants?.length || 0;
            setOptimizeBanner({
              title: `Optimisation déployée — ${stepsCount} touchpoint${stepsCount > 1 ? 's' : ''} mis à jour`,
              desc: 'Le nouveau test A/B est visible dans l\'onglet 🧬 A/B Test. Les stats arriveront après les prochains envois Lemlist.',
            });
            // Optionally switch to A/B tab if it's visible
            if (hasABTest || result?.variants?.length) {
              setActiveTab('abtest');
            }
          }}
        />
      )}

      {/* Launch alert */}
      {launchAlert && (
        <div
          style={{
            background:
              launchAlert.type === 'error'
                ? 'var(--danger-bg)'
                : launchAlert.type === 'success'
                  ? 'rgba(0, 214, 143, 0.1)'
                  : 'var(--warning-bg)',
            border: `1px solid ${
              launchAlert.type === 'error'
                ? 'rgba(255,107,107,0.3)'
                : launchAlert.type === 'success'
                  ? 'rgba(0, 214, 143, 0.3)'
                  : 'rgba(255,170,0,0.3)'
            }`,
            borderRadius: '12px',
            padding: '16px',
            margin: '16px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '18px' }}>
            {launchAlert.type === 'error' ? '⚠️' : launchAlert.type === 'success' ? '✅' : '⏳'}
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: `var(--${launchAlert.type === 'error' ? 'danger' : launchAlert.type === 'success' ? 'success' : 'warning'})`,
              }}
            >
              {launchAlert.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{launchAlert.desc}</div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '6px 12px' }}
            onClick={() => setLaunchAlert(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Tab navigation */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          borderBottom: '1px solid var(--border)',
          marginTop: '20px',
          marginBottom: '24px',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'transparent',
              borderBottom: `2px solid ${activeTab === t.key ? 'var(--accent)' : 'transparent'}`,
              color: activeTab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === t.key ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="tab-content">
        {activeTab === 'settings' && <SettingsTab campaign={c} setCampaigns={setCampaigns} />}
        {activeTab === 'copy' && <CopyTab campaign={c} setCampaigns={setCampaigns} />}
        {activeTab === 'prospects' && <ProspectsTab campaign={c} />}
        {activeTab === 'abtest' && <ABTestTab campaign={c} setCampaigns={setCampaigns} />}
        {activeTab === 'performance' && <PerformanceTab campaign={c} />}
        {activeTab === 'history' && <HistoryTab campaign={c} />}
      </div>
    </div>
  );
}

function OptimizeHelpTooltip() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: 340,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 16,
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        zIndex: 1000,
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>
        Comment fonctionne l'optimisation
      </div>
      <div style={{ marginBottom: 10 }}>
        Baakalai analyse les performances de ta campagne et identifie le touchpoint qui performe le moins.
        Il propose ensuite une nouvelle variante que tu peux valider avant de la pousser vers Lemlist
        en A/B testing.
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <div>• Min. 20 prospects contactés</div>
        <div>• 1 optimisation / 7 jours recommandée</div>
        <div>• Au-delà de 50 prospects, le pattern alimente la mémoire collective</div>
      </div>
    </div>
  );
}
