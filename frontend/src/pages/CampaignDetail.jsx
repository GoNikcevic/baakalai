/* ===============================================================================
   BAKAL — Campaign Detail Page (React)
   Full campaign detail view for active and prep campaigns.
   Migrated from campaigns-detail.js (renderActiveCampaign / renderPrepCampaign).
   =============================================================================== */

import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

export default function CampaignDetail({ campaignId, onBack }) {
  const { campaigns, setCampaigns } = useApp();
  const campaign = campaigns[campaignId];

  if (!campaign) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p>Campagne introuvable.</p>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Retour aux campagnes
        </button>
      </div>
    );
  }

  if (campaign.status === 'prep') {
    return <PrepCampaignDetail campaign={campaign} onBack={onBack} setCampaigns={setCampaigns} />;
  }

  return <ActiveCampaignDetail campaign={campaign} onBack={onBack} setCampaigns={setCampaigns} />;
}


/* ═══════════════════════════════════════════════════
   Active Campaign Detail
   ═══════════════════════════════════════════════════ */

function ActiveCampaignDetail({ campaign: c, onBack, setCampaigns }) {
  const [paused, setPaused] = useState(false);
  const [showABPanel, setShowABPanel] = useState(false);
  const [abLaunched, setAbLaunched] = useState(null);

  const isLinkedin = c.channel === 'linkedin';
  const iterColor = c.iteration >= 3 ? 'var(--success)' : 'var(--warning)';

  /* ── Tags ── */
  const tags = [
    c.channelLabel,
    c.sector,
    c.size,
    c.angle,
    c.zone,
  ];

  /* ── KPIs ── */
  const kpiItems = useMemo(() => {
    const volumePct =
      c.volume?.planned > 0
        ? (c.volume.sent / c.volume.planned) * 100
        : 0;

    if (isLinkedin) {
      return [
        { value: c.kpis?.contacts, label: 'Prospects contactes', pct: volumePct, color: 'var(--accent)' },
        { value: (c.kpis?.acceptRate ?? 0) + '%', label: "Taux d'acceptation", pct: c.kpis?.acceptRate ?? 0, color: 'var(--success)' },
        { value: (c.kpis?.replyRate ?? 0) + '%', label: 'Taux de reponse', pct: (c.kpis?.replyRate ?? 0) * 10, color: c.kpis?.replyRate >= 8 ? 'var(--blue)' : 'var(--warning)' },
        { value: c.kpis?.interested ?? 0, label: 'Interesses', pct: (c.kpis?.interested ?? 0) * 10, color: 'var(--warning)' },
        { value: c.kpis?.meetings ?? 0, label: 'RDV obtenus', pct: c.kpis?.meetings > 0 ? (c.kpis.meetings / 6) * 100 : 0, color: 'var(--text-secondary)' },
      ];
    }
    return [
      { value: c.kpis?.contacts, label: 'Prospects contactes', pct: volumePct, color: 'var(--accent)' },
      { value: (c.kpis?.openRate ?? 0) + '%', label: "Taux d'ouverture", pct: c.kpis?.openRate ?? 0, color: 'var(--success)' },
      { value: (c.kpis?.replyRate ?? 0) + '%', label: 'Taux de reponse', pct: (c.kpis?.replyRate ?? 0) * 10, color: 'var(--blue)' },
      { value: c.kpis?.interested ?? 0, label: 'Interesses', pct: (c.kpis?.interested ?? 0) * 10, color: 'var(--warning)' },
      { value: c.kpis?.meetings ?? 0, label: 'RDV obtenus', pct: c.kpis?.meetings > 0 ? (c.kpis.meetings / 6) * 100 : 0, color: 'var(--text-secondary)' },
    ];
  }, [c, isLinkedin]);

  /* ── Sequence info ── */
  const channelIcon = isLinkedin ? '💼' : '📧';
  const channelName = isLinkedin ? 'LinkedIn' : 'email';
  const seqDays = (c.sequence || []).map((s) => s.timing).join(', ');
  const duration =
    c.sequence?.length > 1
      ? parseInt(c.sequence[c.sequence.length - 1].timing.replace('J+', ''), 10)
      : 0;

  /* ── Action handlers ── */
  const handlePause = () => setPaused((prev) => !prev);

  const handleExport = () => {
    const rows = [['Touchpoint', 'Type', 'Timing', 'Subject', 'Body', 'Open%', 'Reply%']];
    (c.sequence || []).forEach((s) => {
      const body = s.body.replace(/<[^>]*>/g, '').replace(/\n/g, ' ');
      const subject = s.subject ? s.subject.replace(/<[^>]*>/g, '') : '';
      rows.push([s.id, s.type, s.timing, subject, body, s.stats?.open ?? '', s.stats?.reply ?? '']);
    });
    const csv = rows
      .map((r) => r.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${c.name.replace(/[^a-zA-Z0-9]/g, '_')}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLaunchAB = () => setShowABPanel((prev) => !prev);

  const handleConfirmAB = (stepId) => {
    setAbLaunched(stepId);
    setTimeout(() => setShowABPanel(false), 3000);
  };

  /* ── Volume bar ── */
  const volumePct = c.volume?.planned > 0 ? Math.round((c.volume.sent / c.volume.planned) * 100) : 0;
  const barColor = isLinkedin ? 'var(--purple)' : 'var(--accent)';

  const opacity = paused ? 0.5 : 1;

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
              <span className="campaign-tag" key={i}>
                {t}
              </span>
            ))}
            <span
              className="campaign-tag"
              style={{ borderColor: iterColor, color: iterColor }}
            >
              Iteration {c.iteration}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{
              fontSize: '12px',
              padding: '8px 14px',
              ...(paused
                ? { borderColor: 'var(--success)', color: 'var(--success)' }
                : {}),
            }}
            onClick={handlePause}
          >
            {paused ? '▶️ Reprendre' : '⏸ Pause'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={handleExport}
          >
            📥 Exporter
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={handleLaunchAB}
          >
            🧬 Lancer un test A/B
          </button>
        </div>
      </div>

      {/* A/B Test Panel */}
      {showABPanel && (
        <ABTestPanel
          sequence={c.sequence || []}
          campaignId={c.id}
          onConfirm={handleConfirmAB}
          onClose={() => setShowABPanel(false)}
          launched={abLaunched}
        />
      )}

      {/* KPIs */}
      <div className="campaign-kpis" style={{ opacity }}>
        {kpiItems.map((k, i) => (
          <div className="campaign-kpi" key={i}>
            <div className="campaign-kpi-value" style={{ color: k.color }}>
              {k.value}
            </div>
            <div className="campaign-kpi-label">{k.label}</div>
            <div className="campaign-kpi-bar">
              <div
                className="campaign-kpi-fill"
                style={{ width: `${k.pct}%`, background: k.color }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      {/* Sequence */}
      <div className="sequence-card" style={{ opacity }}>
        <div className="sequence-header">
          <div className="sequence-title">
            {channelIcon} Sequence {channelName} — {(c.sequence || []).length}{' '}
            touchpoints
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Duree : {duration} jours &middot; {seqDays}
          </div>
        </div>
        <div className="sequence-steps">
          {(c.sequence || []).map((step) => (
            <SequenceStep key={step.id} step={step} faded={false} />
          ))}
        </div>
      </div>

      {/* Diagnostics */}
      {(c.diagnostics || []).length > 0 && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            🤖 Diagnostic par etape — Claude
          </div>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            {c.diagnostics.map((d, i) => (
              <DiagBlock key={i} color={d.level} title={d.title} text={d.text} />
            ))}
          </div>
        </div>
      )}

      {/* History + Info grid */}
      <div
        className="section-grid"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        {/* History */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">📜 Historique des modifications</div>
          </div>
          <div className="card-body">
            <div className="mod-history">
              {(c.history || []).map((h, i) => (
                <div className="mod-item" key={i}>
                  <div className="mod-version">{h.version}</div>
                  <div className="mod-content">
                    <div className="mod-title">{h.title}</div>
                    <div className="mod-desc">{h.desc}</div>
                    <div className={`mod-result ${h.result}`}>
                      {h.resultText}
                    </div>
                  </div>
                  <div className="mod-date">{h.date}</div>
                </div>
              ))}
              {(c.history || []).length === 0 && (
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-muted)',
                    padding: '16px 0',
                    textAlign: 'center',
                  }}
                >
                  Aucune modification enregistree.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info panel */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">ℹ️ Informations campagne</div>
          </div>
          <div className="card-body">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <InfoRow label="Client" content={<strong>{c.client}</strong>} />
              <InfoRow label="Periode" content={c.info?.period} />

              {/* Volume bar */}
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '4px',
                  }}
                >
                  Volume envoye
                </div>
                <div style={{ fontSize: '14px' }}>
                  {c.volume?.sent} / {c.volume?.planned} prospects prevus
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: 'var(--bg-elevated)',
                    borderRadius: '3px',
                    marginTop: '6px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${volumePct}%`,
                      height: '100%',
                      background: barColor,
                      borderRadius: '3px',
                    }}
                  ></div>
                </div>
              </div>

              <InfoRow
                label="Copy"
                content={
                  <span
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {c.info?.copyDesc}
                  </span>
                }
              />

              {c.lemlistRef && (
                <InfoRow
                  label="Source Lemlist"
                  content={
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '12px',
                        background: 'var(--bg-elevated)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      {c.lemlistRef}
                    </span>
                  }
                />
              )}

              {/* Next action */}
              {c.nextAction && (
                <div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '4px',
                    }}
                  >
                    Prochaine action
                  </div>
                  <div
                    style={{
                      background:
                        c.nextAction.type === 'testing'
                          ? 'var(--accent-glow)'
                          : 'var(--warning-bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '13px',
                      color:
                        c.nextAction.type === 'testing'
                          ? 'var(--text-primary)'
                          : 'var(--warning)',
                    }}
                  >
                    {c.nextAction.type === 'testing' ? '🧬' : '⚡'}{' '}
                    {c.nextAction.text}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Prep Campaign Detail
   ═══════════════════════════════════════════════════ */

function PrepCampaignDetail({ campaign: c, onBack, setCampaigns }) {
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [launchAlert, setLaunchAlert] = useState(null);
  const [recoApplied, setRecoApplied] = useState(false);
  const [recoDismissed, setRecoDismissed] = useState(false);

  /* ── Tags ── */
  const tags = [
    c.channelLabel,
    c.sector,
    c.size,
    c.angle,
    c.zone,
  ];

  const emailCount = (c.sequence || []).filter((s) => s.type === 'email').length;
  const linkedinCount = (c.sequence || []).filter(
    (s) => s.type === 'linkedin'
  ).length;

  /* ── Launch handler ── */
  const handleLaunch = () => {
    if (!c.sequence || c.sequence.length === 0) {
      setLaunchAlert({
        type: 'error',
        title: 'Impossible de lancer — sequences manquantes',
        desc: "Generez d'abord les sequences via Claude depuis l'editeur Copy & Sequences.",
      });
      return;
    }

    const notDone = (c.prepChecklist || []).filter((ch) => !ch.done);
    if (notDone.length > 1) {
      setLaunchAlert({
        type: 'warning',
        title: 'Etapes de preparation incompletes',
        desc: `${notDone.length} etape(s) restante(s) : ${notDone.map((n) => n.title).join(', ')}`,
      });
      return;
    }

    // Launch the campaign
    setCampaigns((prev) => ({
      ...prev,
      [c.id]: {
        ...prev[c.id],
        status: 'active',
        iteration: 1,
        startDate: new Date().toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'short',
        }),
        kpis: {
          contacts: 0,
          openRate: 0,
          replyRate: 0,
          interested: 0,
          meetings: 0,
          stops: 0,
        },
      },
    }));
  };

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
              <span className="campaign-tag" key={i}>
                {t}
              </span>
            ))}
            <span
              className="campaign-tag"
              style={{
                borderColor: 'var(--warning)',
                color: 'var(--warning)',
              }}
            >
              En preparation
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={() => setShowEditPanel((prev) => !prev)}
          >
            ✏️ Modifier
          </button>
          <button
            className="btn btn-success"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={handleLaunch}
          >
            🚀 Lancer la campagne
          </button>
        </div>
      </div>

      {/* Launch alert */}
      {launchAlert && (
        <div
          style={{
            background:
              launchAlert.type === 'error'
                ? 'var(--danger-bg)'
                : 'var(--warning-bg)',
            border: `1px solid ${launchAlert.type === 'error' ? 'rgba(255,107,107,0.3)' : 'rgba(255,170,0,0.3)'}`,
            borderRadius: '12px',
            padding: '16px',
            margin: '16px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '18px' }}>
            {launchAlert.type === 'error' ? '⚠️' : '⏳'}
          </span>
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: `var(--${launchAlert.type === 'error' ? 'danger' : 'warning'})`,
              }}
            >
              {launchAlert.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {launchAlert.desc}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{
              fontSize: '11px',
              padding: '6px 12px',
              marginLeft: 'auto',
            }}
            onClick={() => setLaunchAlert(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Edit params panel */}
      {showEditPanel && (
        <EditParamsPanel
          campaign={c}
          setCampaigns={setCampaigns}
          onClose={() => setShowEditPanel(false)}
        />
      )}

      {/* Checklist */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            fontSize: '15px',
            fontWeight: 600,
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          📋 Checklist de preparation
        </div>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {(c.prepChecklist || []).map((ch, i) => (
            <CheckItem key={i} item={ch} />
          ))}
        </div>
      </div>

      {/* Sequence preview */}
      <div className="sequence-card">
        <div className="sequence-header">
          <div className="sequence-title">
            👁️ Apercu des sequences — En attente de validation
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {(c.sequence || []).length} touchpoints &middot; Email ({emailCount})
            + LinkedIn ({linkedinCount})
          </div>
        </div>
        <div className="sequence-steps">
          {(c.sequence || []).map((step, i) => (
            <SequenceStep key={step.id} step={step} faded={i >= 3} />
          ))}
        </div>
      </div>

      {/* Pre-launch AI recommendation */}
      {c.preLaunchReco && !recoDismissed && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            marginBottom: '24px',
          }}
        >
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            🤖 Recommandation pre-lancement — Claude
          </div>
          <div
            style={{
              background: 'var(--bg-elevated)',
              borderRadius: '8px',
              padding: '16px',
              borderLeft: `3px solid ${recoApplied ? 'var(--success)' : 'var(--accent)'}`,
              lineHeight: 1.65,
              opacity: recoDismissed ? 0.4 : 1,
            }}
          >
            <div
              style={{ fontSize: '13px', color: 'var(--text-secondary)' }}
              dangerouslySetInnerHTML={{ __html: c.preLaunchReco.text }}
            />
            <div
              style={{ display: 'flex', gap: '8px', marginTop: '14px' }}
            >
              {recoApplied ? (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--success)',
                    fontWeight: 600,
                  }}
                >
                  ✅ Suggestion appliquee — sera integree dans la generation des
                  sequences
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-success"
                    style={{ fontSize: '12px', padding: '8px 14px' }}
                    onClick={() => setRecoApplied(true)}
                  >
                    ✅ Appliquer la suggestion
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', padding: '8px 14px' }}
                    onClick={() => setRecoDismissed(true)}
                  >
                    ❌ Garder tel quel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info panel */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">ℹ️ Informations campagne</div>
        </div>
        <div className="card-body">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '24px',
            }}
          >
            <InfoRow label="Client" content={<strong>{c.client}</strong>} />
            <InfoRow
              label="Creee le"
              content={c.info?.createdDate || c.startDate}
            />
            <InfoRow
              label="Volume prevu"
              content={c.info?.volumeDesc || `${c.volume?.planned} prospects`}
            />
            <InfoRow
              label="Copy"
              content={
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {c.info?.copyDesc}
                </span>
              }
            />
            <InfoRow
              label="Canaux"
              content={
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {c.info?.channelsDesc || 'Email + LinkedIn'}
                </span>
              }
            />
            <InfoRow
              label="Lancement estime"
              content={
                <span
                  style={{ fontWeight: 600, color: 'var(--warning)' }}
                >
                  {c.info?.launchEstimate || 'Non planifie'}
                </span>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Shared Sub-Components
   ═══════════════════════════════════════════════════ */

/* ── Sequence Step ── */
function SequenceStep({ step: s, faded }) {
  const hasStats = s.stats !== null && s.stats !== undefined;

  const typeLabel =
    s.type === 'linkedin'
      ? `${s.label} — ${s.subType}`
      : `${s.label} — ${s.subType}`;

  let statsContent;
  if (!hasStats) {
    statsContent = (
      <>
        <StepStat value="—" label="Pas encore lance" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
      </>
    );
  } else if (s.type === 'linkedin' && s.stats.accept !== undefined) {
    statsContent = (
      <>
        <StepStat
          value={s.stats.accept + '%'}
          label="Acceptation"
          color="var(--success)"
          pct={s.stats.accept}
        />
        <StepStat value="—" label="—" color="var(--text-muted)" />
        <StepStat
          value="0%"
          label="Ignore"
          color="var(--text-muted)"
          pct={0}
          barColor="var(--danger)"
        />
      </>
    );
  } else if (s.type === 'linkedin') {
    statsContent = (
      <>
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color={s.stats.reply >= 8 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.interested || '—'}
          label={s.stats.interested ? 'Interesses' : '—'}
          color="var(--warning)"
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  } else {
    statsContent = (
      <>
        <StepStat
          value={s.stats.open + '%'}
          label="Ouverture"
          color={s.stats.open >= 50 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.open}
        />
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color="var(--blue)"
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  }

  return (
    <div className="sequence-step" style={faded ? { opacity: 0.5 } : undefined}>
      <div className="step-indicator">
        <div className={`step-dot ${s.type}`}>{s.id}</div>
        <div className="step-label">{s.timing}</div>
      </div>
      <div className="step-content">
        {s.subject && (
          <div className="step-subject">Objet : {s.subject}</div>
        )}
        <div className="step-type">{typeLabel}</div>
        <div
          className="step-preview"
          dangerouslySetInnerHTML={{ __html: s.body }}
        />
      </div>
      {statsContent}
    </div>
  );
}

/* ── Step Stat ── */
function StepStat({ value, label, color, pct, barColor }) {
  return (
    <div className="step-stat">
      <div className="step-stat-value" style={{ color }}>
        {value}
      </div>
      <div className="step-stat-label">{label}</div>
      {pct !== undefined && (
        <div className="step-stat-bar">
          <div
            className="step-stat-fill"
            style={{ width: `${pct}%`, background: barColor || color }}
          ></div>
        </div>
      )}
    </div>
  );
}

/* ── Diagnostic Block ── */
function DiagBlock({ color, title, text }) {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: '8px',
        padding: '14px',
        borderLeft: `3px solid var(--${color})`,
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: `var(--${color})`,
          marginBottom: '4px',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
        dangerouslySetInnerHTML={{ __html: text }}
      />
    </div>
  );
}

/* ── Info Row ── */
function InfoRow({ label, content }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '14px' }}>{content}</div>
    </div>
  );
}

/* ── Check Item ── */
function CheckItem({ item: ch }) {
  const bg = ch.highlight
    ? 'var(--warning-bg)'
    : 'var(--bg-elevated)';
  const border = ch.highlight
    ? '1px solid rgba(255,170,0,0.2)'
    : 'none';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        background: bg,
        border,
        borderRadius: '8px',
      }}
    >
      <span
        style={{ color: `var(--${ch.statusColor})`, fontSize: '18px' }}
      >
        {ch.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            ...(ch.statusColor === 'text-muted'
              ? { color: 'var(--text-muted)' }
              : {}),
          }}
        >
          {ch.title}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {ch.desc}
        </div>
      </div>
      <span
        style={{
          fontSize: '12px',
          color: `var(--${ch.statusColor})`,
          fontWeight: 600,
        }}
      >
        {ch.status}
      </span>
    </div>
  );
}

/* ── A/B Test Panel ── */
function ABTestPanel({ sequence, campaignId, onConfirm, onClose, launched }) {
  const [selectedStep, setSelectedStep] = useState(
    sequence.length > 0 ? sequence[0].id : ''
  );
  const [split, setSplit] = useState('50/50');

  if (launched) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--success)',
          borderRadius: '12px',
          padding: '24px',
          margin: '16px 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 0',
          }}
        >
          <span style={{ fontSize: '20px' }}>🧬</span>
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--success)',
              }}
            >
              Test A/B lance sur {launched}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Regeneration en cours par Claude &middot; Resultats estimes dans
              5-7 jours
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="ab-test-panel"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent)',
        borderRadius: '12px',
        padding: '24px',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          🧬 Configurer un test A/B
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', padding: '6px 12px' }}
          onClick={onClose}
        >
          ✕ Fermer
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            Touchpoint a tester
          </div>
          <select
            className="form-select"
            value={selectedStep}
            onChange={(e) => setSelectedStep(e.target.value)}
          >
            {sequence.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            Repartition
          </div>
          <select
            className="form-select"
            value={split}
            onChange={(e) => setSplit(e.target.value)}
          >
            <option>50/50 (recommande)</option>
            <option>70/30</option>
            <option>80/20</option>
          </select>
        </div>
      </div>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '16px',
        }}
      >
        Claude va generer une variante B automatiquement basee sur les donnees
        cross-campagne.
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={() => onConfirm(selectedStep)}
        >
          🧬 Lancer le test
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={onClose}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

/* ── Edit Params Panel (prep campaigns) ── */
function EditParamsPanel({ campaign: c, setCampaigns, onClose }) {
  const [sector, setSector] = useState(c.sector || '');
  const [angle, setAngle] = useState(c.angle || '');
  const [tone, setTone] = useState(c.tone || '');

  const angles = [
    'Douleur client',
    'Preuve sociale',
    'Offre directe',
    'Contenu educatif',
  ];
  const tones = [
    'Pro decontracte',
    'Formel & Corporate',
    'Direct & punchy',
  ];

  const handleSave = () => {
    setCampaigns((prev) => {
      const updated = { ...prev[c.id] };
      updated.sector = sector;
      updated.sectorShort = sector.split(' ')[0];
      updated.angle = angle;
      updated.tone = tone;
      updated.info = {
        ...updated.info,
        copyDesc: `${tone} \u00B7 ${updated.formality || 'Vous'} \u00B7 ${angle} \u00B7 FR`,
      };
      return { ...prev, [c.id]: updated };
    });
    onClose();
  };

  return (
    <div
      className="edit-params-panel"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent)',
        borderRadius: '12px',
        padding: '24px',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          ✏️ Modifier les parametres
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', padding: '6px 12px' }}
          onClick={onClose}
        >
          ✕ Fermer
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Secteur
          </div>
          <input
            className="form-input"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Angle
          </div>
          <select
            className="form-select"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          >
            {angles.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Ton
          </div>
          <select
            className="form-select"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            {tones.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ fontSize: '12px', padding: '8px 14px' }}
        onClick={handleSave}
      >
        💾 Sauvegarder
      </button>
    </div>
  );
}
