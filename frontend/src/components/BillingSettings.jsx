/* ═══════════════════════════════════════════════════
   Billing Settings — plan display + Stripe checkout/portal
   Tant que Stripe n'est pas branché côté backend (STRIPE_SECRET_KEY absente),
   GET /billing renvoie billingEnabled:false : les cartes s'affichent avec les
   prix mais les boutons sont neutralisés — aucun flux de paiement fantôme.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';
import { useNotifications } from '../context/NotificationContext';

export default function BillingSettings() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const { showToast: notifyToast } = useNotifications();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((msg, type = 'success') => {
    notifyToast({
      type: type === 'error' ? 'danger' : type,
      title: type === 'error' ? (en ? 'Error' : 'Erreur') : (en ? 'Success' : 'Succès'),
      message: msg,
      duration: 3000,
    });
  }, [notifyToast, en]);

  useEffect(() => {
    request('/billing').then(setState).catch(() => {});
  }, []);

  const checkout = async (plan) => {
    setBusy(true);
    try {
      const d = await request('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      if (d.url) window.location.href = d.url;
    } catch (err) {
      showToast(err.message || t('settings.billingSoon'), 'error');
    }
    setBusy(false);
  };

  const portal = async () => {
    setBusy(true);
    try {
      const d = await request('/billing/portal', { method: 'POST' });
      if (d.url) window.location.href = d.url;
    } catch (err) {
      showToast(err.message || (en ? 'Error' : 'Erreur'), 'error');
    }
    setBusy(false);
  };

  const enabled = !!state?.billingEnabled;
  const currentPlan = state?.plan || 'trial';
  const plans = [
    { key: 'starter', name: 'Starter', price: state?.prices?.starter ?? 49, feat: t('settings.billingFeatStarter') },
    { key: 'growth', name: 'Growth', price: state?.prices?.growth ?? 149, feat: t('settings.billingFeatGrowth') },
    { key: 'scale', name: 'Scale', price: state?.prices?.scale ?? 349, feat: t('settings.billingFeatScale') },
  ];

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t('settings.billingTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('settings.billingCurrent')} : <strong>{currentPlan === 'trial' ? t('settings.billingTrialLabel') : currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}</strong>
            {!enabled && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>· {t('settings.billingSoon')}</span>}
          </div>
        </div>
        {state?.subscribed && (
          <button className="btn btn-ghost" onClick={portal} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
            {t('settings.billingManage')}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {plans.map(p => (
          <div key={p.key} style={{
            border: currentPlan === p.key ? '1.5px solid var(--primary)' : '1px solid var(--border)',
            borderRadius: 10, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '6px 0' }}>
              {p.price}€<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{t('settings.billingPerMonth')}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', minHeight: 32 }}>{p.feat}</div>
            <button
              className={currentPlan === p.key ? 'btn btn-ghost' : 'btn btn-primary'}
              onClick={() => checkout(p.key)}
              disabled={busy || !enabled || currentPlan === p.key}
              style={{ width: '100%', marginTop: 10 }}
            >
              {currentPlan === p.key ? t('settings.billingCurrentBtn') : t('settings.billingSubscribe')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
