/* ===============================================================================
   BAKAL — Assistant Nudge
   Compact topbar CTA pointing to the Assistant (/chat) for general questions —
   replaces the per-page "Interroger vos données" block once removed from Analytics.
   =============================================================================== */

import { useNavigate, useLocation } from 'react-router-dom';
import { useT } from '../i18n';
import Icon from './Icon';

export default function AssistantNudge() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();

  // Inutile sur la page de l'Assistant elle-même
  if (location.pathname === '/chat') return null;

  return (
    <button
      onClick={() => navigate('/chat')}
      className="assistant-nudge"
      title={t('assistantNudge.hint')}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px 6px 10px', borderRadius: 20, cursor: 'pointer',
        border: '1px solid var(--border)', background: 'var(--bg-card)',
        color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="chat" size={13} color="var(--primary)" />
      <span>{t('assistantNudge.label')}</span>
    </button>
  );
}
