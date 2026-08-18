/* ===============================================================================
   BAKAL — À traiter aujourd'hui
   Liste unifiée des actions priorisées (GET /api/priorities/today) : emails
   nurture à approuver, deals stagnants, upsells, risques churn, signaux.
   Absorbe l'ancien DealCoachCard : une seule liste, un seul score 0-100.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { request } from '../services/api-client';
import { useT } from '../i18n';

const TYPE_META = {
  nurture_approval: { icon: '✉️', labelKey: 'today.typeNurture', color: '#6E57FA' },
  deal_stagnant: { icon: '🎯', labelKey: 'today.typeDealStagnant', color: '#f59e0b' },
  upsell: { icon: '📈', labelKey: 'today.typeUpsell', color: '#22c55e' },
  churn_risk: { icon: '⚠️', labelKey: 'today.typeChurn', color: '#ef4444' },
  signal: { icon: '📡', labelKey: 'today.typeSignal', color: '#3b82f6' },
};

function scoreColor(score) {
  if (score >= 75) return '#ef4444';
  if (score >= 55) return '#f59e0b';
  return '#22c55e';
}

export default function TodayCard() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [batchNote, setBatchNote] = useState(null);
  const [busyIds, setBusyIds] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const d = await request('/priorities/today');
      setData(d);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApproveAll = useCallback(async () => {
    if (!data?.pendingEmailIds?.length) return;
    setApproving(true);
    setBatchNote(null);
    try {
      // Le backend plafonne à 20 envois par appel (délivrabilité) : on envoie
      // les 20 premiers, le libellé indique le restant.
      const batch = data.pendingEmailIds.slice(0, 20);
      const res = await request('/nurture/emails/approve-batch', {
        method: 'POST',
        body: JSON.stringify({ ids: batch }),
      });
      const remaining = data.pendingEmailIds.length - batch.length;
      let note = t('today.approvedOk', { sent: res.sent });
      if (res.failed > 0) note += ' · ' + t('today.approvedFailed', { failed: res.failed });
      if (remaining > 0) note += ' · ' + t('today.remaining', { count: remaining });
      setBatchNote(note);
      await load();
    } catch {
      setBatchNote(null);
    }
    setApproving(false);
  }, [data, load, t]);

  const handleApproveOne = useCallback(async (emailId) => {
    setBusyIds((prev) => new Set(prev).add(emailId));
    try {
      await request(`/nurture/emails/${emailId}/approve`, { method: 'POST' });
      await load();
    } catch { /* l'item reste affiché */ }
    setBusyIds((prev) => { const s = new Set(prev); s.delete(emailId); return s; });
  }, [load]);

  const handleDismissOne = useCallback(async (emailId) => {
    setBusyIds((prev) => new Set(prev).add(emailId));
    try {
      await request(`/nurture/emails/${emailId}/cancel`, { method: 'POST' });
      await load();
    } catch { /* l'item reste affiché */ }
    setBusyIds((prev) => { const s = new Set(prev); s.delete(emailId); return s; });
  }, [load]);

  const handleChat = useCallback((item) => {
    const params = {
      name: item.contactName || item.contactEmail || '',
      company: item.company || '',
      reason: item.reason || '',
      suggestion: item.suggestion || '',
    };
    const key = item.type === 'churn_risk' ? 'today.chatChurnPrefill'
      : item.type === 'upsell' ? 'today.chatUpsellPrefill'
      : 'today.chatDealPrefill';
    navigate('/chat', { state: { prefillMessage: t(key, params) } });
  }, [navigate, t]);

  if (loading || !data || data.items.length === 0) return null;

  const pendingCount = data.counts.nurturePending;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(110,87,250,0.05) 0%, rgba(245,158,11,0.05) 100%)',
      border: '1px solid rgba(110,87,250,0.12)',
      borderRadius: 12,
      padding: '18px 22px',
      marginBottom: 20,
      animation: 'fadeInUp 0.4s ease-out',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {'☀️'} {t('today.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('today.subtitle', { count: data.counts.total })}
            {batchNote && <span style={{ marginLeft: 8, color: 'var(--primary)', fontWeight: 600 }}>{batchNote}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {pendingCount > 1 && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 12px' }}
              onClick={handleApproveAll}
              disabled={approving}
            >
              {approving ? t('today.approving') : t('today.approveAll', { count: Math.min(pendingCount, 20) })}
            </button>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={load}
          >
            {t('today.refresh')}
          </button>
        </div>
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.items.map((item, i) => {
          const meta = TYPE_META[item.type] || TYPE_META.deal_stagnant;
          const busy = item.emailId && busyIds.has(item.emailId);
          return (
            <div key={item.emailId || item.signalId || `${item.type}-${i}`} style={{
              padding: '12px 14px', borderRadius: 10,
              background: 'var(--paper, #FAFAF9)', border: '1px solid rgba(0,0,0,0.06)',
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    color: meta.color, background: `${meta.color}14`, whiteSpace: 'nowrap',
                  }}>
                    {meta.icon} {t(meta.labelKey)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {item.contactName || item.contactEmail || item.title}
                  </span>
                  {item.company && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>@ {item.company}</span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px',
                    borderRadius: 4, color: scoreColor(item.score), background: `${scoreColor(item.score)}10`,
                  }}>
                    {item.score}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {item.type === 'nurture_approval' && (
                    <>
                      {item.subject}
                      {item.daysWaiting > 0 && <span> · {t('today.waitingDays', { days: item.daysWaiting })}</span>}
                    </>
                  )}
                  {item.type !== 'nurture_approval' && (item.reason || item.title)}
                  {item.suggestion && (
                    <div style={{ color: 'var(--text)', fontStyle: 'italic', marginTop: 2 }}>{item.suggestion}</div>
                  )}
                  {item.alsoFlaggedBy?.length > 0 && (
                    <div style={{ marginTop: 2, fontSize: 11 }}>
                      {t('today.alsoFlaggedBy', {
                        sources: item.alsoFlaggedBy.map((ty) => t(TYPE_META[ty]?.labelKey || ty)).join(', '),
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ flexShrink: 0, display: 'flex', gap: 4 }}>
                {item.type === 'nurture_approval' && (
                  <>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
                      onClick={() => handleApproveOne(item.emailId)}
                      disabled={busy || approving}
                    >
                      {busy ? '...' : t('today.approve')}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '6px 10px' }}
                      onClick={() => handleDismissOne(item.emailId)}
                      disabled={busy || approving}
                    >
                      {t('today.dismiss')}
                    </button>
                  </>
                )}
                {(item.type === 'deal_stagnant' || item.type === 'upsell' || item.type === 'churn_risk') && (
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
                    onClick={() => handleChat(item)}
                  >
                    {t('today.prepareEmail')}
                  </button>
                )}
                {item.type === 'signal' && (
                  <Link
                    to="/signals"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {t('today.openSignals')}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
