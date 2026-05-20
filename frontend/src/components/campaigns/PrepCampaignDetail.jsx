/* ═══════════════════════════════════════════════════
   Prep Campaign Detail Component
   ═══════════════════════════════════════════════════ */

import { useState } from 'react';
import SequenceTree from './SequenceTree';
import EditParamsPanel from './EditParamsPanel';
import ProspectGenerator from './ProspectGenerator';
import { InfoRow, CheckItem } from './shared';
import api from '../../services/api-client';
import { sanitizeHtml } from '../../services/sanitize';
import LoadingOverlay from '../shared/LoadingOverlay';
import { useI18n } from '../../i18n';

export default function PrepCampaignDetail({ campaign: c, onBack, setCampaigns }) {
  const { lang } = useI18n(); const en = lang === 'en';

  const LEMLIST_LAUNCH_STEPS = en
    ? ['Creating campaign on Lemlist...', 'Deploying email & LinkedIn sequences...', 'Adding prospects to the list...', 'Activating campaign...']
    : ['Création de la campagne sur Lemlist…', 'Déploiement des séquences email & LinkedIn…', 'Ajout des prospects dans la liste…', 'Activation de la campagne…'];
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [launchAlert, setLaunchAlert] = useState(null);
  const [recoApplied, setRecoApplied] = useState(false);
  const [recoDismissed, setRecoDismissed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchingSF, setLaunchingSF] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const handleArchive = async () => {
    if (!window.confirm(en ? `Archive campaign "${c.name}"? It will be removed from the main list but remain accessible via the "Archived" filter.` : `Archiver la campagne "${c.name}" ? Elle sortira de la liste principale mais reste consultable via le filtre "Archivées".`)) return;
    setArchiving(true);
    try {
      const backendId = c._backendId || c.id;
      await api.request('/campaigns/' + backendId, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
    } catch (err) {
      console.warn('Failed to archive campaign:', err.message);
    }
    if (setCampaigns) {
      setCampaigns((prev) => ({
        ...prev,
        [c.id]: { ...prev[c.id], status: 'archived' },
      }));
    }
    onBack();
  };

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
    (s) => s.type && s.type.startsWith('linkedin')
  ).length;

  /* ── Launch handler — deploys to Lemlist ── */
  const handleLaunch = async () => {
    if (!c.sequence || c.sequence.length === 0) {
      setLaunchAlert({
        type: 'error',
        title: en ? 'Cannot launch — missing sequences' : 'Impossible de lancer — séquences manquantes',
        desc: en ? "Generate sequences first via Baakalai from the Copy & Sequences editor." : "Générez d'abord les séquences via Baakalai depuis l'éditeur Copy & Séquences.",
      });
      return;
    }

    setLaunching(true);
    setLaunchAlert(null);
    const backendId = c._backendId || c.id;

    try {
      const result = await api.launchCampaignToLemlist(backendId);

      // Update local state
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
      const baseDesc = `${result.leads?.pushed || 0} prospects ajoutés · ${stepsOk}/${stepsTotal} étapes de séquence créées`;
      const statusLine = result.started
        ? ' · ✅ Campagne démarrée automatiquement'
        : result.startError
          ? ` · ⚠️ Démarrage auto échoué (${result.startError}) — démarrez manuellement depuis Lemlist`
          : ' · ℹ️ Campagne en draft sur Lemlist (pas de leads/étapes à envoyer)';
      setLaunchAlert({
        type: 'success',
        title: '🚀 Campagne déployée vers Lemlist',
        desc: baseDesc + statusLine,
      });
    } catch (err) {
      setLaunchAlert({
        type: 'error',
        title: en ? 'Lemlist launch failed' : 'Échec du lancement Lemlist',
        desc: err.message || (en ? 'Unknown error — check your Lemlist API key in Integrations.' : 'Erreur inconnue — vérifiez votre clé API Lemlist dans Intégrations.'),
      });
    }
    setLaunching(false);
  };

  /* ── Salesforce deploy handler ── */
  const handleLaunchSalesforce = async () => {
    if (!c.sequence || c.sequence.length === 0) {
      setLaunchAlert({
        type: 'error',
        title: en ? 'Cannot deploy — missing sequences' : 'Impossible de deployer — sequences manquantes',
        desc: en ? 'Generate sequences first via Baakalai.' : "Generez d'abord les sequences via Baakalai.",
      });
      return;
    }

    setLaunchingSF(true);
    setLaunchAlert(null);
    const backendId = c._backendId || c.id;

    try {
      const result = await api.launchCampaignToSalesforce(backendId);

      setLaunchAlert({
        type: 'success',
        title: en ? 'Campaign deployed to Salesforce' : 'Campagne deployee vers Salesforce',
        desc: en
          ? `${result.pushed || 0} contacts pushed, ${result.skipped || 0} skipped${result.errors ? `, ${result.errors} errors` : ''}`
          : `${result.pushed || 0} contacts pousses, ${result.skipped || 0} ignores${result.errors ? `, ${result.errors} erreurs` : ''}`,
      });
    } catch (err) {
      setLaunchAlert({
        type: 'error',
        title: en ? 'Salesforce deploy failed' : 'Echec du deploiement Salesforce',
        desc: err.message || (en ? 'Check your Salesforce connection in Integrations.' : 'Verifiez votre connexion Salesforce dans Integrations.'),
      });
    }
    setLaunchingSF(false);
  };

  return (
    <div className="campaign-detail">
      <LoadingOverlay
        show={launching}
        title={en ? 'Deploying to Lemlist' : '🚀 Déploiement vers Lemlist'}
        steps={LEMLIST_LAUNCH_STEPS}
      />

      {/* Back button */}
      <button className="campaign-detail-back" onClick={onBack}>
        {en ? '← Back to campaigns' : '← Retour aux campagnes'}
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
              {en ? 'In preparation' : 'En préparation'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={() => setShowEditPanel((prev) => !prev)}
          >
            {en ? 'Edit' : '✏️ Modifier'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px', padding: '8px 14px', color: 'var(--text-muted)' }}
            onClick={handleArchive}
            disabled={archiving}
          >
            {archiving ? '...' : (en ? '📦 Archive' : '📦 Archiver')}
          </button>
          <button
            className="btn btn-success"
            style={{ fontSize: '12px', padding: '8px 14px' }}
            onClick={handleLaunch}
            disabled={launching}
          >
            {launching ? (en ? '⏳ Deploying to Lemlist...' : '⏳ Déploiement Lemlist...') : (en ? '🚀 Launch to Lemlist' : '🚀 Lancer vers Lemlist')}
          </button>
          <button
            className="btn"
            style={{ fontSize: '12px', padding: '8px 14px', background: '#00A1E0', color: '#fff', border: 'none' }}
            onClick={handleLaunchSalesforce}
            disabled={launchingSF}
          >
            {launchingSF ? (en ? '⏳ Deploying to Salesforce...' : '⏳ Déploiement Salesforce...') : (en ? 'Deploy to Salesforce' : 'Déployer vers Salesforce')}
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
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: `var(--${launchAlert.type === 'error' ? 'danger' : launchAlert.type === 'success' ? 'success' : 'warning'})`,
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
          {en ? 'Preparation checklist' : '📋 Checklist de préparation'}
        </div>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {(c.prepChecklist || []).map((ch, i) => (
            <CheckItem key={i} item={ch} />
          ))}
        </div>
      </div>

      {/* Prospect generator — Apollo search + bulk add */}
      <ProspectGenerator campaign={c} />

      {/* Sequence preview */}
      <div className="sequence-card">
        <div className="sequence-header">
          <div className="sequence-title">
            {en ? 'Sequence preview — Awaiting validation' : '👁️ Aperçu des séquences — En attente de validation'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {(c.sequence || []).length} touchpoints &middot; Email ({emailCount})
            + LinkedIn ({linkedinCount})
          </div>
        </div>
        <div className="sequence-steps">
          <SequenceTree sequence={c.sequence || []} />
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
            {en ? 'Pre-launch recommendation — Baakalai' : '🤖 Recommandation pré-lancement — Baakalai'}
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
                  {en ? 'Suggestion applied — will be integrated in sequence generation' : '✅ Suggestion appliquée — sera intégrée dans la génération des séquences'}
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-success"
                    style={{ fontSize: '12px', padding: '8px 14px' }}
                    onClick={() => setRecoApplied(true)}
                  >
                    {en ? 'Apply suggestion' : '✅ Appliquer la suggestion'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '12px', padding: '8px 14px' }}
                    onClick={() => setRecoDismissed(true)}
                  >
                    {en ? 'Keep as is' : '❌ Garder tel quel'}
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
          <div className="card-title">{en ? 'Campaign info' : 'ℹ️ Informations campagne'}</div>
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
              label="Créée le"
              content={c.info?.createdDate || c.startDate}
            />
            <InfoRow
              label="Volume prévu"
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
              label="Lancement estimé"
              content={
                <span
                  style={{ fontWeight: 600, color: 'var(--warning)' }}
                >
                  {c.info?.launchEstimate || 'Non planifié'}
                </span>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
