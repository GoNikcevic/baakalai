/* ===============================================================================
   BAKAL — Loading Tips Component
   Animated rotating tips shown during long-running operations.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

const TIPS = {
  en: [
    'Ask the AI to "analyze my CRM health" to get a full diagnostic.',
    'Connect your email (Gmail/Outlook) to send activation emails directly.',
    'Set up triggers in Activation to auto-follow-up stagnant leads.',
    'The AI learns from every campaign — the more you use it, the smarter it gets.',
    'Use the Renewals tab in Analytics to track upcoming expirations.',
    'Churn alerts notify you when a contact becomes high-risk.',
    'Export any analytics view to CSV with the export button.',
    'Your CRM data is synced automatically — no manual refresh needed.',
    'Create campaigns from chat: just describe your target audience.',
    'The Memory page shows patterns the AI discovered from your data.',
  ],
  fr: [
    'Demandez a l\'IA "analyse la sante de mon CRM" pour un diagnostic complet.',
    'Connectez votre email (Gmail/Outlook) pour envoyer des emails d\'activation.',
    'Configurez des triggers dans Activation pour relancer les leads stagnants.',
    'L\'IA apprend de chaque campagne — plus vous l\'utilisez, plus elle est efficace.',
    'Utilisez l\'onglet Renouvellements dans Analytics pour suivre les expirations.',
    'Les alertes churn vous notifient quand un contact devient a risque.',
    'Exportez n\'importe quelle vue analytics en CSV avec le bouton export.',
    'Vos donnees CRM sont synchronisees automatiquement.',
    'Creez des campagnes depuis le chat : decrivez votre audience cible.',
    'La page Memoire montre les patterns decouverts par l\'IA dans vos donnees.',
  ],
};

export default function LoadingTips({ title, subtitle }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  const tips = TIPS[en ? 'en' : 'fr'];
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * tips.length));
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setTipIndex(prev => (prev + 1) % tips.length);
        setFade(true);
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, [tips.length]);

  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      {/* Spinner */}
      <div style={{ marginBottom: 20 }}>
        <svg width="40" height="40" viewBox="0 0 40 40" style={{ animation: 'spin 1.2s linear infinite' }}>
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent, #6E57FA)" strokeWidth="3"
            strokeDasharray="80" strokeDashoffset="60" strokeLinecap="round" />
        </svg>
      </div>

      {/* Title */}
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        {title || (en ? 'Analyzing...' : 'Analyse en cours...')}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
          {subtitle}
        </div>
      )}

      {/* Rotating tip */}
      <div style={{
        maxWidth: 400, margin: '0 auto', padding: '14px 20px',
        background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 10,
        minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
          opacity: fade ? 1 : 0, transition: 'opacity 0.3s ease',
        }}>
          <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 6 }}>
            {en ? 'Tip' : 'Conseil'}
          </span>
          {tips[tipIndex]}
        </div>
      </div>
    </div>
  );
}
