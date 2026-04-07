/* ═══════════════════════════════════════════════════
   Copy & Sequences Tab
   Shows the sequence tree (read-only view) + per-touchpoint
   inline editor with regeneration, char counter, and save flow.
   Ported from CopyEditorPage.jsx (single-campaign features).
   ═══════════════════════════════════════════════════ */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useApp } from '../../../context/useApp';
import api from '../../../services/api-client';
import { sanitizeHtml } from '../../../services/sanitize';
import SequenceTree from '../SequenceTree';

/* ─── Helpers ─── */

function highlightVars(text) {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, '<span class="var">{{$1}}</span>');
}

function stripEditorHtml(html) {
  if (!html) return '';
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<span[^>]*class="var"[^>]*>(.*?)<\/span>/gi, '$1');
  text = text.replace(/<[^>]*>/g, '');
  const tmp = document.createElement('textarea');
  tmp.innerHTML = text;
  return tmp.value;
}

const TYPE_META = {
  email: { label: 'Email', icon: '📧', color: 'var(--blue)' },
  linkedin_visit: { label: 'Visite profil', icon: '👁️', color: 'var(--purple)' },
  linkedin_invite: { label: 'Note connexion', icon: '🤝', color: 'var(--purple)' },
  linkedin_message: { label: 'Message LinkedIn', icon: '💬', color: 'var(--purple)' },
  linkedin: { label: 'LinkedIn', icon: '💬', color: 'var(--purple)' },
};

/* ─── Char counter ─── */

function CharCounter({ bodyRef, maxChars = 300 }) {
  const [count, setCount] = useState(0);

  const recompute = useCallback(() => {
    if (!bodyRef.current) return;
    const text = stripEditorHtml(bodyRef.current.innerHTML);
    setCount(text.length);
  }, [bodyRef]);

  // Recompute once on mount, after the editable div is in the DOM
  useEffect(() => {
    recompute();
  }, [recompute]);

  const color = count > maxChars ? 'var(--danger)' : count > maxChars - 50 ? 'var(--warning)' : 'var(--text-muted)';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 8, color }}
      onClick={recompute}
    >
      {count}/{maxChars}{count > maxChars && ' ⚠️'}
    </span>
  );
}

/* ─── Touchpoint editor card ─── */

function TouchpointEditCard({ tp, campaign, onChange }) {
  const [regenStatus, setRegenStatus] = useState(null);
  const [regenMsg, setRegenMsg] = useState('');
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);

  const meta = TYPE_META[tp.type] || TYPE_META.email;
  const isLinkedinInvite = tp.type === 'linkedin_invite';
  const isLinkedinVisit = tp.type === 'linkedin_visit';
  const showSubject = tp.type === 'email' && tp.subject !== null;

  const handleBlur = useCallback((field) => {
    const ref = field === 'subject' ? subjectRef : bodyRef;
    if (!ref.current) return;
    const newValue = stripEditorHtml(ref.current.innerHTML);
    const oldValue = field === 'subject' ? (tp.subject || '') : (tp.body || '');
    if (newValue !== oldValue) {
      onChange(tp._backendId || tp.id, { [field]: newValue });
    }
  }, [tp, onChange]);

  const handleRegenerate = useCallback(async () => {
    setRegenStatus('loading');
    setRegenMsg('Régénération en cours...');
    try {
      const backendId = campaign._backendId || campaign.id;
      const currentBody = bodyRef.current ? stripEditorHtml(bodyRef.current.innerHTML) : tp.body;
      const currentSubject = subjectRef.current ? stripEditorHtml(subjectRef.current.innerHTML) : (tp.subject || '');
      const result = await api.regenerateSequence(
        backendId,
        `${tp.id} — A regénérer : message à améliorer`,
        [{ step: tp.id, subject: currentSubject, body: currentBody }],
        {
          tone: campaign.tone,
          formality: campaign.formality,
          sector: campaign.sector,
          length: campaign.length,
        },
      );
      const msg = (result.messages || []).find((m) => m.step === tp.id);
      if (msg && msg.variantA) {
        if (subjectRef.current && msg.variantA.subject) {
          subjectRef.current.innerHTML = highlightVars(msg.variantA.subject);
        }
        if (bodyRef.current && msg.variantA.body) {
          bodyRef.current.innerHTML = highlightVars(msg.variantA.body).replace(/\n/g, '<br>');
        }
        // Push the new content into parent state
        onChange(tp._backendId || tp.id, {
          subject: msg.variantA.subject,
          body: msg.variantA.body,
        });
      }
      setRegenStatus('done');
      setRegenMsg('Régénéré — vérifie le résultat avant de sauvegarder');
    } catch (err) {
      setRegenStatus('error');
      setRegenMsg('Erreur : ' + err.message);
    }
    setTimeout(() => {
      setRegenStatus(null);
      setRegenMsg('');
    }, 4000);
  }, [campaign, tp, onChange]);

  const bodyHtml = highlightVars(tp.body || '').replace(/\n/g, '<br>');
  const subjectHtml = tp.subject ? highlightVars(tp.subject) : '';

  return (
    <div
      className="touchpoint-card"
      data-tp={tp.id}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px',
        marginBottom: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: meta.color,
              color: 'white',
              fontSize: 12,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {tp.id}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {meta.icon} {meta.label} {tp.subType && `— ${tp.subType}`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tp.timing}</div>
          </div>
          {tp.branchLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--accent)',
                background: 'rgba(108, 92, 231, 0.12)',
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              ↳ {tp.branchLabel}
            </span>
          )}
        </div>
        {!isLinkedinVisit && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '6px 10px' }}
            onClick={handleRegenerate}
            disabled={regenStatus === 'loading'}
          >
            {regenStatus === 'loading' ? '⏳' : '🔄'} Régénérer
          </button>
        )}
      </div>

      {regenStatus && (
        <div
          style={{
            fontSize: 11,
            padding: '6px 0',
            color:
              regenStatus === 'done'
                ? 'var(--success)'
                : regenStatus === 'error'
                  ? 'var(--danger)'
                  : 'var(--accent)',
          }}
        >
          {regenMsg}
        </div>
      )}

      {isLinkedinVisit ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
          Visite automatique du profil — pas de message à éditer
        </div>
      ) : (
        <>
          {showSubject && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Objet
              </div>
              <div
                ref={subjectRef}
                className="tp-editable"
                contentEditable
                suppressContentEditableWarning
                data-field="subject"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(subjectHtml) }}
                onBlur={() => handleBlur('subject')}
                style={{
                  fontSize: 13,
                  padding: '8px 10px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 6,
                  outline: 'none',
                  minHeight: 20,
                }}
              />
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center' }}>
              {tp.type === 'email' ? 'Corps du message' : 'Message'}
              {isLinkedinInvite && <CharCounter bodyRef={bodyRef} maxChars={300} />}
            </div>
            <div
              ref={bodyRef}
              className="tp-editable"
              contentEditable
              suppressContentEditableWarning
              data-field="body"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
              onBlur={() => handleBlur('body')}
              style={{
                fontSize: 13,
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                borderRadius: 6,
                outline: 'none',
                minHeight: 60,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Main tab ─── */

export default function CopyTab({ campaign: c, setCampaigns }) {
  const { backendAvailable } = useApp();
  const [editingMode, setEditingMode] = useState(false);
  const [localTouchpoints, setLocalTouchpoints] = useState(c.sequence || []);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveMessage, setSaveMessage] = useState('');

  const handleTouchpointChange = useCallback((tpId, changes) => {
    setIsDirty(true);
    setLocalTouchpoints((prev) =>
      prev.map((tp) => ((tp._backendId || tp.id) === tpId ? { ...tp, ...changes } : tp))
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!isDirty) return;
    setSaveStatus('loading');
    setSaveMessage('Sauvegarde...');
    try {
      const backendId = c._backendId || c.id;
      if (backendAvailable) {
        await api.saveSequence(backendId, localTouchpoints);
      }
      // Sync into global context
      if (setCampaigns) {
        setCampaigns((prev) => ({
          ...prev,
          [c.id]: { ...prev[c.id], sequence: localTouchpoints },
        }));
      }
      setIsDirty(false);
      setSaveStatus('saved');
      setSaveMessage('✅ Séquences sauvegardées');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus('error');
      setSaveMessage('❌ Erreur : ' + err.message);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  }, [c, isDirty, localTouchpoints, backendAvailable, setCampaigns]);

  const handleCancel = useCallback(() => {
    setLocalTouchpoints(c.sequence || []);
    setIsDirty(false);
  }, [c.sequence]);

  const emailCount = (localTouchpoints || []).filter((s) => s.type === 'email').length;
  const linkedinCount = (localTouchpoints || []).filter((s) => s.type && s.type.startsWith('linkedin')).length;

  return (
    <div>
      {/* Header with actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {editingMode ? '✏️ Édition des séquences' : '👁️ Aperçu des séquences'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {(localTouchpoints || []).length} touchpoints · {emailCount} emails · {linkedinCount} LinkedIn
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveStatus && (
            <span
              style={{
                fontSize: 12,
                color:
                  saveStatus === 'saved'
                    ? 'var(--success)'
                    : saveStatus === 'error'
                      ? 'var(--danger)'
                      : 'var(--text-muted)',
              }}
            >
              {saveMessage}
            </span>
          )}
          {editingMode && isDirty && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={handleCancel}>
              Annuler
            </button>
          )}
          {editingMode && (
            <button
              className="btn btn-success"
              style={{ fontSize: 12 }}
              onClick={handleSave}
              disabled={!isDirty || saveStatus === 'loading'}
            >
              💾 Sauvegarder
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            onClick={() => setEditingMode((prev) => !prev)}
          >
            {editingMode ? '👁️ Aperçu' : '✏️ Éditer'}
          </button>
        </div>
      </div>

      {/* Content : tree view OR edit cards */}
      {editingMode ? (
        <div>
          {(localTouchpoints || []).map((tp) => (
            <TouchpointEditCard
              key={tp._backendId || tp.id}
              tp={tp}
              campaign={c}
              onChange={handleTouchpointChange}
            />
          ))}
        </div>
      ) : (
        <SequenceTree sequence={localTouchpoints} />
      )}
    </div>
  );
}
