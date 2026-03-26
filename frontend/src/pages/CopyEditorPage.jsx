/* ===============================================================================
   BAKAL — Copy Editor Page (React)
   Split-panel editor with inline editing + AI features.
   Ported from /app/copy-editor.js — full React hooks implementation.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import api, { exportCampaignCsv } from '../services/api-client';
import VariableManager from '../components/VariableManager';
import VarGenerator from '../components/VarGenerator';
import { sanitizeHtml } from '../services/sanitize';

/* ─── Fallback data ─── */

const EDITOR_FALLBACK = {
  'daf-idf': {
    name: 'DAF Ile-de-France',
    icon: '✉️',
    iconBg: 'var(--blue-bg)',
    channel: 'Email',
    meta: '4 touchpoints · Iteration 4',
    status: 'active',
    params: [
      { l: 'Canal', v: 'Email' }, { l: 'Cible', v: 'DAF · Comptabilite' },
      { l: 'Taille', v: '11-50 sal.' }, { l: 'Angle', v: 'Douleur client' },
      { l: 'Ton', v: 'Pro décontracté' }, { l: 'Tutoiement', v: 'Vous' },
      { l: 'Longueur', v: 'Court (3 phrases)' }, { l: 'CTA', v: 'Question ouverte' },
    ],
    aiBar: {
      title: '2 suggestions disponibles',
      text: "E3 : l'angle anxiogène sous-performe (-3pts réponse). E4 : le break-up peut être raccourci (actuellement 4 phrases, objectif 3).",
    },
    touchpoints: [
      {
        id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0 · Envoyé à 247 prospects',
        subType: 'Angle douleur client',
        subject: '{{firstName}}, une question sur votre gestion financière',
        body: 'Bonjour {{firstName}},\n\nCombien d\'heures par semaine votre équipe passe-t-elle sur des tâches qui pourraient être automatisées ?\n\nChez {{companyName}}, les cabinets comme le vôtre gagnent en moyenne 12h/semaine en digitalisant trois processus clés.\n\nQuel est votre plus gros frein opérationnel en ce moment ?',
        suggestion: null,
      },
      {
        id: 'E2', type: 'email', label: 'Email valeur', timing: 'J+3 · Case study',
        subType: 'Preuve par l\'exemple',
        subject: 'Re: gestion financière — un cas concret',
        body: '{{firstName}}, je me permets de revenir avec un exemple concret.\n\nLe cabinet Nexia Conseil (35 personnes, secteur similaire) a réduit de 40% le temps de reporting mensuel en automatisant la collecte de données.\n\nRésultat : 2 jours récupérés chaque mois pour du conseil à valeur ajoutée.\n\nEst-ce que c\'est un sujet chez {{companyName}} ?',
        suggestion: null,
      },
      {
        id: 'E3', type: 'email', label: 'Email relance', timing: 'J+7 · Angle different',
        subType: 'Changement d\'angle',
        subject: 'Autre approche, {{firstName}}',
        body: '{{firstName}}, je change d\'approche.\n\nPlutôt que de parler d\'automatisation, une question simple : quel est le coût réel d\'une erreur de saisie dans un bilan chez {{companyName}} ?\n\nPour les cabinets de votre taille, nos clients estiment ce coût entre 2 000 et 8 000EUR par incident.\n\nSi le sujet vous parle, je peux vous montrer comment d\'autres cabinets ont éliminé ce risque.',
        suggestion: {
          label: 'Suggestion IA — Changer l\'angle',
          text: 'L\'angle "coût de l\'erreur" est perçu comme anxiogène sur ce segment. Les données montrent que l\'angle "gain de temps" performe +2.1pts mieux. <strong>Proposition :</strong> "Si vous pouviez récupérer une journée par semaine, qu\'en feriez-vous ?" -> CTA question ouverte positive.',
        },
      },
      {
        id: 'E4', type: 'email', label: 'Email break-up', timing: 'J+12 · Soft close',
        subType: 'Dernier message',
        subject: 'Derniere tentative, {{firstName}}',
        body: '{{firstName}}, je ne veux pas encombrer votre boîte.\n\nSi ce n\'est pas le bon moment, pas de souci — je ne reviendrai pas.\n\nJuste un dernier mot : si un jour 12h/semaine récupérées ça vous intéresse, mon agenda est ouvert.\n\nBonne continuation.',
        suggestion: {
          label: 'Suggestion IA — Raccourcir',
          text: 'Le break-up fait 4 phrases, objectif 3 max. Supprimer "Juste un dernier mot..." et intégrer le bénéfice dans la phrase précédente.',
        },
      },
    ],
  },
  'dirigeants-formation': {
    name: 'Dirigeants Formation',
    icon: '💼',
    iconBg: 'rgba(151,117,250,0.15)',
    channel: 'LinkedIn',
    meta: '2 touchpoints · Iteration 2',
    status: 'active',
    params: [
      { l: 'Canal', v: 'LinkedIn' }, { l: 'Cible', v: 'Dirigeant · Formation' },
      { l: 'Taille', v: '1-10 sal.' }, { l: 'Angle', v: 'Preuve sociale' },
      { l: 'Ton', v: 'Pro décontracté' }, { l: 'Tutoiement', v: 'Vous' },
      { l: 'CTA', v: 'Question ouverte' },
    ],
    aiBar: {
      title: '1 suggestion critique',
      text: "L2 : le taux de réponse (6.8%) est sous l'objectif (8%). Changer l'angle de preuve sociale -> douleur client.",
    },
    touchpoints: [
      {
        id: 'L1', type: 'linkedin', label: 'Note de connexion', timing: 'J+0 · Max 300 caractères',
        subType: 'Première prise de contact',
        subject: null,
        body: '{{firstName}}, votre parcours dans la formation m\'a interpellé. J\'accompagne des dirigeants du secteur sur la croissance commerciale — je serais ravi d\'échanger avec vous.',
        maxChars: 300,
        suggestion: null,
      },
      {
        id: 'L2', type: 'linkedin', label: 'Message post-connexion', timing: 'J+3 · Conversationnel',
        subType: 'Apres acceptation',
        subject: null,
        body: 'Merci d\'avoir accepté, {{firstName}} !\n\nJ\'ai accompagné 3 organismes de formation comme le vôtre à générer entre 5 et 12 RDV qualifiés par mois.\n\nCurieux de savoir comment vous gérez votre développement commercial actuellement ?',
        suggestion: {
          label: 'Suggestion critique — Changer l\'angle',
          text: '6.8% de réponse vs 8% cible. Le "3 organismes de formation" manque de spécificité. <strong>Proposition :</strong> Passer à l\'angle douleur client : "Quel est votre plus gros frein pour trouver de nouveaux clients en ce moment ?" -> +1.5-2pts estimés.',
        },
      },
    ],
  },
  'drh-lyon': {
    name: 'DRH PME Lyon',
    icon: '📧',
    iconBg: 'var(--warning-bg)',
    channel: 'Multi-canal',
    meta: '6 touchpoints · En préparation',
    status: 'prep',
    params: [
      { l: 'Canal', v: 'Email + LinkedIn' }, { l: 'Cible', v: 'DRH · Conseil' },
      { l: 'Taille', v: '51-200 sal.' }, { l: 'Angle', v: 'Offre directe' },
      { l: 'Ton', v: 'Formel & Corporate' }, { l: 'Tutoiement', v: 'Vous' },
      { l: 'Longueur', v: 'Standard' }, { l: 'CTA', v: 'Proposition de call' },
    ],
    aiBar: {
      title: '1 alerte pré-lancement',
      text: 'Le CTA "15 minutes cette semaine" est trop agressif pour un premier contact DRH. Les questions ouvertes convertissent 2x mieux.',
    },
    touchpoints: [
      {
        id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0 · Offre directe',
        subType: 'Premier contact',
        subject: '{{firstName}}, une solution concrète pour vos recrutements',
        body: 'Bonjour {{firstName}},\n\nNous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement grâce à une méthode structurée d\'approche directe.\n\nSeriez-vous disponible 15 minutes cette semaine pour en discuter ?',
        suggestion: {
          label: 'Alerte IA — CTA trop agressif',
          text: 'Le CTA "15 minutes cette semaine" est trop direct pour un premier contact DRH. Vos données montrent que les questions ouvertes convertissent 2x mieux. <strong>Proposition :</strong> "Quel est votre plus gros défi recrutement en ce moment ?" -> +2-3pts estimés.',
        },
      },
      {
        id: 'L1', type: 'linkedin', label: 'Note de connexion LinkedIn', timing: 'J+1 · Max 300 chars',
        subType: 'Prise de contact LK',
        subject: null,
        body: '{{firstName}}, votre expertise RH chez {{companyName}} m\'a interpellé. J\'échange régulièrement avec des DRH de PME lyonnaises — je serais ravi de vous compter dans mon réseau.',
        maxChars: 300,
        suggestion: null,
      },
      {
        id: 'E2', type: 'email', label: 'Email valeur', timing: 'J+4 · Case study',
        subType: 'Preuve par l\'exemple',
        subject: 'Re: recrutements — un résultat qui parle',
        body: '{{firstName}}, un exemple concret : une PME de conseil RH (180 personnes, Lyon) a divisé par 2 ses délais de recrutement en 3 mois.\n\nLeur secret ? Une méthode d\'approche directe structurée qui génère 3x plus de candidatures qualifiées.\n\nSi vous faites face à des défis similaires chez {{companyName}}, je serais heureux d\'en discuter.',
        suggestion: null,
      },
      {
        id: 'L2', type: 'linkedin', label: 'Message LinkedIn', timing: 'J+5 · Post-connexion',
        subType: 'Apres acceptation LK',
        subject: null,
        body: 'Merci d\'avoir accepté, {{firstName}} !\n\nJ\'accompagne des PME lyonnaises sur l\'optimisation de leurs processus RH. Comment gérez-vous vos recrutements chez {{companyName}} actuellement ?',
        suggestion: null,
      },
      {
        id: 'E3', type: 'email', label: 'Email relance', timing: 'J+8 · Angle different',
        subType: 'Nouvelle perspective',
        subject: 'Autre approche, {{firstName}}',
        body: '{{firstName}}, une autre manière de voir les choses : combien vous coûte un recrutement raté chez {{companyName}} ?\n\nPour les PME de votre taille, nos clients estiment ce coût entre 15 000 et 45 000EUR.\n\nSi vous souhaitez en discuter, je suis disponible.',
        suggestion: null,
      },
      {
        id: 'E4', type: 'email', label: 'Email break-up', timing: 'J+13 · Soft close',
        subType: 'Dernier message',
        subject: '{{firstName}}, dernier message',
        body: '{{firstName}}, dernier message de ma part.\n\nSi le timing n\'est pas bon, aucun souci. Mon agenda reste ouvert si le sujet devient prioritaire.\n\nBonne continuation.',
        suggestion: null,
      },
    ],
  },
};

/* ─── Helpers ─── */

/** Highlight {{varName}} in text by wrapping with styled spans */
function highlightVars(text) {
  if (!text) return '';
  return text.replace(
    /\{\{(\w+)\}\}/g,
    '<span class="var">{{$1}}</span>'
  );
}

/** Strip HTML back to plain text, preserving {{variables}} */
function stripEditorHtml(html) {
  if (!html) return '';
  // Convert <br> to newlines
  let text = html.replace(/<br\s*\/?>/gi, '\n');
  // Convert <span class="var">{{x}}</span> back to {{x}}
  text = text.replace(/<span[^>]*class="var"[^>]*>(.*?)<\/span>/gi, '$1');
  // Remove any remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');
  // Decode HTML entities
  const tmp = document.createElement('textarea');
  tmp.innerHTML = text;
  return tmp.value;
}

/** Get plain text length from HTML */
function getPlainTextLength(html) {
  if (!html) return 0;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent.length;
}

/* ─── Channel metadata ─── */

const CH_ICONS = { email: '✉️', linkedin: '💼', multi: '📧' };
const CH_BGS = { email: 'var(--blue-bg)', linkedin: 'rgba(151,117,250,0.15)', multi: 'var(--warning-bg)' };
const CH_LABELS = { email: 'Email', linkedin: 'LinkedIn', multi: 'Multi-canal' };

/* ─── Sync campaigns from AppContext to editor format ─── */

function syncCampaignsFromContext(contextCampaigns) {
  const result = {};
  for (const [id, c] of Object.entries(contextCampaigns)) {
    const ch = c.channel || 'email';
    const seq = c.sequence || [];

    result[id] = {
      _backendId: c._backendId || id,
      name: c.name,
      icon: CH_ICONS[ch] || '✉️',
      iconBg: CH_BGS[ch] || 'var(--blue-bg)',
      channel: CH_LABELS[ch] || 'Email',
      meta: `${seq.length} touchpoints · ${c.status === 'prep' ? 'En préparation' : 'Itération ' + (c.iteration || 1)}`,
      status: c.status || 'prep',
      params: [
        { l: 'Canal', v: CH_LABELS[ch] || 'Email' },
        { l: 'Cible', v: [c.position, c.sectorShort].filter(Boolean).join(' · ') },
        c.size ? { l: 'Taille', v: c.size } : null,
        c.angle ? { l: 'Angle', v: c.angle } : null,
        { l: 'Ton', v: c.tone || 'Pro décontracté' },
        { l: 'Tutoiement', v: c.formality || 'Vous' },
        c.length ? { l: 'Longueur', v: c.length } : null,
        c.cta ? { l: 'CTA', v: c.cta } : null,
      ].filter(Boolean),
      aiBar: null,
      touchpoints: seq.map((s) => ({
        id: s.id,
        _backendId: s._backendId,
        type: s.type,
        label: s.label || '',
        timing: s.timing || '',
        subType: s.subType || '',
        subject: s.subject || null,
        body: s.body || '',
        maxChars: s.maxChars || undefined,
        suggestion: null,
      })),
    };
  }
  return result;
}

/* ─── Sub-components ─── */

function EditorSidebar({ editorCampaigns, activeCampaign, onSelect }) {
  return (
    <div className="editor-sidebar" id="editor-campaign-list" style={{ width: '280px', borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '14px' }}>
        Campagnes
      </div>
      {Object.entries(editorCampaigns).map(([key, c]) => {
        const active = key === activeCampaign ? ' active' : '';
        const statusDot = c.status === 'active'
          ? <span className="pulse-dot" style={{ width: '6px', height: '6px', marginLeft: '4px' }}></span>
          : <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--warning)', marginLeft: '4px' }}></span>;
        return (
          <div key={key} className={`editor-campaign-item${active}`} onClick={() => onSelect(key)}>
            <div className="eci-icon" style={{ background: c.iconBg }}>{c.icon}</div>
            <div>
              <div className="eci-name">{c.name} {statusDot}</div>
              <div className="eci-meta">{c.meta}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiBar({ aiBar, onApplyAll, onDismissAll }) {
  const [dismissed, setDismissed] = useState(false);
  const [applied, setApplied] = useState(false);

  if (!aiBar || dismissed) return null;

  return (
    <div className="ai-bar" style={applied ? { borderColor: 'var(--success)' } : undefined}>
      <div className="ai-bar-icon">~</div>
      <div className="ai-bar-content">
        <div className="ai-bar-title">
          {applied ? 'Toutes les suggestions appliquées' : aiBar.title}
        </div>
        <div className="ai-bar-text">
          {applied
            ? 'Vérifiez les modifications et sauvegardez quand vous êtes satisfait.'
            : aiBar.text}
        </div>
      </div>
      {!applied && (
        <>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '6px 12px', whiteSpace: 'nowrap' }}
            onClick={() => { setApplied(true); onApplyAll(); }}
          >
            Appliquer tout
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '6px 12px', whiteSpace: 'nowrap' }}
            onClick={() => { setDismissed(true); onDismissAll(); }}
          >
            Ignorer
          </button>
        </>
      )}
    </div>
  );
}

function TouchpointSuggestion({ suggestion, onApply, onDismiss }) {
  const [state, setState] = useState('visible'); // visible | applied | dismissed

  if (state === 'dismissed') return null;

  if (state === 'applied') {
    return (
      <div className="tp-ai-suggestion" style={{ opacity: 1 }}>
        <div style={{ fontSize: '11px', color: 'var(--success)', fontWeight: 600 }}>
          Suggestion appliquée -- vérifiez le résultat
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
      {count} / {maxChars} caractères
    </span>
  );
}

function TouchpointCard({
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

  /* ─── Track edits and propagate to parent state ─── */
  const handleFieldBlur = useCallback((field) => {
    setEditing(false);
    const ref = field === 'subject' ? subjectRef : bodyRef;
    if (!ref.current) return;
    const newValue = stripEditorHtml(ref.current.innerHTML);
    const oldValue = field === 'subject' ? (tp.subject || '') : (tp.body || '');
    if (newValue !== oldValue) {
      onTouchpointUpdate(tp.id, { [field]: newValue });
    }
  }, [tp.id, tp.subject, tp.body, onTouchpointUpdate]);

  /* ─── Regenerate single touchpoint ─── */
  const handleRegenerate = useCallback(async () => {
    setRegenStatus('loading');
    setRegenMsg('Régénération en cours...');

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
        setRegenMsg('Régénéré -- vérifiez le résultat avant de sauvegarder');
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
            Régénérer
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
              onBlur={() => handleFieldBlur('subject')}
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
            onBlur={() => handleFieldBlur('body')}
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

function LaunchBar({ campaign, campaignKey, touchpoints, backendAvailable, onLaunchSuccess }) {
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState(null);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setError(null);

    const backendId = campaign._backendId || campaignKey;
    if (backendAvailable) {
      try {
        await api.saveSequence(backendId, touchpoints);
        await api.updateCampaign(backendId, { status: 'active' });
      } catch (err) {
        console.warn('Backend launch failed:', err.message);
        setError(err.message);
        setLaunching(false);
        return;
      }
    }

    setLaunched(true);
    setLaunching(false);
    onLaunchSuccess();
  }, [campaign, campaignKey, touchpoints, backendAvailable, onLaunchSuccess]);

  if (launched) {
    return (
      <div className="editor-launch-bar" style={{ borderColor: 'var(--success)' }}>
        <div className="editor-launch-info" style={{ flex: 1 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--success)', letterSpacing: '-0.2px' }}>
            Séquence déployée
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {touchpoints.length} touchpoints actifs -- Les premiers envois démarrent sous 24h
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-launch-bar">
      <div className="editor-launch-info">
        <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.2px' }}>Séquence prête</div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
          {touchpoints.length} touchpoints -- Vérifiez vos messages puis lancez la campagne
        </div>
      </div>
      <button
        className="btn-launch"
        disabled={launching}
        onClick={handleLaunch}
        style={launching ? { opacity: 0.6 } : undefined}
      >
        {launching ? 'Lancement en cours...' : 'Lancer la sequence'}
      </button>
      {error && (
        <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '8px' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function ParamsPanel({ params, onClose }) {
  return (
    <div id="params-panel" style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600 }}>Paramètres de la campagne</div>
        <button className="tp-action" style={{ fontSize: '11px' }} onClick={onClose}>Fermer</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {params.map((p) => (
          <div key={p.l}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>{p.l}</div>
            <div style={{ fontSize: '13px', fontWeight: 500 }}>{p.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Main Component ═══ */

export default function CopyEditorPage() {
  const { campaigns, backendAvailable, setCampaigns } = useApp();
  const { demoMode } = useOutletContext?.() || {};
  const navigate = useNavigate();

  // Derive base editor data from campaigns context
  const baseEditorData = useMemo(() => {
    let synced = {};
    if (Object.keys(campaigns).length > 0) {
      synced = syncCampaignsFromContext(campaigns);
    }
    if (Object.keys(synced).length === 0 && demoMode) {
      synced = JSON.parse(JSON.stringify(EDITOR_FALLBACK));
    }
    return synced;
  }, [campaigns, demoMode]);

  // Local overrides state (for edits before save)
  const [localOverrides, setLocalOverrides] = useState({});
  const editorCampaigns = useMemo(() => ({ ...baseEditorData, ...localOverrides }), [baseEditorData, localOverrides]);
  const setEditorCampaigns = useCallback((updater) => {
    if (typeof updater === 'function') {
      setLocalOverrides(prev => {
        const merged = { ...baseEditorData, ...prev };
        return updater(merged);
      });
    } else {
      setLocalOverrides(updater);
    }
  }, [baseEditorData]);

  const [activeCampaign, setActiveCampaign] = useState(() => {
    const keys = Object.keys(baseEditorData);
    return keys.length > 0 ? keys[0] : null;
  });
  const [showParams, setShowParams] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'error'
  const [saveMessage, setSaveMessage] = useState('');
  const [regenAllStatus, setRegenAllStatus] = useState(null); // null | 'loading' | 'done' | 'error'
  const [regenAllMessage, setRegenAllMessage] = useState('');
  const [varRegistry, setVarRegistry] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showVarGenerator, setShowVarGenerator] = useState(false);

  /* ─── Select campaign ─── */
  const selectCampaign = useCallback((key) => {
    setActiveCampaign(key);
    setShowParams(false);
    setSaveStatus(null);
    setRegenAllStatus(null);
  }, []);

  /* ─── Insert variable into the focused editable field ─── */
  const handleInsertVariable = useCallback((key) => {
    const tag = `{{${key}}}`;
    // Find the currently focused editable in an editing touchpoint card
    let target = document.querySelector('.touchpoint-card.editing .tp-editable:focus');
    if (!target) {
      target = document.querySelector('.touchpoint-card.editing .tp-editable[data-field="body"]');
    }
    if (!target) return; // No field focused

    const sel = window.getSelection();
    if (sel.rangeCount > 0 && target.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const span = document.createElement('span');
      span.className = 'var';
      span.textContent = tag;
      range.insertNode(span);
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      const span = document.createElement('span');
      span.className = 'var';
      span.textContent = tag;
      target.appendChild(span);
    }
  }, []);

  /* ─── Handle touchpoint field updates (from inline editing) ─── */
  const handleTouchpointUpdate = useCallback((tpId, changes) => {
    setIsDirty(true);
    setEditorCampaigns((prev) => {
      const c = prev[activeCampaign];
      if (!c) return prev;
      return {
        ...prev,
        [activeCampaign]: {
          ...c,
          touchpoints: c.touchpoints.map((tp) =>
            tp.id === tpId ? { ...tp, ...changes } : tp
          ),
        },
      };
    });
  }, [activeCampaign, setEditorCampaigns]);

  /* ─── Current campaign data ─── */
  const currentCampaign = activeCampaign ? editorCampaigns[activeCampaign] : null;

  /* ─── Collect edited content from DOM ─── */
  const collectEdits = useCallback(() => {
    if (!currentCampaign) return [];
    return currentCampaign.touchpoints.map((tp) => {
      const card = document.querySelector(`[data-tp="${tp.id}"]`);
      if (!card) return tp;
      const subjectEl = card.querySelector('.tp-editable[data-field="subject"]');
      const bodyEl = card.querySelector('.tp-editable[data-field="body"]');
      return {
        ...tp,
        subject: subjectEl ? stripEditorHtml(subjectEl.innerHTML) : tp.subject,
        body: bodyEl ? stripEditorHtml(bodyEl.innerHTML) : tp.body,
      };
    });
  }, [currentCampaign]);

  /* ─── Duplicate touchpoint ─── */
  const duplicateTouchpoint = useCallback((tpId) => {
    setIsDirty(true);
    setEditorCampaigns((prev) => {
      const c = prev[activeCampaign];
      if (!c) return prev;
      const tpIndex = c.touchpoints.findIndex((t) => t.id === tpId);
      if (tpIndex === -1) return prev;

      const original = c.touchpoints[tpIndex];
      const copy = { ...JSON.parse(JSON.stringify(original)), id: tpId + '-copy', label: original.label + ' (copie)', suggestion: null };
      const newTouchpoints = [...c.touchpoints];
      newTouchpoints.splice(tpIndex + 1, 0, copy);

      return {
        ...prev,
        [activeCampaign]: { ...c, touchpoints: newTouchpoints },
      };
    });
  }, [activeCampaign, setEditorCampaigns]);

  /* ─── Delete touchpoint ─── */
  const deleteTouchpoint = useCallback((tpId) => {
    setIsDirty(true);
    setEditorCampaigns((prev) => {
      const c = prev[activeCampaign];
      if (!c) return prev;
      return {
        ...prev,
        [activeCampaign]: {
          ...c,
          touchpoints: c.touchpoints.filter((t) => t.id !== tpId),
        },
      };
    });
  }, [activeCampaign, setEditorCampaigns]);

  /* ─── Apply all suggestions ─── */
  const applyAllSuggestions = useCallback(() => {
    // Each TouchpointSuggestion handles its own UI state;
    // we trigger apply on all cards with suggestions via DOM
    if (!currentCampaign) return;
    currentCampaign.touchpoints.forEach((tp) => {
      if (!tp.suggestion) return;
      const card = document.querySelector(`[data-tp="${tp.id}"]`);
      if (!card) return;
      const applyBtn = card.querySelector('.tp-ai-suggestion .tp-action.ai');
      if (applyBtn) applyBtn.click();
    });
  }, [currentCampaign]);

  /* ─── Dismiss all suggestions ─── */
  const dismissAllSuggestions = useCallback(() => {
    if (!currentCampaign) return;
    currentCampaign.touchpoints.forEach((tp) => {
      if (!tp.suggestion) return;
      const card = document.querySelector(`[data-tp="${tp.id}"]`);
      if (!card) return;
      const dismissBtn = card.querySelector('.tp-ai-suggestion .tp-action:not(.ai)');
      if (dismissBtn) dismissBtn.click();
    });
  }, [currentCampaign]);

  /* ─── Save changes ─── */
  const saveChanges = useCallback(async () => {
    if (!currentCampaign || !activeCampaign) return;

    const editedTouchpoints = collectEdits();
    const now = new Date();
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    // Persist to backend if available
    let savedToBackend = false;
    if (backendAvailable) {
      const backendId = currentCampaign._backendId || activeCampaign;
      try {
        await api.saveSequence(backendId, editedTouchpoints);
        savedToBackend = true;
      } catch (err) {
        console.warn('Backend save failed:', err.message);
        setSaveStatus('error');
        setSaveMessage('Erreur de sauvegarde : ' + err.message);
        setTimeout(() => setSaveStatus(null), 3000);
        return;
      }
    }

    // Update BAKAL data layer (context)
    if (campaigns[activeCampaign]) {
      setCampaigns((prev) => ({
        ...prev,
        [activeCampaign]: {
          ...prev[activeCampaign],
          sequence: editedTouchpoints.map((tp) => ({
            id: tp.id,
            _backendId: tp._backendId,
            type: tp.type,
            label: tp.label,
            timing: tp.timing,
            subType: tp.subType,
            subject: tp.subject,
            body: tp.body,
            maxChars: tp.maxChars,
            stats: null,
          })),
        },
      }));
    }

    // Update local editor state
    setEditorCampaigns((prev) => {
      const c = prev[activeCampaign];
      if (!c) return prev;
      return {
        ...prev,
        [activeCampaign]: {
          ...c,
          touchpoints: editedTouchpoints.map((tp) => ({
            ...tp,
            subject: tp.subject ? highlightVars(tp.subject) : null,
            body: highlightVars(tp.body || ''),
          })),
        },
      };
    });

    setIsDirty(false);
    const suffix = savedToBackend ? ' -- Synchronise' : ' -- Local';
    setSaveStatus('saved');
    setSaveMessage(`Séquences sauvegardées -- ${time}${suffix}`);
    setTimeout(() => {
      setSaveStatus(null);
      setSaveMessage(`Derniere sauvegarde : aujourd'hui a ${time}`);
    }, 3000);
  }, [currentCampaign, activeCampaign, backendAvailable, campaigns, setCampaigns, collectEdits, setEditorCampaigns]);

  /* ─── Cancel changes (re-render from data) ─── */
  const cancelChanges = useCallback(() => {
    // Force re-sync from context
    let synced = {};
    if (Object.keys(campaigns).length > 0) {
      synced = syncCampaignsFromContext(campaigns);
    }
    if (Object.keys(synced).length === 0 && demoMode) {
      synced = JSON.parse(JSON.stringify(EDITOR_FALLBACK));
    }
    setEditorCampaigns(synced);
    setIsDirty(false);
  }, [campaigns, setEditorCampaigns]);

  /* ─── Regenerate all ─── */
  const regenerateAll = useCallback(async () => {
    if (!currentCampaign || !activeCampaign) return;

    setRegenAllStatus('loading');
    setRegenAllMessage('Claude analyse la campagne et régénère les touchpoints.');

    if (backendAvailable) {
      const backendId = currentCampaign._backendId || activeCampaign;
      try {
        const result = await api.runRefinement(backendId);

        // Apply regenerated messages via DOM
        if (result.regeneration) {
          (result.regeneration.messages || []).forEach((msg) => {
            if (!msg.variantA) return;
            const card = document.querySelector(`[data-tp="${msg.step}"]`);
            if (!card) return;
            const subjectEl = card.querySelector('.tp-editable[data-field="subject"]');
            const bodyEl = card.querySelector('.tp-editable[data-field="body"]');
            if (subjectEl && msg.variantA.subject) subjectEl.innerHTML = highlightVars(msg.variantA.subject);
            if (bodyEl && msg.variantA.body) bodyEl.innerHTML = highlightVars(msg.variantA.body).replace(/\n/g, '<br>');
          });
        }

        const stepsCount = result.stepsRegenerated?.length || 0;
        setRegenAllStatus('done');
        setRegenAllMessage(
          stepsCount > 0
            ? `Régénération terminée -- ${stepsCount} touchpoint(s) modifié(s)`
            : 'Analyse terminée -- aucune régénération nécessaire'
        );
      } catch (err) {
        console.warn('Refinement loop failed:', err.message);
        setRegenAllStatus('error');
        setRegenAllMessage('Erreur : ' + err.message);
      }
    } else {
      setRegenAllStatus('error');
      setRegenAllMessage('Connectez le backend pour utiliser la régénération IA.');
    }

    setTimeout(() => {
      setRegenAllStatus(null);
      setRegenAllMessage('');
    }, 6000);
  }, [currentCampaign, activeCampaign, backendAvailable]);

  /* ─── Launch success handler ─── */
  const handleLaunchSuccess = useCallback(() => {
    if (!activeCampaign) return;

    setEditorCampaigns((prev) => {
      const c = prev[activeCampaign];
      if (!c) return prev;
      return { ...prev, [activeCampaign]: { ...c, status: 'active' } };
    });

    if (campaigns[activeCampaign]) {
      setCampaigns((prev) => ({
        ...prev,
        [activeCampaign]: { ...prev[activeCampaign], status: 'active' },
      }));
    }
  }, [activeCampaign, campaigns, setCampaigns, setEditorCampaigns]);

  /* ─── Render ─── */

  if (Object.keys(editorCampaigns).length === 0) {
    return (
      <div className="page-content">
        <div className="page-header">
          <div>
            <div className="page-title">Copy & Séquences</div>
            <div className="page-subtitle">Éditeur de séquences et touchpoints</div>
          </div>
        </div>
        <div className="empty-state" style={{ padding: '80px 0' }}>
          <div className="empty-state-icon">✏️</div>
          <div className="empty-state-title">Aucune campagne</div>
          <div className="empty-state-desc">
            Créez votre première campagne pour commencer à éditer vos séquences et touchpoints.
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/chat')}>
            Créer ma première campagne
          </button>
        </div>
      </div>
    );
  }

  if (!currentCampaign) {
    return (
      <div className="copy-editor-page" style={{ display: 'flex', height: '100%' }}>
        <EditorSidebar
          editorCampaigns={editorCampaigns}
          activeCampaign={activeCampaign}
          onSelect={selectCampaign}
        />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
          Aucune campagne sélectionnée
        </div>
      </div>
    );
  }

  const statusText = currentCampaign.status === 'prep'
    ? 'Campagne en préparation -- les modifications seront déployées au lancement'
    : 'Campagne active -- les modifications seront appliquées à la prochaine itération';

  return (
    <div className="copy-editor-page" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ─── Sidebar ─── */}
      <EditorSidebar
        editorCampaigns={editorCampaigns}
        activeCampaign={activeCampaign}
        onSelect={selectCampaign}
      />

      {/* ─── Main editor ─── */}
      <div className="editor-main" id="editor-main-content" style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {/* Header */}
        <div className="editor-header">
          <div>
            <div className="editor-header-title">{currentCampaign.name}</div>
            <div className="editor-header-params">
              {currentCampaign.params.map((p) => (
                <span key={p.l} className="editor-param">{p.l}: {p.v}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={() => setShowParams(!showParams)}
            >
              Paramètres
            </button>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={() => {
                const backendId = currentCampaign._backendId || activeCampaign;
                exportCampaignCsv(backendId);
              }}
            >
              Exporter CSV
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={regenerateAll}
              disabled={regenAllStatus === 'loading'}
            >
              {regenAllStatus === 'loading' ? 'Régénération...' : 'Tout régénérer'}
            </button>
          </div>
        </div>

        {/* Params panel */}
        {showParams && (
          <ParamsPanel
            params={currentCampaign.params}
            onClose={() => setShowParams(false)}
          />
        )}

        {/* Launch bar for prep campaigns */}
        {currentCampaign.status === 'prep' && (
          <LaunchBar
            campaign={currentCampaign}
            campaignKey={activeCampaign}
            touchpoints={currentCampaign.touchpoints}
            backendAvailable={backendAvailable}
            onLaunchSuccess={handleLaunchSuccess}
          />
        )}

        {/* AI bar — show AiBar component for both campaign suggestions and regen status */}
        {(currentCampaign.aiBar || regenAllStatus) && (
          <AiBar
            aiBar={regenAllStatus
              ? { title: regenAllStatus === 'loading' ? 'Régénération en cours...' : regenAllMessage, text: regenAllMessage }
              : currentCampaign.aiBar}
            onApplyAll={applyAllSuggestions}
            onDismissAll={dismissAllSuggestions}
          />
        )}

        {/* Touchpoint cards */}
        {currentCampaign.touchpoints.map((tp) => (
          <TouchpointCard
            key={tp.id}
            tp={tp}
            backendAvailable={backendAvailable}
            campaignData={currentCampaign}
            activeCampaignKey={activeCampaign}
            onDuplicate={() => duplicateTouchpoint(tp.id)}
            onDelete={() => deleteTouchpoint(tp.id)}
            onTouchpointUpdate={handleTouchpointUpdate}
          />
        ))}

        {/* VarGenerator — collapsible refinement tool */}
        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '13px', padding: '8px 14px', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            onClick={() => setShowVarGenerator(!showVarGenerator)}
          >
            <span>{'\u{1F9EC}'} Refinement A/B — Générateur de variables</span>
            <span style={{ fontSize: '11px' }}>{showVarGenerator ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showVarGenerator && (
            <div style={{ marginTop: '12px' }}>
              <VarGenerator
                onAcceptVariable={(key, varData) => {
                  console.log('Variable accepted:', key, varData);
                }}
                onAcceptAll={(scenarioKey, chain) => {
                  console.log('All variables accepted for scenario:', scenarioKey, chain.length, 'variables');
                }}
              />
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="editor-bottom-bar">
          <div className="editor-bottom-info">
            {saveStatus === 'saved' ? (
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>{saveMessage}</span>
            ) : saveStatus === 'error' ? (
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{saveMessage}</span>
            ) : isDirty ? (
              <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Modifications non sauvegardées</span>
            ) : saveMessage ? (
              saveMessage
            ) : (
              statusText
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={cancelChanges}
            >
              Annuler les modifications
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '8px 14px' }}
              onClick={saveChanges}
            >
              Sauvegarder les séquences
            </button>
          </div>
        </div>
      </div>

      {/* ─── Variable Manager (right sidebar) ─── */}
      <div className="editor-var-panel" style={{
        width: 260, flexShrink: 0, borderLeft: '1px solid var(--border)',
        overflow: 'auto', background: 'var(--bg-card)',
      }}>
        <VariableManager
          onInsertVariable={handleInsertVariable}
          initialRegistry={varRegistry}
          defaultOpen
          onRegistryChange={setVarRegistry}
        />
      </div>
    </div>
  );
}
