/* ═══════════════════════════════════════════════════
   Billing Settings · plan display + Stripe checkout/portal
   Tant que Stripe n'est pas branché côté backend (STRIPE_SECRET_KEY absente),
   GET /billing renvoie billingEnabled:false : les cartes s'affichent avec les
   prix mais les boutons sont neutralisés · aucun flux de paiement fantôme.
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

  const checkout = async (cycle) => {
    setBusy(true);
    try {
      const d = await request('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ cycle }),
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
  const abonne = !!state?.subscribed;
  // ── UN SEUL PRODUIT, DEUX PERIODICITES ────────────────────────────────────
  //
  // L'ecran proposait trois paliers a 49, 149 et 349 €, la grille morte depuis
  // le 2026-09-21. Il n'y a plus de palier a choisir : le produit est complet,
  // il se paie 79 € par siege, et la seule question est mensuel ou annuel.
  const seats = state?.seats ?? 1;
  const seatPrice = state?.seatPrice ?? 79;
  const moisOfferts = state?.annualMonthsFree ?? 2;
  const offres = [
    {
      key: 'monthly',
      nom: t('settings.billingMonthly'),
      total: state?.monthlyTotal ?? seatPrice * seats,
      unite: t('settings.billingPerMonth'),
      note: null,
    },
    {
      key: 'annual',
      nom: t('settings.billingAnnual'),
      total: state?.annualTotal ?? seatPrice * 10 * seats,
      unite: t('settings.billingPerYear'),
      note: t('settings.billingMonthsFree', { count: moisOfferts }),
    },
  ];

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{t('settings.billingTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('settings.billingCurrent')} : <strong>{abonne ? t('settings.billingSubscribedLabel') : t('settings.billingTrialLabel')}</strong>
            {/* Le nombre de sieges facture, affiche AVANT de payer : c'est lui
                qui multiplie le prix, donc la premiere chose a verifier. */}
            {' · '}{t('settings.billingSeats', { count: seats, price: seatPrice })}
            {!enabled && <span style={{ marginLeft: 8, color: 'var(--primary)' }}>· {t('settings.billingSoon')}</span>}
          </div>
        </div>
        {state?.subscribed && (
          <button className="btn btn-ghost" onClick={portal} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
            {t('settings.billingManage')}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {offres.map(o => (
          <div key={o.key} style={{
            border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{o.nom}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '6px 0' }}>
              {o.total.toLocaleString('fr-FR')}€
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{o.unite}</span>
            </div>
            <div style={{ fontSize: 11.5, color: o.note ? 'var(--success)' : 'var(--text-muted)', minHeight: 32 }}>
              {o.note || t('settings.billingSeatDetail', { count: seats, price: seatPrice })}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => checkout(o.key)}
              disabled={busy || !enabled || abonne}
              style={{ width: '100%', marginTop: 10 }}
            >
              {abonne ? t('settings.billingCurrentBtn') : t('settings.billingSubscribe')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
