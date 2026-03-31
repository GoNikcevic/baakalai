/* ═══════════════════════════════════════════════════
   Active Campaign Detail Component
   ═══════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import SequenceTree from './SequenceTree';
import ABTestPanel from './ABTestPanel';
import DiagnosticPanel from './DiagnosticPanel';
import VersionDiff from './VersionDiff';
import { DiagBlock, InfoRow } from './shared';
import api from '../../services/api-client';

export default function ActiveCampaignDetail({ campaign: c, onBack, setCampaigns }) {
  const [paused, setPaused] = useState(false);
  const [showABPanel, setShowABPanel] = useState(false);
  const [abLaunched, setAbLaunched] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
        { value: c.kpis?.contacts, label: 'Prospects contactés', pct: volumePct, color: 'var(--accent)' },
        { value: (c.kpis?.acceptRate ?? 0) + '%', label: "Taux d'acceptation", pct: c.kpis?.acceptRate ?? 0, color: 'var(--success)' },
        { value: (c.kpis?.replyRate ?? 0) + '%', label: 'Taux de réponse', pct: (c.kpis?.replyRate ?? 0) * 10, color: c.kpis?.replyRate >= 8 ? 'var(--blue)' : 'var(--warning)' },
        { value: c.kpis?.interested ?? 0, label: 'Intéressés', pct: (c.kpis?.interested ?? 0) * 10, color: 'var(--warning)' },
        { value: c.kpis?.meetings ?? 0, label: 'RDV obtenus', pct: c.kpis?.meetings > 0 ? (c.kpis.meetings / 6) * 100 : 0, color: 'var(--text-secondary)' },
      ];
    }
    return [
      { value: c.kpis?.contacts, label: 'Prospects contactes', pct: volumePct, color: 'var(--accent)' },
      { value: (c.kpis?.openRate ?? 0) + '%', label: "Taux d'ouverture", pct: c.kpis?.openRate ?? 0, color: 'var(--success)' },
      { value: (c.kpis?.replyRate ?? 0) + '%', label: 'Taux de réponse', pct: (c.kpis?.replyRate ?? 0) * 10, color: 'var(--blue)' },
      { value: c.kpis?.interested ?? 0, label: 'Intéressés', pct: (c.kpis?.interested ?? 0) * 10, color: 'var(--warning)' },
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

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer la campagne "${c.name}" ? Cette action est irreversible.`)) return;
    setDeleting(true);
    try {
      const backendId = c._backendId || c.id;
      await api.request('/campaigns/' + backendId, { method: 'DELETE' });
    } catch (err) {
      console.warn('Failed to delete campaign on backend:', err.message);
    }
    if (setCampaigns) {
      setCampaigns((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
    }
    onBack();
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
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '8px 14px', color: 'var(--danger)' }}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? '...' : '🗑 Supprimer'}
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
            Durée : {duration} jours &middot; {seqDays}
          </div>
        </div>
        <div className="sequence-steps">
          <SequenceTree sequence={c.sequence} />
        </div>
      </div>

      {/* Diagnostics */}
      <DiagnosticPanel campaignId={c._backendId || c.id} sequence={c.sequence} />

      {/* History + Info grid */}
      <div
        className="section-grid"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        {/* History */}
        <VersionDiff campaignId={c._backendId || c.id} sequence={c.sequence} />

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
                  Volume envoyé
                </div>
                <div style={{ fontSize: '14px' }}>
                  {c.volume?.sent} / {c.volume?.planned} prospects prévus
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
