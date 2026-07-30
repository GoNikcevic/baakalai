/* ===============================================================================
   BAKAL — Reactivation Queue (generic)
   Shared list page for "Deals à relancer" (kind=deal_reactivation) and
   "Clients à upseller" (kind=auto_upsell). Rule-based candidate detection only —
   no AI call happens until the user opens a single candidate ("Voir le mail").
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';

const CRM_BANNER_KEY = 'bakal_reactivation_crm_banner_dismissed';
const CRM_BANNER_TTL = 24 * 60 * 60 * 1000; // reappears after 24h

export default function ReactivationQueuePage({ kind, i18nNamespace, detailRouteBase }) {
  const t = useT();
  const navigate = useNavigate();
  const [tab, setTab] = useState('pending');
  const [candidates, setCandidates] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('overdue');
  const [postponeFor, setPostponeFor] = useState(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [showCrmBanner, setShowCrmBanner] = useState(() => {
    try {
      const ts = parseInt(localStorage.getItem(CRM_BANNER_KEY) || '0', 10);
      return !(ts > 0 && (Date.now() - ts) < CRM_BANNER_TTL);
    } catch { return true; }
  });

  const dismissCrmBanner = () => {
    setShowCrmBanner(false);
    try { localStorage.setItem(CRM_BANNER_KEY, String(Date.now())); } catch { /* ignore */ }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request(`/reactivation/queue?kind=${kind}&sort=${sort}`);
      setCandidates(data.candidates || []);
    } catch {
      setCandidates([]);
    }
    setLoading(false);
  }, [kind, sort]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (tab !== 'history' || historyLoaded) return;
    (async () => {
      try {
        const data = await request(`/reactivation/history?kind=${kind}`);
        setHistory(data.events || []);
      } catch {
        setHistory([]);
      }
      setHistoryLoaded(true);
    })();
  }, [tab, historyLoaded, kind]);

  const historyLabel = (e) => {
    const date = new Date(e.date).toLocaleDateString('fr-FR');
    if (e.eventType === 'sent') return t('reactivation.historySentOn', { date });
    if (e.eventType === 'postponed') {
      return t(e.isManual ? 'reactivation.historyPostponedManualOn' : 'reactivation.historyPostponedAutoOn', { date });
    }
    return t(e.status === 'won' ? 'reactivation.historyWonOn' : 'reactivation.historyLostOn', { date });
  };

  const historyBadgeColor = (eventType) => {
    if (eventType === 'sent') return 'var(--accent)';
    if (eventType === 'postponed') return 'var(--text-muted)';
    return 'var(--text-secondary)';
  };

  const handlePostpone = async (id) => {
    if (!postponeDate) return;
    try {
      await request(`/reactivation/${id}/postpone`, {
        method: 'POST',
        body: JSON.stringify({ date: postponeDate }),
      });
      setCandidates(prev => prev.filter(c => c.id !== id));
      setPostponeFor(null);
      setPostponeDate('');
    } catch (err) {
      showToast({ type: 'error', title: t('clients.error'), message: err.message });
    }
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(`${i18nNamespace}.title`)}</h1>
          <div className="page-subtitle">{t(`${i18nNamespace}.subtitle`)}</div>
        </div>
        {tab === 'pending' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${sort === 'value' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '6px 12px' }}
              onClick={() => setSort('value')}
            >
              {t('reactivation.sortByValue')}
            </button>
            <button
              className={`btn ${sort === 'overdue' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '6px 12px' }}
              onClick={() => setSort('overdue')}
            >
              {t('reactivation.sortByOverdue')}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-light)', marginBottom: 16 }}>
        <button
          onClick={() => setTab('pending')}
          style={{
            fontSize: 12, fontWeight: 600, padding: '8px 14px', border: 'none', cursor: 'pointer',
            borderRadius: '6px 6px 0 0',
            background: tab === 'pending' ? 'var(--accent-glow)' : 'none',
            color: tab === 'pending' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: tab === 'pending' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background 0.15s ease, color 0.15s ease',
          }}
        >
          {t('reactivation.tabPending')}
        </button>
        <button
          onClick={() => setTab('history')}
          style={{
            fontSize: 12, fontWeight: 600, padding: '8px 14px', border: 'none', cursor: 'pointer',
            borderRadius: '6px 6px 0 0',
            background: tab === 'history' ? 'var(--accent-glow)' : 'none',
            color: tab === 'history' ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: tab === 'history' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'background 0.15s ease, color 0.15s ease',
          }}
        >
          {t('reactivation.tabHistory')}
        </button>
      </div>

      {tab === 'pending' && showCrmBanner && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: 'var(--accent-glow)', border: '1px solid var(--border-light)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-secondary)' }}>{t('reactivation.crmHygieneBanner')}</span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
            onClick={dismissCrmBanner}
          >
            ×
          </button>
        </div>
      )}

      {tab === 'pending' ? (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            {t('reactivation.noCandidates')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map(c => (
              <div key={c.id} className="card">
                <div className="card-body" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name || c.company || c.email}</div>
                      {c.company && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.company}</div>}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{c.reason}</div>
                      {c.hasFailedSend && (
                        <div style={{ fontSize: 11, color: 'var(--danger, #d64545)', marginTop: 4, fontWeight: 600 }}>
                          {t('reactivation.sendFailedBadge')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.dealValue != null && (
                        <div style={{ fontSize: 14, fontWeight: 700 }}>
                          {Math.round(c.dealValue).toLocaleString('fr-FR')} €
                        </div>
                      )}
                      {c.score != null && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Score : {c.score}/100</div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => navigate(`${detailRouteBase}/${c.id}`)}
                    >
                      {t('reactivation.viewEmail')}
                    </button>

                    {postponeFor === c.id ? (
                      <>
                        <input
                          type="date"
                          value={postponeDate}
                          onChange={(e) => setPostponeDate(e.target.value)}
                          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                        />
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => handlePostpone(c.id)}>
                          OK
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => { setPostponeFor(null); setPostponeDate(''); }}
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 12px' }}
                        onClick={() => setPostponeFor(c.id)}
                      >
                        {t('reactivation.postpone')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        !historyLoaded ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>
        ) : history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            {t('reactivation.historyEmpty')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((e, idx) => (
              <div key={`${e.eventType}-${e.opportunityId}-${idx}`} className="card">
                <div className="card-body" style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{e.name || e.company}</div>
                    {e.company && e.name && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.company}</div>}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: historyBadgeColor(e.eventType) }}>
                    {historyLabel(e)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
