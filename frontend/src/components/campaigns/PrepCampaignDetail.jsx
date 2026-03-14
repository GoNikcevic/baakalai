/* ═══════════════════════════════════════════════════
   Prep Campaign Detail Component
   ═══════════════════════════════════════════════════ */

import { useState } from 'react';
import SequenceStep from './SequenceStep';
import EditParamsPanel from './EditParamsPanel';
import { InfoRow, CheckItem } from './shared';
import api from '../../services/api-client';
import { sanitizeHtml } from '../../services/sanitize';

export default function PrepCampaignDetail({ campaign: c, onBack, setCampaigns }) {
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

    // Launch the campaign — persist to backend then update local state
    const updates = {
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
    };

    // Persist to backend
    const backendId = c._backendId || c.id;
    api.updateCampaign(backendId, { status: 'active', iteration: 1 }).catch((err) => {
      console.warn('Failed to persist campaign launch:', err.message);
    });

    setCampaigns((prev) => ({
      ...prev,
      [c.id]: { ...prev[c.id], ...updates },
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
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(c.preLaunchReco.text) }}
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
