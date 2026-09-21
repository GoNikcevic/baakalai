/* ===============================================================================
   BAKAL · Bandeau « aucune boîte mail connectée »

   Mesuré en prod le 2026-09-21 : 15 comptes, 0 boîte mail connectée, 188
   brouillons en attente, 0 email envoyé depuis l'origine. Le moteur faisait
   son travail, l'envoi échouait au transport (getDefaultAccount renvoie null,
   lib/email-outbound.js) et l'écran d'Automatisation ne disait rien · on ne
   découvrait l'impasse qu'en approuvant un brouillon, un par un.

   Ce bandeau n'est pas fermable : tant qu'il est là, aucune relance ne peut
   partir, ce n'est pas un conseil mais l'état du produit.
   =============================================================================== */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';
import Icon from './Icon';

export default function MailboxBanner({ summary }) {
  const t = useT();
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(null);

  // Tant que le résumé n'est pas chargé, on n'affiche rien : un bandeau
  // d'alerte qui clignote au chargement de chaque page vaut moins que rien.
  if (!summary || summary.hasMailbox) return null;

  const connect = async (provider) => {
    setConnecting(provider);
    try {
      const data = await request(`/nurture/email-accounts/connect/${provider}`);
      if (data.url) { window.location.href = data.url; return; }
      throw new Error(t('activation.mailbox.connectFailed'));
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
      setConnecting(null);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap',
      background: 'var(--warning-soft)',
      border: '1px solid var(--warning)', borderRadius: 12,
      padding: '14px 18px', marginBottom: 16,
    }}>
      <Icon name="mail" size={18} color="var(--warning)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 14, fontWeight: 650 }}>{t('activation.mailbox.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
          {summary.pending > 0
            ? t('activation.mailbox.descPending', { count: summary.pending })
            : t('activation.mailbox.desc')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '6px 14px' }}
          disabled={!!connecting}
          onClick={() => connect('gmail')}
        >
          {connecting === 'gmail' ? t('activation.mailbox.connecting') : t('activation.mailbox.gmail')}
        </button>
        <button
          className="btn btn-outline"
          style={{ fontSize: 12, padding: '6px 14px' }}
          disabled={!!connecting}
          onClick={() => connect('microsoft')}
        >
          {connecting === 'microsoft' ? t('activation.mailbox.connecting') : t('activation.mailbox.outlook')}
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '6px 10px' }}
          onClick={() => navigate('/settings')}
        >
          {t('activation.mailbox.other')}
        </button>
      </div>
    </div>
  );
}
