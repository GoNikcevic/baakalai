/* ===============================================================================
   BAKAL — Data Quality prerequisite banners
   Alerts for missing prerequisites that make the rest of Baakalai unusable — no CRM
   connected, or no email account connected (relance/upsell emails can't be sent at
   all without one). Same dismiss-with-TTL-in-localStorage pattern as
   ReactivationQueuePage.jsx's CRM hygiene banner.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';

const TTL = 24 * 60 * 60 * 1000;

function useDismissible(key) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = parseInt(localStorage.getItem(key) || '0', 10);
      return ts > 0 && (Date.now() - ts) < TTL;
    } catch { return false; }
  });
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
  };
  return [dismissed, dismiss];
}

function Banner({ titleKey, descKey, ctaKey, onDismiss }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      background: 'var(--accent-glow)', border: '1px solid var(--border-light)',
      borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 12,
    }}>
      <div>
        <div style={{ fontWeight: 600 }}>{t(titleKey)}</div>
        <div style={{ color: 'var(--text-secondary)' }}>{t(descKey)}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => navigate('/settings')}>
          {t(ctaKey)}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={onDismiss}>×</button>
      </div>
    </div>
  );
}

export default function DataQualityBanners() {
  const [noCrmDismissed, dismissNoCrm] = useDismissible('bakal_dq_crm_banner_dismissed');
  const [noEmailDismissed, dismissNoEmail] = useDismissible('bakal_dq_email_banner_dismissed');
  const [hasCrm, setHasCrm] = useState(true);
  const [hasEmail, setHasEmail] = useState(true);

  useEffect(() => {
    request('/crm/providers').then(d => {
      setHasCrm((d.providers || []).some(p => p.connected));
    }).catch(() => {});
    request('/nurture/email-accounts').then(d => {
      setHasEmail((d.accounts || []).length > 0);
    }).catch(() => {});
  }, []);

  return (
    <>
      {!hasCrm && !noCrmDismissed && (
        <Banner titleKey="dataQuality.banners.noCrm.title" descKey="dataQuality.banners.noCrm.desc" ctaKey="dataQuality.banners.noCrm.cta" onDismiss={dismissNoCrm} />
      )}
      {!hasEmail && !noEmailDismissed && (
        <Banner titleKey="dataQuality.banners.noEmail.title" descKey="dataQuality.banners.noEmail.desc" ctaKey="dataQuality.banners.noEmail.cta" onDismiss={dismissNoEmail} />
      )}
    </>
  );
}
