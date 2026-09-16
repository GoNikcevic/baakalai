/* ===============================================================================
   BAKAL — Workflow de relance (enrollments, phase 2)
   Reached from ReactivationQueuePage's "Proposer un workflow". The Deal Coach
   drafts a bespoke multichannel sequence for ONE CRM contact (rationale + steps
   with an optional "accepted" LinkedIn fork). The user reviews/edits the DRAFT,
   then approves — nothing is sent before approval. Once active, the same page
   shows execution progress from the campaign_sends journal.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';
import { useConfirm } from '../components/ConfirmModal';

const LINKEDIN_BLUE = '#0A66C2';
const CHANNEL_META = {
  email: { labelKey: 'workflow.chipEmail', color: 'var(--accent)', bg: 'var(--accent-glow)' },
  linkedin_visit: { labelKey: 'workflow.chipLinkedinVisit', color: LINKEDIN_BLUE, bg: 'rgba(10,102,194,0.10)' },
  linkedin_invite: { labelKey: 'workflow.chipLinkedinInvite', color: LINKEDIN_BLUE, bg: 'rgba(10,102,194,0.10)' },
  linkedin_message: { labelKey: 'workflow.chipLinkedinMessage', color: LINKEDIN_BLUE, bg: 'rgba(10,102,194,0.10)' },
  linkedin: { labelKey: 'workflow.chipLinkedinMessage', color: LINKEDIN_BLUE, bg: 'rgba(10,102,194,0.10)' },
};
const channelMeta = (type) => CHANNEL_META[type] || CHANNEL_META.email;

const parseDays = (timing) => {
  const m = String(timing || '').match(/J\+?(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
};

/** Ordre d'exécution pour la progression : racines puis branches (accepted d'abord). */
function flatten(tree) {
  const out = [];
  const visit = (tp) => {
    out.push(tp);
    const children = [...(tp.children || [])].sort(
      (a, b) => (a.condition_type === 'accepted' ? -1 : 0) - (b.condition_type === 'accepted' ? -1 : 0)
    );
    children.forEach(visit);
  };
  (tree || []).forEach(visit);
  return out;
}

/** Arbre d'état → payload PUT /enrollments/:id/sequence.
 *  L'id backend est conservé : la réconciliation met à jour les steps
 *  existants en place (le journal d'envoi survit) — un id client temporaire
 *  ("new-…", étape ajoutée dans l'UI) est omis pour déclencher une création. */
function serialize(tree) {
  const node = (tp) => ({
    ...(tp.id && !String(tp.id).startsWith('new-') ? { id: tp.id } : {}),
    step: tp.step,
    type: tp.type,
    timing: tp.timing,
    subject: tp.subject ?? null,
    body: tp.body || '',
    conditionType: tp.condition_type || null,
    branchLabel: tp.branch_label || null,
    children: (tp.children || []).map(node),
  });
  return (tree || []).map(node);
}

let newStepCounter = 0;
function blankStep() {
  newStepCounter += 1;
  return {
    id: `new-${newStepCounter}`,
    step: `N${newStepCounter}`,
    type: 'email',
    timing: 'J+3',
    subject: '',
    body: '',
    condition_type: null,
    branch_label: null,
    children: [],
  };
}

/** Logo baakalai animé pendant la génération : le nœud central pulse, les
 *  satellites s'allument tour à tour — le système « réfléchit ». */
function LogoPulse() {
  return (
    <div style={{ marginBottom: 18 }}>
      <style>{`
        .wf-logo .wf-core { animation: wf-pulse 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .wf-logo .wf-sat { animation: wf-blink 1.6s ease-in-out infinite; }
        .wf-logo .wf-sat2 { animation-delay: .35s; }
        .wf-logo .wf-sat3 { animation-delay: .7s; }
        @keyframes wf-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
        @keyframes wf-blink { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .wf-logo .wf-core, .wf-logo .wf-sat { animation: none; }
        }
      `}</style>
      <svg className="wf-logo" width="56" height="56" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" />
        <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round" />
        <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" />
        <circle className="wf-sat wf-sat1" cx="22" cy="26" r="7" fill="#C4B5FD" />
        <circle className="wf-sat wf-sat2" cx="82" cy="30" r="8" fill="#9A84EB" />
        <circle className="wf-sat wf-sat3" cx="30" cy="80" r="7" fill="#C4B5FD" />
        <circle className="wf-core" cx="50" cy="50" r="13" fill="#6E57FA" />
      </svg>
    </div>
  );
}

const mapTree = (tree, id, patch) => tree.map(tp => {
  if (tp.id === id) return { ...tp, ...patch };
  return tp.children?.length ? { ...tp, children: mapTree(tp.children, id, patch) } : tp;
});
const filterTree = (tree, id) => tree
  .filter(tp => tp.id !== id)
  .map(tp => (tp.children?.length ? { ...tp, children: filterTree(tp.children, id) } : tp));

export default function WorkflowPage({ goal, backBase }) {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { opportunityId } = useParams();
  const dateLocale = lang === 'en' ? 'en-US' : 'fr-FR';

  // 'checking' | 'generating' | 'draft' | 'tracking' | 'error'
  const [phase, setPhase] = useState('checking');
  const [errorKey, setErrorKey] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [sequence, setSequence] = useState([]);
  const [sends, setSends] = useState([]);
  const [contact, setContact] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  // Édition d'un workflow déjà actif/en pause (les brouillons sont toujours éditables).
  const [editing, setEditing] = useState(false);

  const loadEnrollment = useCallback(async (id) => {
    const data = await request(`/enrollments/${id}`);
    setEnrollment(data.enrollment);
    setSequence(data.sequence || []);
    setSends(data.sends || []);
    setContact(data.contact);
    setPhase(data.enrollment.status === 'draft' ? 'draft' : 'tracking');
  }, []);

  const propose = useCallback(async () => {
    setPhase('generating');
    try {
      const data = await request('/enrollments/propose', {
        method: 'POST',
        body: JSON.stringify({ opportunityId, goal }),
      });
      setEnrollment(data.enrollment);
      setSequence(data.sequence || []);
      setSends([]);
      setContact(data.contact);
      setPhase('draft');
    } catch (err) {
      // Course avec un autre onglet/session : le workflow vivant existe déjà,
      // on l'affiche (request() ne remonte que status+code, pas le corps).
      if (err.code === 'already_enrolled') {
        try {
          const data = await request(`/enrollments?opportunityId=${opportunityId}`);
          const live = (data.enrollments || []).find(e => ['draft', 'active', 'paused'].includes(e.status));
          if (live) {
            await loadEnrollment(live.id);
            return;
          }
        } catch { /* on retombe sur l'erreur générique */ }
      }
      setErrorKey(err.code === 'no_channel' ? 'workflow.errorNoChannel'
        : err.code === 'not_crm_contact' ? 'workflow.errorCampaignContact'
        : 'workflow.errorGeneration');
      setPhase('error');
    }
  }, [opportunityId, goal, loadEnrollment]);

  useEffect(() => {
    (async () => {
      try {
        const data = await request(`/enrollments?opportunityId=${opportunityId}`);
        const live = (data.enrollments || []).find(e => ['draft', 'active', 'paused'].includes(e.status));
        if (live) {
          await loadEnrollment(live.id);
        } else {
          await propose();
        }
      } catch {
        setErrorKey('workflow.errorGeneration');
        setPhase('error');
      }
    })();
  }, [opportunityId, loadEnrollment, propose]);

  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateStep = (id, patch) => setSequence(prev => mapTree(prev, id, patch));
  const removeStep = async (id) => {
    if (!await confirm(t('workflow.removeConfirm'))) return;
    setSequence(prev => filterTree(prev, id));
  };
  const addStepAfter = (index) => {
    const step = blankStep();
    setSequence(prev => {
      const next = [...prev];
      next.splice(index + 1, 0, step);
      return next;
    });
    setExpanded(prev => new Set(prev).add(step.id));
  };
  const changeStepType = (id, type) => {
    const patch = { type };
    if (type === 'linkedin_visit') { patch.subject = null; patch.body = ''; }
    if (type === 'linkedin_invite') { patch.subject = null; }
    if (type === 'linkedin_message') { patch.subject = null; }
    updateStep(id, patch);
  };

  const handleSaveEdit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await request(`/enrollments/${enrollment.id}/sequence`, {
        method: 'PUT',
        body: JSON.stringify({ steps: serialize(sequence) }),
      });
      showToast({ type: 'success', title: t('workflow.editSaved'), message: '' });
      setEditing(false);
      await loadEnrollment(enrollment.id);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    } finally {
      setBusy(false);
    }
  };
  const handleCancelEdit = async () => {
    setEditing(false);
    await loadEnrollment(enrollment.id);
  };

  const handleApprove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await request(`/enrollments/${enrollment.id}/sequence`, {
        method: 'PUT',
        body: JSON.stringify({ steps: serialize(sequence) }),
      });
      const result = await request(`/enrollments/${enrollment.id}/approve`, { method: 'POST' });
      showToast({
        type: 'success',
        title: t('workflow.approved'),
        message: result.firstRun?.emailsSent > 0 ? t('workflow.approvedFirstSend') : t('workflow.approvedScheduled'),
      });
      await loadEnrollment(enrollment.id);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    if (busy || !await confirm(t('workflow.regenerateConfirm'))) return;
    setBusy(true);
    try {
      await request(`/enrollments/${enrollment.id}/stop`, { method: 'POST' });
      await propose();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const doAction = async (action, confirmKey) => {
    if (busy) return;
    if (confirmKey && !await confirm(t(confirmKey))) return;
    setBusy(true);
    try {
      await request(`/enrollments/${enrollment.id}/${action}`, { method: 'POST' });
      await loadEnrollment(enrollment.id);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    } finally {
      setBusy(false);
    }
  };

  /* ── états simples ── */

  if (phase === 'checking' || phase === 'generating') {
    return (
      <div className="dashboard-page">
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          {phase === 'generating' && <LogoPulse />}
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {t(phase === 'generating' ? 'workflow.generating' : 'common.loading')}
          </div>
          {phase === 'generating' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 380, margin: '0 auto' }}>
              {t('workflow.generatingHint')}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="dashboard-page">
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{t(errorKey)}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {errorKey === 'workflow.errorGeneration' && (
              <button className="btn btn-accent" onClick={propose}>{t('workflow.retry')}</button>
            )}
            <button className="btn btn-ghost" onClick={() => navigate(backBase)}>{t('workflow.backToQueue')}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ── données dérivées ── */

  const flat = flatten(sequence);
  const consumed = new Map(); // touchpoint_id → send row (sent/skipped/failed)
  for (const s of sends) {
    if (s.touchpoint_id) consumed.set(s.touchpoint_id, s);
  }
  const doneCount = flat.filter(tp => {
    const s = consumed.get(tp.id);
    return s && (s.status === 'sent' || s.status === 'skipped');
  }).length;
  const currentStep = flat.find(tp => {
    const s = consumed.get(tp.id);
    return !s || (s.status !== 'sent' && s.status !== 'skipped');
  });
  const emailCount = flat.filter(tp => tp.type === 'email').length;
  const linkedinCount = flat.length - emailCount;
  const totalDays = flat.reduce((sum, tp) => sum + parseDays(tp.timing), 0);
  const isDraft = phase === 'draft';
  const status = enrollment?.status;

  const statusMeta = {
    active: { key: 'workflow.statusActive', color: 'var(--success)' },
    paused: { key: 'workflow.statusPaused', color: '#B45309' },
    stopped: { key: 'workflow.statusStopped', color: 'var(--text-muted)' },
    completed: { key: 'workflow.statusCompleted', color: 'var(--accent)' },
  }[status];

  /* ── carte d'un step ── */

  const renderStepCard = (tp) => {
    const meta = channelMeta(tp.type);
    const send = consumed.get(tp.id) || sends.find(s => s.touchpoint_id === tp.id);
    const isCurrent = !isDraft && status === 'active' && currentStep?.id === tp.id;
    const isOpen = expanded.has(tp.id);
    // Un step déjà consommé (envoyé/ignoré) ne se réécrit pas, même en édition.
    const consumedThis = send && (send.status === 'sent' || send.status === 'skipped');
    const canEdit = (isDraft || editing) && !consumedThis;
    const hasContent = tp.type !== 'linkedin_visit' || canEdit;
    const isInvite = tp.type === 'linkedin_invite';

    let statusLine = null;
    if (!isDraft && send) {
      if (send.status === 'sent') {
        statusLine = <span style={{ color: 'var(--success)', fontWeight: 600 }}>{t('workflow.sentOn', { date: new Date(send.sent_at).toLocaleDateString(dateLocale) })}</span>;
      } else if (send.status === 'skipped') {
        statusLine = <span style={{ color: 'var(--text-muted)' }}>{t('workflow.skipped')}</span>;
      } else if (send.status === 'failed') {
        statusLine = <span style={{ color: 'var(--danger, #d64545)' }}>{t('workflow.failed')}</span>;
      }
    } else if (isCurrent) {
      statusLine = <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('workflow.nextUp')}</span>;
    }

    return (
      <div
        className="card"
        style={{
          border: isCurrent ? '1px solid var(--accent)' : undefined,
          opacity: !isDraft && !send && !isCurrent && status === 'active' ? 0.65 : 1,
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => hasContent && toggleExpand(tp.id)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && hasContent) { e.preventDefault(); toggleExpand(tp.id); } }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            cursor: hasContent ? 'pointer' : 'default', flexWrap: 'wrap',
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)',
            border: '1px solid var(--border-light)', borderRadius: 5, padding: '1px 6px', flexShrink: 0,
          }}>
            J+{parseDays(tp.timing)}
          </span>
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            color: meta.color, background: meta.bg, borderRadius: 4, padding: '2px 6px', flexShrink: 0,
          }}>
            {t(meta.labelKey)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 120 }}>
            {tp.type === 'email' ? (tp.subject || t('workflow.stepEmailUntitled')) : t(meta.labelKey)}
          </span>
          <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{statusLine}</span>
          {canEdit && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '1px 7px', flexShrink: 0 }}
              onClick={(e) => { e.stopPropagation(); removeStep(tp.id); }}
              aria-label={t('workflow.remove')}
              title={t('workflow.remove')}
            >
              ×
            </button>
          )}
        </div>

        {hasContent && isOpen && (
          <div style={{ borderTop: '1px solid var(--border-light)', padding: '12px 14px' }}>
            {canEdit ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  <select
                    value={tp.type}
                    onChange={(e) => changeStepType(tp.id, e.target.value)}
                    style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  >
                    <option value="email">{t('workflow.chipEmail')}</option>
                    <option value="linkedin_visit">{t('workflow.chipLinkedinVisit')}</option>
                    <option value="linkedin_invite">{t('workflow.chipLinkedinInvite')}</option>
                    <option value="linkedin_message">{t('workflow.chipLinkedinMessage')}</option>
                  </select>
                  <label>{t('workflow.timingLabel')}</label>
                  <input
                    type="number" min={0} max={30}
                    value={parseDays(tp.timing)}
                    onChange={(e) => updateStep(tp.id, { timing: `J+${Math.max(0, Number(e.target.value) || 0)}` })}
                    style={{ width: 52, padding: '3px 6px', fontSize: 11, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  />
                  <span>{t('workflow.timingUnit')}</span>
                </div>
                {tp.type === 'email' && (
                  <input
                    value={tp.subject || ''}
                    onChange={(e) => updateStep(tp.id, { subject: e.target.value })}
                    placeholder={t('workflow.subjectPlaceholder')}
                    style={{
                      width: '100%', boxSizing: 'border-box', fontSize: 13, fontWeight: 600, padding: '7px 10px',
                      border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8,
                      background: 'var(--bg-card)', color: 'var(--text-primary)',
                    }}
                  />
                )}
                {tp.type !== 'linkedin_visit' && (
                  <textarea
                    value={tp.body || ''}
                    onChange={(e) => updateStep(tp.id, { body: isInvite ? e.target.value.slice(0, 300) : e.target.value })}
                    rows={isInvite ? 3 : 6}
                    style={{
                      width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', lineHeight: 1.5,
                      border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical',
                      background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'inherit',
                    }}
                  />
                )}
                {isInvite && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 4 }}>
                    {(tp.body || '').length} / 300
                  </div>
                )}
              </>
            ) : (
              <>
                {tp.type === 'email' && tp.subject && (
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tp.subject}</div>
                )}
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{tp.body}</div>
                {send?.status === 'failed' && send.error && (
                  <div style={{ fontSize: 11, color: 'var(--danger, #d64545)', marginTop: 8 }}>{send.error}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ── un nœud de timeline (step + fork éventuel) ── */

  const renderNode = (tp, index) => {
    const accepted = (tp.children || []).filter(c => c.condition_type === 'accepted');
    const others = (tp.children || []).filter(c => c.condition_type !== 'accepted');
    const hasFork = accepted.length > 0;
    const editable = isDraft || editing;

    return (
      <div key={tp.id} style={{ position: 'relative', paddingLeft: 34, paddingBottom: editable ? 4 : 14 }}>
        {/* trait + pastille */}
        <div style={{ position: 'absolute', left: 10, top: 26, bottom: 0, width: 2, background: 'var(--border-light)' }} />
        <div style={{
          position: 'absolute', left: 0, top: 4, width: 22, height: 22, borderRadius: '50%',
          background: 'var(--bg-card)', border: '2px solid var(--border)', fontSize: 10, fontWeight: 700,
          color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {index + 1}
        </div>

        {renderStepCard(tp)}

        {(tp.children || []).length > 0 && (
          hasFork ? (
            <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240, border: '1px dashed var(--success)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--success)', marginBottom: 8 }}>
                  ✓ {t('workflow.branchAccepted')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {accepted.map(c => <div key={c.id}>{renderStepCard(c)}</div>)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 240, border: '1px dashed var(--border)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {t('workflow.branchNotAccepted')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {others.map(c => <div key={c.id}>{renderStepCard(c)}</div>)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {(tp.children || []).map(c => <div key={c.id}>{renderStepCard(c)}</div>)}
            </div>
          )
        )}

        {editable && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 6px' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '2px 12px', color: 'var(--accent)', border: '1px dashed var(--border)', borderRadius: 14 }}
              onClick={() => addStepAfter(index)}
            >
              + {t('workflow.addStep')}
            </button>
          </div>
        )}
      </div>
    );
  };

  /* ── page ── */

  return (
    <div className="dashboard-page" style={{ paddingBottom: (isDraft || editing) ? 90 : undefined }}>
      <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px', marginBottom: 12 }} onClick={() => navigate(backBase)}>
        ← {t('workflow.backToQueue')}
      </button>

      <div className="page-header">
        <div>
          <h1 className="page-title">
            {contact?.name || contact?.company || t('workflow.title')}
          </h1>
          <div className="page-subtitle" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {contact?.company && contact?.name && <span>{contact.company}</span>}
            {contact?.deal_value != null && <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{Math.round(contact.deal_value).toLocaleString(dateLocale)} €</span>}
            <span>{t(isDraft ? 'workflow.subtitleDraft' : 'workflow.subtitleTracking')}</span>
          </div>
        </div>
        {!isDraft && statusMeta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 700, color: statusMeta.color,
              border: `1px solid ${statusMeta.color}`, borderRadius: 20, padding: '3px 12px',
            }}>
              {t(statusMeta.key)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('workflow.progress', { done: doneCount, total: flat.length })}
            </span>
            {!editing && status === 'active' && (
              <>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={() => doAction('run')}>
                  {t('workflow.runNow')}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={() => doAction('pause')}>
                  {t('workflow.pause')}
                </button>
              </>
            )}
            {!editing && status === 'paused' && (
              <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} disabled={busy} onClick={() => doAction('approve')}>
                {t('workflow.resume')}
              </button>
            )}
            {!editing && (status === 'active' || status === 'paused') && (
              <>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={() => setEditing(true)}>
                  {t('workflow.editSequence')}
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} disabled={busy} onClick={() => doAction('stop', 'workflow.stopConfirm')}>
                  {t('workflow.stop')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* réponse détectée : le but est atteint */}
      {!isDraft && enrollment?.stop_reason === 'replied' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(34,197,94,0.08)',
          border: '1px solid var(--success)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13,
        }}>
          <span>🎉</span>
          <span><strong>{t('workflow.repliedBanner', { name: contact?.name || contact?.company || '' })}</strong></span>
        </div>
      )}

      {/* rationale de l'agent */}
      {enrollment?.rationale && (
        <div style={{
          background: 'var(--accent-glow)', borderLeft: '3px solid var(--accent)',
          borderRadius: '0 8px 8px 0', padding: '12px 16px', marginBottom: 20, fontSize: 13,
          color: 'var(--text-secondary)', lineHeight: 1.55,
        }}>
          {enrollment.rationale}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{t('workflow.rationaleSource')}</div>
        </div>
      )}

      {/* timeline */}
      <div style={{ maxWidth: 640 }}>
        {sequence.map((tp, i) => renderNode(tp, i))}
      </div>

      {/* barre d'enregistrement du mode édition (workflow actif/en pause) */}
      {editing && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          background: 'var(--bg-card)', borderTop: '1px solid var(--border)',
        }}>
          <div style={{
            maxWidth: 900, margin: '0 auto', padding: '10px 20px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('workflow.editingHint')}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} disabled={busy} onClick={handleCancelEdit}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 18px' }} disabled={busy || flat.length === 0} onClick={handleSaveEdit}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* barre d'action du brouillon */}
      {isDraft && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          background: 'var(--bg-card)', borderTop: '1px solid var(--border)',
        }}>
          <div style={{
            maxWidth: 900, margin: '0 auto', padding: '10px 20px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('workflow.summary', { steps: flat.length, days: totalDays, emails: emailCount, linkedin: linkedinCount })}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} disabled={busy} onClick={handleRegenerate}>
                {t('workflow.regenerate')}
              </button>
              <div style={{ textAlign: 'right' }}>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '7px 18px' }} disabled={busy || flat.length === 0} onClick={handleApprove}>
                  {busy ? t('workflow.approving') : t('workflow.approve')}
                </button>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3 }}>
                  {t('workflow.reassurance')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
