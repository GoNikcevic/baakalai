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

export default function CampaignDetailLayout({ campaign: c, onBack, setCampaigns }) {
  const isPrep = c.status === 'prep';
  const isActive = c.status === 'active';
  const isArchived = c.status === 'archived';

  const [activeTab, setActiveTab] = useState(isPrep ? 'copy' : 'performance');
  const [archiving, setArchiving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchAlert, setLaunchAlert] = useState(null);

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
        desc: "Génère d'abord les séquences via Claude depuis l'onglet Copy & Séquences.",
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
      setLaunchAlert({
        type: 'success',
        title: '🚀 Campagne déployée vers Lemlist',
        desc: `${result.leads?.pushed || 0} prospects ajoutés · ${(result.sequenceSteps || []).filter(s => s.ok).length}/${(result.sequenceSteps || []).length} étapes créées`,
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
        <div style={{ display: 'flex', gap: '8px' }}>
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
