/* ═══════════════════════════════════════════════════
   Touchpoint Card Component
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api-client';
import { highlightVars, stripEditorHtml, getPlainTextLength } from './editor-helpers';
import { sanitizeHtml } from '../../services/sanitize';

function TouchpointSuggestion({ suggestion, onApply, onDismiss }) {
  const [state, setState] = useState('visible'); // visible | applied | dismissed

  if (state === 'dismissed') return null;

  if (state === 'applied') {
    return (
      <div className="tp-ai-suggestion" style={{ opacity: 1 }}>
        <div style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>
          Suggestion appliquee -- verifiez le resultat
        </div>
      </div>
    );
  }

  return (
    <div className="tp-ai-suggestion">
      <div className="tp-ai-suggestion-label">{suggestion.label}</div>
      <div className="tp-ai-suggestion-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(suggestion.text) }} />
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button
          className="tp-action ai"
          style={{ fontSize: '11px' }}
          onClick={() => { setState('applied'); onApply(); }}
        >
          Appliquer
        </button>
        <button
          className="tp-action"
          style={{ fontSize: '11px' }}
          onClick={() => { setState('dismissed'); onDismiss(); }}
        >
          Ignorer
        </button>
      </div>
    </div>
  );
}

function CharCounter({ bodyRef, maxChars }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => {
      if (bodyRef.current) {
        setCount(getPlainTextLength(bodyRef.current.innerHTML));
      }
    };
    update();
    const el = bodyRef.current;
    if (el) {
      el.addEventListener('input', update);
      return () => el.removeEventListener('input', update);
    }
  }, [bodyRef]);

  const overClass = count > maxChars ? ' over' : count > maxChars * 0.9 ? ' warn' : '';

  return (
    <span className={`tp-field-count${overClass}`} data-max={maxChars}>
      {count} / {maxChars} caracteres
    </span>
  );
}

export default function TouchpointCard({
  tp,
  backendAvailable,
  campaignData,
  activeCampaignKey,
  onDuplicate,
  onDelete,
  onTouchpointUpdate,
}) {
  const isLinkedin = tp.type === 'linkedin';
  const [regenStatus, setRegenStatus] = useState(null); // null | 'loading' | 'done' | 'error' | 'offline'
  const [regenMsg, setRegenMsg] = useState('');
  const [editing, setEditing] = useState(false);
  const bodyRef = useRef(null);
  const subjectRef = useRef(null);

  /* ─── Regenerate single touchpoint ─── */
  const handleRegenerate = useCallback(async () => {
    setRegenStatus('loading');
    setRegenMsg('Regeneration en cours...');

    if (backendAvailable) {
      const backendId = campaignData._backendId || activeCampaignKey;
      try {
        const currentBody = bodyRef.current ? stripEditorHtml(bodyRef.current.innerHTML) : tp.body;
        const currentSubject = subjectRef.current ? stripEditorHtml(subjectRef.current.innerHTML) : (tp.subject || '');

        const result = await api.regenerateSequence(
          backendId,
          `${tp.id} -- A regenerer : le message actuel sous-performe`,
          [{ step: tp.id, subject: currentSubject, body: currentBody }],
          { tone: campaignData.tone, formality: campaignData.formality, sector: campaignData.sector, length: campaignData.length },
        );

        const msg = (result.messages || []).find((m) => m.step === tp.id);
        if (msg && msg.variantA) {
          if (subjectRef.current && msg.variantA.subject) {
            subjectRef.current.innerHTML = highlightVars(msg.variantA.subject);
          }
          if (bodyRef.current && msg.variantA.body) {
            bodyRef.current.innerHTML = highlightVars(msg.variantA.body).replace(/\n/g, '<br>');
          }
        }
        setRegenStatus('done');
        setRegenMsg('Regenere -- verifiez le resultat avant de sauvegarder');
      } catch (err) {
        setRegenStatus('error');
        setRegenMsg('Erreur : ' + err.message);
      }
    } else {
      setTimeout(() => {
        setRegenStatus('offline');
        setRegenMsg('Backend non disponible');
      }, 500);
    }

    setTimeout(() => {
      setRegenStatus(null);
      setRegenMsg('');
    }, 4000);
  }, [backendAvailable, campaignData, activeCampaignKey, tp]);

  /* ─── Apply suggestion ─── */
  const handleApplySuggestion = useCallback(() => {
    if (!tp.suggestion || !bodyRef.current) return;

    const proposalMatch = tp.suggestion.text.match(/Proposition\s*:\s*"([^"]+)"/i) ||
                          tp.suggestion.text.match(/Proposition\s*:\s*(.+?)(?:\s*(?:->|→)|$)/i);

    if (proposalMatch && bodyRef.current) {
      const proposal = highlightVars(proposalMatch[1].trim());
      const currentHtml = bodyRef.current.innerHTML;
      const lines = currentHtml.split(/<br\s*\/?>/);
      if (lines.length > 1) {
        lines[lines.length - 1] = proposal;
        bodyRef.current.innerHTML = lines.join('<br>');
      } else {
        bodyRef.current.innerHTML += '<br>' + proposal;
      }
      // Flash green
      bodyRef.current.style.transition = 'box-shadow 0.3s';
      bodyRef.current.style.boxShadow = '0 0 0 2px var(--success)';
      setTimeout(() => { if (bodyRef.current) bodyRef.current.style.boxShadow = ''; }, 1000);
    }
  }, [tp.suggestion]);

  const bodyHtml = highlightVars(tp.body || '').replace(/\n/g, '<br>');
  const subjectHtml = tp.subject !== null ? highlightVars(tp.subject) : null;

  return (
    <div className={`touchpoint-card${editing ? ' editing' : ''}`} data-tp={tp.id}>
      <div className="tp-header">
        <div className="tp-header-left">
          <div className={`tp-dot ${tp.type}`}>{tp.id}</div>
          <div className="tp-info">
            <div className="tp-name">{tp.label} &mdash; {tp.subType}</div>
            <div className="tp-timing">{tp.timing}</div>
          </div>
        </div>
        <div className="tp-actions">
          <button className="tp-action ai" onClick={handleRegenerate}>
            Regenerer
          </button>
          <button className="tp-action" onClick={onDuplicate}>
            Dupliquer
          </button>
          <button className="tp-action" onClick={onDelete}>
            Supprimer
          </button>
        </div>
      </div>

      <div className="tp-body">
        {/* Regen status */}
        {regenStatus && (
          <div
            className="tp-regen-status"
            style={{
              fontSize: '12px',
              padding: '8px 0',
              color: regenStatus === 'done' ? 'var(--success)'
                : regenStatus === 'error' ? 'var(--danger)'
                : regenStatus === 'offline' ? 'var(--warning)'
                : 'var(--accent-light)',
            }}
          >
            {regenMsg}
          </div>
        )}

        {/* Subject field (emails only) */}
        {subjectHtml !== null && (
          <div className="tp-field tp-subject">
            <div className="tp-field-label">Objet</div>
            <div
              ref={subjectRef}
              className="tp-editable"
              contentEditable
              suppressContentEditableWarning
              data-field="subject"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(subjectHtml) }}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
            />
          </div>
        )}

        {/* Body field */}
        <div className="tp-field">
          <div className="tp-field-label">
            {isLinkedin ? 'Message' : 'Corps du message'}
            {tp.maxChars && <CharCounter bodyRef={bodyRef} maxChars={tp.maxChars} />}
          </div>
          <div
            ref={bodyRef}
            className="tp-editable"
            contentEditable
            suppressContentEditableWarning
            data-field="body"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            style={regenStatus === 'loading' ? { opacity: 0.4 } : undefined}
          />
        </div>

        {/* AI suggestion */}
        {tp.suggestion && (
          <TouchpointSuggestion
            suggestion={tp.suggestion}
            onApply={handleApplySuggestion}
            onDismiss={() => {}}
          />
        )}
      </div>
    </div>
  );
}
