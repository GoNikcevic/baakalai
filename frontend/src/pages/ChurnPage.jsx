/* ===============================================================================
   BAKAL — Churn Risk Page
   Explainable weighted churn score per client, extracted from ClientsPage's former
   churn block. Adds the outcome-marking feedback loop (true/false positive/negative).
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request, runChurnScoring, getChurnSummary } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';

const REASON_CATEGORIES = ['prix', 'concurrent', 'support', 'produit_inadapte', 'budget_coupe', 'autre'];

function OutcomeForm({ t, onSubmit, onCancel }) {
  const [reasonCategory, setReasonCategory] = useState('');
  const [reasonText, setReasonText] = useState('');
  return (
    <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-elevated)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select
        value={reasonCategory}
        onChange={(e) => setReasonCategory(e.target.value)}
        style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
      >
        <option value="">{t('churn.reasonPrompt')}</option>
        {REASON_CATEGORIES.map(r => (
          <option key={r} value={r}>{t(`churn.reason${r.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}`)}</option>
        ))}
      </select>
      <input
        type="text"
        placeholder={t('churn.reasonPrompt')}
        value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => onSubmit({ reasonCategory: reasonCategory || undefined, reasonText: reasonText || undefined })}>
          {t('churn.outcomeSaved')}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }} onClick={onCancel}>×</button>
      </div>
    </div>
  );
}

export default function ChurnPage() {
  const t = useT();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [churnSummary, setChurnSummary] = useState(null);
  const [scoringChurn, setScoringChurn] = useState(false);
  const [openForm, setOpenForm] = useState(null); // { opportunityId, outcomeType }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [oppsData, summary] = await Promise.all([
        request('/dashboard/opportunities?limit=500').catch(() => ({ opportunities: [] })),
        getChurnSummary().catch(() => null),
      ]);
      const all = oppsData.opportunities || [];
      // "Clients à risque de churn" is a retention concept — it only applies to won clients,
      // never to still-active deals (churn_score is computed for every status internally, but
      // this page must not mix the deal/client approaches: an active deal isn't a client yet).
      setClients(all.filter(c => c.status === 'won' && c.churn_score != null).sort((a, b) => (b.churn_score || 0) - (a.churn_score || 0)));
      setChurnSummary(summary);
    } catch {
      setClients([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRescore = async () => {
    setScoringChurn(true);
    try {
      await runChurnScoring();
      await loadData();
    } catch {
      showToast({ type: 'error', title: t('clients.error'), message: t('clients.churnScoringError') });
    }
    setScoringChurn(false);
  };

  const submitOutcome = async (opportunityId, outcomeType, extra) => {
    try {
      await request('/churn/outcomes', {
        method: 'POST',
        body: JSON.stringify({ opportunityId, outcomeType, ...extra }),
      });
      showToast({ type: 'success', title: t('churn.outcomeSaved'), message: '' });
      setOpenForm(null);
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('churn.outcomeSaveError'), message: err.message });
    }
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('churn.title')}</h1>
          <div className="page-subtitle">{t('churn.subtitle')}</div>
        </div>
        <button className="btn btn-outline" style={{ fontSize: 11, padding: '8px 14px' }} disabled={scoringChurn} onClick={handleRescore}>
          {scoringChurn ? t('clients.scoring') : t('clients.rescore')}
        </button>
      </div>

      {churnSummary && churnSummary.scored > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {[
            { label: t('clients.critical'), count: churnSummary.critical, color: 'var(--danger)' },
            { label: t('clients.high'), count: churnSummary.high, color: 'var(--warning)' },
            { label: t('clients.medium'), count: churnSummary.medium, color: '#D97706' },
            { label: t('clients.low'), count: churnSummary.low, color: 'var(--success)' },
          ].map(b => (
            <div key={b.label} style={{
              flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderLeft: `3px solid ${b.color}`, borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: b.color }}>{b.count}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.label}</div>
            </div>
          ))}
          <div style={{
            flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{churnSummary.avgScore}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>/100</span></div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('clients.avgScore')}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>
      ) : clients.length === 0 ? (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t('clients.churnPrediction')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('clients.churnPredictionDesc')}</div>
          </div>
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }} disabled={scoringChurn} onClick={handleRescore}>
            {scoringChurn ? t('clients.scoring') : t('clients.runChurnScoring')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clients.map(client => {
            const flagged = (client.churn_score || 0) >= 50;
            const color = client.churn_score >= 76 ? 'var(--danger)' : client.churn_score >= 51 ? 'var(--warning)' : client.churn_score >= 26 ? '#D97706' : 'var(--success)';
            return (
              <div key={client.id} className="card">
                <div className="card-body" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name || client.company || client.email}</div>
                      {client.company && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{client.company}</div>}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color }}>
                      {client.churn_score}<span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>/100</span>
                    </span>
                  </div>

                  {client.churn_factors && client.churn_factors.length > 0 && (
                    <div style={{
                      background: flagged ? 'rgba(220,38,38,0.04)' : 'var(--bg-elevated)',
                      border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginTop: 10,
                    }}>
                      {client.churn_factors.map((f, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{f.detail}</span>
                          <span style={{ fontWeight: 600, color: f.weight >= 15 ? 'var(--danger)' : 'var(--warning)' }}>
                            {f.weight >= 0 ? '+' : ''}{f.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    {flagged ? (
                      <>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
                          onClick={() => setOpenForm({ opportunityId: client.id, outcomeType: 'true_positive' })}>
                          {t('churn.markChurned')}
                        </button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }}
                          onClick={() => setOpenForm({ opportunityId: client.id, outcomeType: 'false_positive' })}>
                          {t('churn.markStillClient')}
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px', color: 'var(--text-muted)' }}
                        onClick={() => setOpenForm({ opportunityId: client.id, outcomeType: 'false_negative' })}>
                        {t('churn.markMissedChurn')}
                      </button>
                    )}
                  </div>

                  {openForm?.opportunityId === client.id && (
                    <OutcomeForm
                      t={t}
                      onCancel={() => setOpenForm(null)}
                      onSubmit={(extra) => submitOutcome(client.id, openForm.outcomeType, extra)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
