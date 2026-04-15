/* ═══════════════════════════════════════════════════
   Campaign Detail Layout — Tabbed view
   Single page per campaign with Settings / Copy / Prospects /
   Performance / History tabs.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import api from '../../services/api-client';
import SettingsTab from './tabs/SettingsTab';
import CopyTab from './tabs/CopyTab';
import ProspectsTab from './tabs/ProspectsTab';
import PerformanceTab from './tabs/PerformanceTab';
import HistoryTab from './tabs/HistoryTab';
import ABTestTab from './tabs/ABTestTab';
import OptimizeCampaignModal from './OptimizeCampaignModal';
import LoadingOverlay from '../shared/LoadingOverlay';
import { useT } from '../../i18n';

export default function CampaignDetailLayout({ campaign: c, onBack, setCampaigns }) {
  const t = useT();
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
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [pendingLaunchOptions, setPendingLaunchOptions] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichBanner, setEnrichBanner] = useState(null);

  // Lemlist senders
  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState(null);

  const LEMLIST_LAUNCH_STEPS = [
    t('campaigns.launchStepCreate'),
    t('campaigns.launchStepSequences'),
    t('campaigns.launchStepProspects'),
    t('campaigns.launchStepActivate'),
  ];

  useEffect(() => {
    if (isPrep) {
      api.getLemlistSenders()
        .then(data => {
          if (data.senders && data.senders.length > 0) {
            setSenders(data.senders);
            setSelectedSender(data.senders[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isPrep]);

  // Show A/B tab if campaign has an active test config
  const hasABTest = !!c.abConfig;

  // Tab definitions — show conditionally based on status
  const tabs = [
    { key: 'settings', label: t('campaigns.settings'), icon: '\u2699\uFE0F' },
    { key: 'copy', label: t('campaigns.copy'), icon: '\u2709\uFE0F' },
    { key: 'prospects', label: t('campaigns.prospects'), icon: '\uD83D\uDC65' },
    ...(hasABTest ? [{ key: 'abtest', label: t('campaigns.abTest'), icon: '\uD83E\uDDEC' }] : []),
    ...(isActive
      ? [
          { key: 'performance', label: t('campaigns.performance'), icon: '\uD83D\uDCCA' },
          { key: 'history', label: t('campaigns.history'), icon: '\uD83D\uDCDC' },
        ]
      : []),
  ];

  /* ── Archive handler ── */
  const handleArchive = async () => {
    if (!window.confirm(t('campaigns.confirmArchive', { name: c.name }))) return;
    setArchiving(true);
    try {
      const backendId = c._backendId || c.id;
      await api.request('/campaigns/' + backendId, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
    } catch (err) {
      console.error('Failed to archive campaign:', err);
      window.alert(t('campaigns.archiveFailed', { error: err.message || 'erreur inconnue' }));
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

  /* ── Launch handler (prep or batch-next) ── */
  const handleLaunch = async (options = {}) => {
    if (!c.sequence || c.sequence.length === 0) {
      setLaunchAlert({
        type: 'error',
        title: t('campaigns.launchMissingSequence'),
        desc: t('campaigns.launchMissingSequenceDesc'),
      });
      return;
    }

    // If > 100 prospects and first launch, show batch mode modal
    const prospectCount = c.kpis?.contacts || c.nb_prospects || 0;
    if (!options.confirmed && !c.batch_mode && prospectCount > 100 && !options.batchMode) {
      setPendingLaunchOptions(options);
      setShowBatchModal(true);
      return;
    }

    setLaunching(true);
    setLaunchAlert(null);
    const backendId = c._backendId || c.id;
    try {
      const result = await api.launchCampaignToLemlist(backendId, {
        batchMode: options.batchMode || false,
        batchSize: 100,
        senderId: selectedSender || undefined,
      });
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
      const baseDesc = `${result.leads?.pushed || 0} prospects · ${stepsOk}/${stepsTotal} steps`;
      const statusLine = result.started
        ? ` · \u2705 ${t('campaigns.started')}`
        : result.startError
          ? ` · \u26A0\uFE0F ${t('campaigns.startFailed', { error: result.startError })}`
          : ` · \u2139\uFE0F ${t('campaigns.inDraft')}`;
      const batchLine = result.batch
        ? ` · \uD83D\uDCE6 Batch ${result.batch.batch}/${result.batch.totalBatches} (${result.batch.remaining} remaining)`
        : '';
      setLaunchAlert({
        type: 'success',
        title: result.batch ? `\uD83D\uDE80 ${t('campaigns.batchDeployed', { batch: result.batch.batch })}` : `\uD83D\uDE80 ${t('campaigns.deployed')}`,
        desc: baseDesc + statusLine + batchLine,
      });
    } catch (err) {
      setLaunchAlert({
        type: 'error',
        title: t('campaigns.launchFailed'),
        desc: err.message || t('campaigns.launchFailedDesc'),
      });
    }
    setLaunching(false);
  };

  /* ── Enrich prospects handler ── */
  const hasProspects = (c.kpis?.contacts || c.nb_prospects || 0) > 0;

  const handleEnrichProspects = async () => {
    setEnriching(true);
    setEnrichBanner(null);
    try {
      const backendId = c._backendId || c.id;
      const result = await api.enrichCampaignProspects(backendId);
      setEnrichBanner({
        type: 'success',
        title: t('campaigns.enrichDoneTitle', { count: result.enriched }),
        desc: t('campaigns.enrichDoneDesc', { skipped: result.skipped, errors: result.errors || 0 }),
      });
    } catch (err) {
      setEnrichBanner({
        type: 'error',
        title: t('campaigns.enrichFailed'),
        desc: err.message || t('campaigns.enrichFailedDesc'),
      });
    }
    setEnriching(false);
  };

  /* ── Tags ── */
  const tags = [c.channelLabel, c.sector, c.size, c.angle, c.zone].filter(Boolean);

  return (
    <div className="campaign-detail">
      {/* Batch mode confirmation modal */}
      {showBatchModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9997,
          background: 'rgba(10, 10, 15, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-card, #18181b)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '32px',
            maxWidth: 440,
            width: '90%',
            boxShadow: '0 25px 80px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
              {t('campaigns.launch')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              {t('campaigns.batchModalDesc', { count: c.kpis?.contacts || c.nb_prospects || 0 }) ||
                `Tu as ${c.kpis?.contacts || c.nb_prospects || 0} prospects. Comment veux-tu lancer ?`}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ padding: '12px 16px', fontSize: 13, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}
                onClick={() => {
                  setShowBatchModal(false);
                  handleLaunch({ ...pendingLaunchOptions, batchMode: true, confirmed: true });
                }}
              >
                <span style={{ fontSize: 18 }}>📦</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{t('campaigns.batchModeBtn') || 'Mode batch (recommandé)'}</div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
                    {t('campaigns.batchModeDesc') || 'Envoie les 100 premiers, A/B test, puis batch suivant'}
                  </div>
                </div>
              </button>

              <button
                className="btn btn-ghost"
                style={{ padding: '12px 16px', fontSize: 13, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)' }}
                onClick={() => {
                  setShowBatchModal(false);
                  handleLaunch({ ...pendingLaunchOptions, batchMode: false, confirmed: true });
                }}
              >
                <span style={{ fontSize: 18 }}>🚀</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600 }}>{t('campaigns.sendAllBtn') || 'Tout envoyer'}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                    {t('campaigns.sendAllDesc', { count: c.kpis?.contacts || c.nb_prospects || 0 }) ||
                      `Envoyer les ${c.kpis?.contacts || c.nb_prospects || 0} prospects d'un coup`}
                  </div>
                </div>
              </button>

              <button
                className="btn btn-ghost"
                style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}
                onClick={() => setShowBatchModal(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <LoadingOverlay
        show={launching}
        title={`\uD83D\uDE80 ${t('campaigns.deployToLemlist')}`}
        steps={LEMLIST_LAUNCH_STEPS}
      />

      {/* Back button */}
      <button className="campaign-detail-back" onClick={onBack}>
        {'\u2190'} {t('campaigns.backToCampaigns')}
      </button>

      {/* Header */}
      <div className="campaign-detail-header">
        <div>
          <div className="campaign-detail-title">{c.name}</div>
          <div className="campaign-detail-tags">
            {tags.map((tg, i) => (
              <span className="campaign-tag" key={i}>{tg}</span>
            ))}
            {isPrep && (
              <span className="campaign-tag" style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}>
                {'\u23F3'} {t('campaigns.prep')}
              </span>
            )}
            {isActive && (
              <span className="campaign-tag" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
                {'\u25CF'} {t('campaigns.statusActive')}
              </span>
            )}
            {isArchived && (
              <span className="campaign-tag" style={{ borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}>
                {'\uD83D\uDCE6'} {t('campaigns.statusArchived')}
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
              {archiving ? '...' : `\uD83D\uDCE6 ${t('campaigns.archive')}`}
            </button>
          )}
          {isActive && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: '12px', padding: '8px 14px' }}
                onClick={() => setShowOptimize(true)}
              >
                {'\uD83D\uDD04'} {t('campaigns.optimizeCampaign')}
              </button>
              <button
                onClick={() => setShowHelp(prev => !prev)}
                onMouseEnter={() => setShowHelp(true)}
                onMouseLeave={() => setShowHelp(false)}
                aria-label={t('campaigns.optimizeHelpLabel')}
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
              {showHelp && <OptimizeHelpTooltip t={t} />}
            </div>
          )}
          {isPrep && hasProspects && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '8px 14px', color: 'var(--accent)' }}
              onClick={handleEnrichProspects}
              disabled={enriching}
            >
              {enriching ? `\u23F3 ${t('campaigns.enriching')}` : `\u2728 ${t('campaigns.enrichProspects')}`}
            </button>
          )}
          {isPrep && (
            <button
              className="btn btn-success"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={handleLaunch}
              disabled={launching}
            >
              {launching ? `\u23F3 ${t('campaigns.launching')}` : `\uD83D\uDE80 ${t('campaigns.launch')}`}
            </button>
          )}
          {isActive && c.batch_mode && c.current_batch < c.total_batches && (
            <button
              className="btn btn-success"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={() => handleLaunch({ batchMode: true, confirmed: true })}
              disabled={launching}
            >
              {launching
                ? `\u23F3 ${t('campaigns.deploying')}`
                : `\uD83D\uDCE6 ${t('campaigns.launchBatch', { current: (c.current_batch || 0) + 1, total: c.total_batches })}`}
            </button>
          )}
          {isPrep && senders.length > 1 && (
            <select
              value={selectedSender || ''}
              onChange={e => setSelectedSender(e.target.value)}
              style={{
                fontSize: 11,
                padding: '6px 10px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
              title={t('campaigns.senderTitle')}
            >
              {senders.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email}){s.linkedinConnected ? ' + LinkedIn' : ''}
                </option>
              ))}
            </select>
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
          <span style={{ fontSize: 18 }}>{'\u2705'}</span>
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
            {'\u2715'}
          </button>
        </div>
      )}

      {/* Enrichment banner */}
      {enrichBanner && (
        <div
          style={{
            background: enrichBanner.type === 'error' ? 'var(--danger-bg)' : 'rgba(0, 214, 143, 0.1)',
            border: `1px solid ${enrichBanner.type === 'error' ? 'rgba(255,107,107,0.3)' : 'rgba(0, 214, 143, 0.3)'}`,
            borderRadius: '12px',
            padding: '14px 16px',
            margin: '16px 0',
            fontSize: 13,
            color: enrichBanner.type === 'error' ? 'var(--danger)' : 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 18 }}>{enrichBanner.type === 'error' ? '\u26A0\uFE0F' : '\u2728'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{enrichBanner.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {enrichBanner.desc}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '6px 12px' }}
            onClick={() => setEnrichBanner(null)}
          >
            {'\u2715'}
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
              title: t('campaigns.optimizeDeployedTitle', { count: stepsCount, plural: stepsCount > 1 ? 's' : '' }),
              desc: t('campaigns.optimizeDeployedDesc'),
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
            {launchAlert.type === 'error' ? '\u26A0\uFE0F' : launchAlert.type === 'success' ? '\u2705' : '\u23F3'}
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
            {'\u2715'}
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
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setActiveTab(tb.key)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'transparent',
              borderBottom: `2px solid ${activeTab === tb.key ? 'var(--accent)' : 'transparent'}`,
              color: activeTab === tb.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tb.key ? 600 : 500,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {tb.icon} {tb.label}
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

function OptimizeHelpTooltip({ t }) {
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
        {t('campaigns.optimizeHelpTitle')}
      </div>
      <div style={{ marginBottom: 10 }}>
        {t('campaigns.optimizeHelpBody')}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <div>{'\u2022'} {t('campaigns.optimizeHelpMinProspects')}</div>
        <div>{'\u2022'} {t('campaigns.optimizeHelpFrequency')}</div>
        <div>{'\u2022'} {t('campaigns.optimizeHelpMemory')}</div>
      </div>
    </div>
  );
}
