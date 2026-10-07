/**
 * Écrire un email à un contact, depuis l'app.
 *
 * ── Ce que ce composant remplace ────────────────────────────────────────────
 *
 * Deux invites natives du navigateur enchaînées, l'une pour l'objet et l'autre
 * pour le corps. Le code les appelait même sous une forme obfusquée, en
 * reconstituant le nom de la fonction par concaténation, pour échapper à la
 * règle qui les interdit. Les libellés y étaient codés en dur en français et
 * en anglais au lieu de passer par `t()`, ce qui viole la règle 1 du
 * CLAUDE.md.
 *
 * Une boîte de dialogue native ne se met pas en forme, ne montre pas à qui on
 * écrit, ne permet pas de relire les deux champs ensemble, et bloque la page.
 *
 * ── Et baakalai écrit le premier jet ────────────────────────────────────────
 *
 * C'est le point qui compte plus que l'habillage : le produit promet de lire le
 * CRM et d'écrire la relance. Demander à l'utilisateur de taper un email dans
 * une invite grise disait exactement le contraire. Le bouton de rédaction
 * remplit les deux champs à partir de ce qu'on sait du contact, et
 * l'utilisateur garde la main · il relit, corrige, puis envoie.
 *
 * La génération ne remplace JAMAIS un texte déjà saisi sans le dire : si les
 * champs ne sont pas vides, on demande confirmation. Perdre six lignes écrites
 * à la main par un clic mal placé est le genre de détail qui fait abandonner un
 * outil.
 */

import { useState, useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import Icon from './Icon';

export default function EmailComposer({ contact, onClose, onSent }) {
  const t = useT();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const champObjet = useRef(null);

  // Échap ferme, comme tout modal de l'app. Pas pendant un envoi : fermer la
  // fenêtre ne l'annulerait pas, et laisserait croire le contraire.
  useEffect(() => {
    const auClavier = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [onClose, sending]);

  useEffect(() => { champObjet.current?.focus(); }, []);

  const faireRediger = async () => {
    // Un brouillon généré par-dessus du texte saisi se perdrait sans retour
    // arrière possible.
    if ((subject.trim() || body.trim())
      && !window.confirm(t('composer.overwriteConfirm'))) return;

    setDrafting(true);
    try {
      const r = await request(`/crm/client/${contact.id}/draft-email`, { method: 'POST' });
      setSubject(r.subject || '');
      setBody(r.body || '');
    } catch (err) {
      // La génération échoue : les champs restent ce qu'ils étaient et
      // l'utilisateur écrit lui-même. C'est exactement l'état d'avant, donc
      // une panne de rédaction ne bloque pas l'envoi.
      showToast({ type: 'error', title: t('composer.draftFailed'), message: err.message });
    }
    setDrafting(false);
  };

  const envoyer = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await request('/nurture/send', {
        method: 'POST',
        body: JSON.stringify({
          to: contact.email,
          toName: contact.name,
          subject: subject.trim(),
          body: body.trim(),
          opportunityId: contact.id,
        }),
      });
      showToast({ type: 'success', title: t('composer.sent'), message: contact.email });
      onSent?.();
      onClose();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
      setSending(false);
    }
  };

  const pretAEnvoyer = subject.trim() && body.trim() && !sending && !drafting;

  const styleChamp = {
    width: '100%', fontSize: 13, padding: '8px 10px',
    borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
    background: 'var(--bg-card)', color: 'var(--text-primary)',
    fontFamily: 'inherit',
  };

  return (
    <>
      <div
        onClick={() => { if (!sending) onClose(); }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('composer.title', { name: contact.name || contact.email })}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(640px, 94vw)', maxHeight: '88vh', overflowY: 'auto', zIndex: 201,
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)', padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {t('composer.title', { name: contact.name || contact.email })}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {contact.email}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 14, padding: '2px 8px', flexShrink: 0 }}
            onClick={onClose}
            disabled={sending}
            aria-label={t('common.close')}
          >
            {'✕'}
          </button>
        </div>

        <button
          className="btn btn-outline"
          style={{ fontSize: 12, padding: '7px 14px', margin: '14px 0 16px' }}
          onClick={faireRediger}
          disabled={drafting || sending}
        >
          <Icon name={drafting ? 'clock' : 'sparkles'} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {drafting ? t('composer.drafting') : t('composer.draftCta')}
        </button>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
          {t('composer.subject')}
        </label>
        <input
          ref={champObjet}
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          disabled={sending}
          style={{ ...styleChamp, marginBottom: 14 }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
          {t('composer.body')}
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={sending}
          rows={10}
          style={{ ...styleChamp, resize: 'vertical', lineHeight: 1.5 }}
        />

        {/* D'où part le message · un envoi qui part d'une adresse qu'on ne
            nomme pas se découvre dans la boîte du destinataire. */}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 16px' }}>
          {t('composer.fromMailbox')}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px' }} onClick={onClose} disabled={sending}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '7px 18px' }}
            onClick={envoyer}
            disabled={!pretAEnvoyer}
            title={pretAEnvoyer ? undefined : t('composer.needBoth')}
          >
            {sending ? <Icon name="clock" size={12} /> : t('composer.send')}
          </button>
        </div>
      </div>
    </>
  );
}
