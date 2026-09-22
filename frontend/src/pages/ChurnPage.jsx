/* ===============================================================================
   BAKAL · Churn Risk Page
   Explainable weighted churn score per client, extracted from ClientsPage's former
   churn block. Adds the outcome-marking feedback loop (true/false positive/negative).

   La page n'a longtemps rien su faire d'un client à risque : elle le nommait,
   expliquait le score, et s'arrêtait là. Deux actions la referment, les mêmes
   que les files Deals/Upsell : un workflow de rétention par client (goal
   churn_prevention, déjà porté par le Deal Coach) et un envoi groupé qui passe
   par le rédacteur de rétention, jamais par celui de l'upsell.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, runChurnScoring, getChurnSummary } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';
import { useConfirm } from '../components/ConfirmModal';
import ContactSubline from '../components/ContactSubline';

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

// Plafond de POST /nurture/run-scoped (SCOPED_RUN_MAX côté backend) : au-delà,
// la sélection part par tranches successives.
const SCOPED_RUN_MAX = 25;

// Seuil de signalement de la page (surlignage rouge, boutons d'issue, case de
// sélection groupée). NB : la file de priorités, le digest et la population
// churn_risk du backend retiennent 60 (lib/churn-scoring.AT_RISK_THRESHOLD).
const FLAG_THRESHOLD = 50;

export default function ChurnPage() {
  const t = useT();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [churnSummary, setChurnSummary] = useState(null);
  const [scoringChurn, setScoringChurn] = useState(false);
  const [openForm, setOpenForm] = useState(null); // { opportunityId, outcomeType }
  const [selected, setSelected] = useState(() => new Set());
  // null = pas d'envoi groupé en cours ; sinon { done, total }
  const [bulk, setBulk] = useState(null);
  // Workflows de rétention vivants (draft/active/paused), indexés par contact ·
  // même convention que les files Deals/Upsell.
  const [workflows, setWorkflows] = useState(() => new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [oppsData, summary] = await Promise.all([
        request('/dashboard/opportunities?limit=500').catch(() => ({ opportunities: [] })),
        getChurnSummary().catch(() => null),
      ]);
      const all = oppsData.opportunities || [];
      // "Clients à risque de churn" is a retention concept · it only applies to won clients,
      // never to still-active deals (churn_score is computed for every status internally, but
      // this page must not mix the deal/client approaches: an active deal isn't a client yet).
      setClients(all.filter(c => c.status === 'won' && c.churn_score != null).sort((a, b) => (b.churn_score || 0) - (a.churn_score || 0)));
      setChurnSummary(summary);
    } catch {
      setClients([]);
    }
    try {
      const data = await request('/enrollments');
      const map = new Map();
      for (const e of data.enrollments || []) {
        if (['draft', 'active', 'paused'].includes(e.status)) map.set(e.opportunity_id, e);
      }
      setWorkflows(map);
    } catch { /* la page reste utilisable sans l'état des workflows */ }
    setSelected(new Set()); // la liste a changé, une sélection sur l'ancienne n'a plus de sens
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

  // Un client sans email ne peut pas être relancé : il reste listé (le score et
  // ses facteurs valent d'être lus), mais il n'est pas sélectionnable, sinon le
  // backend le retournerait en « ignoré » à chaque envoi.
  const reachable = clients.filter(c => c.email);
  // La page liste tous les clients scorés, y compris ceux qui vont bien : la
  // case globale ne coche donc que les clients signalés (même seuil que le
  // surlignage de la liste), jamais toute la base. Un client sain reste
  // sélectionnable à la main.
  const atRisk = reachable.filter(c => (c.churn_score || 0) >= FLAG_THRESHOLD);
  const allAtRiskSelected = atRisk.length > 0 && atRisk.every(c => selected.has(c.id));

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAtRisk = () => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const c of atRisk) {
        if (allAtRiskSelected) next.delete(c.id); else next.add(c.id);
      }
      return next;
    });
  };

  // mode 'auto' = rédaction puis envoi immédiat ; 'approval' = brouillons
  // déposés dans Automatisations, onglet En attente.
  const handleBulkRun = async (mode) => {
    const ids = reachable.filter(c => selected.has(c.id)).map(c => c.id);
    if (!ids.length || bulk) return;
    const confirmKey = mode === 'auto' ? 'churn.bulkConfirmSend' : 'churn.bulkConfirmDraft';
    if (!await confirm(t(confirmKey, { count: ids.length }))) return;

    setBulk({ done: 0, total: ids.length });
    let sent = 0;
    let queued = 0;
    let skipped = 0;
    const failures = [];

    // Le backend traite au plus SCOPED_RUN_MAX contacts par appel, un appel IA
    // chacun : les tranches successives évitent qu'une sélection de 60 clients
    // n'en relance silencieusement que 25.
    for (let i = 0; i < ids.length; i += SCOPED_RUN_MAX) {
      const chunk = ids.slice(i, i + SCOPED_RUN_MAX);
      try {
        const result = await request('/nurture/run-scoped', {
          method: 'POST',
          body: JSON.stringify({
            // triggerType commande le rédacteur : churn_risk = rétention, pas upsell.
            triggerType: 'churn_risk',
            contactIds: chunk,
            limit: chunk.length,
            mode,
            source: 'churn_page',
          }),
        });
        sent += result.sent || 0;
        queued += result.queued || 0;
        skipped += result.skipped || 0;
        for (const s of result.skippedDetail || []) failures.push(`${s.name || ''}, ${s.reason}`);
      } catch (err) {
        failures.push(err.message);
        skipped += chunk.length;
      }
      setBulk({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
    }

    setBulk(null);
    const done = mode === 'auto' ? sent : queued;
    if (done === 0) {
      showToast({
        type: 'error',
        title: t('churn.bulkNone'),
        message: failures.slice(0, 3).join('\n'),
      });
    } else {
      showToast({
        type: skipped > 0 ? 'warning' : 'success',
        title: t(mode === 'auto' ? 'churn.bulkDone' : 'churn.bulkQueued', { sent, queued }),
        message: skipped > 0 ? t('churn.bulkSkipped', { skipped }) : '',
      });
    }
    await loadData();
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
          {reachable.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4, minHeight: 28 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: bulk || atRisk.length === 0 ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={allAtRiskSelected} onChange={toggleSelectAtRisk} disabled={!!bulk || atRisk.length === 0} />
                {t('churn.selectAtRisk', { count: atRisk.length })}
              </label>
              {bulk ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                  {t('churn.bulkRunning', { done: bulk.done, total: bulk.total })}
                </span>
              ) : selected.size > 0 && (
                <>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '4px 12px' }}
                    onClick={() => handleBulkRun('auto')}
                  >
                    {t('churn.bulkSend', { count: selected.size })}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 12px' }}
                    onClick={() => handleBulkRun('approval')}
                  >
                    {t('churn.bulkDraft', { count: selected.size })}
                  </button>
                </>
              )}
            </div>
          )}
          {clients.map(client => {
            const flagged = (client.churn_score || 0) >= FLAG_THRESHOLD;
            const color = client.churn_score >= 76 ? 'var(--danger)' : client.churn_score >= 51 ? 'var(--warning)' : client.churn_score >= 26 ? '#D97706' : 'var(--success)';
            return (
              <div key={client.id} className="card">
                <div className="card-body" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    {client.email ? (
                      <input
                        type="checkbox"
                        checked={selected.has(client.id)}
                        onChange={() => toggleSelect(client.id)}
                        disabled={!!bulk}
                        aria-label={t('churn.selectOne', { name: client.name || client.company || client.email })}
                        style={{ marginTop: 3, marginRight: 12, flexShrink: 0, cursor: bulk ? 'default' : 'pointer' }}
                      />
                    ) : (
                      <span style={{ width: 13, marginRight: 12, flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name || client.company || client.email}</div>
                      <ContactSubline contact={client} withEmail={false} />
                      {!client.email && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t('churn.noEmail')}</div>
                      )}
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
                          <span style={{ fontWeight: 600, color: f.weight < 0 ? 'var(--success)' : f.weight >= 15 ? 'var(--danger)' : 'var(--warning)' }}>
                            {f.weight >= 0 ? '+' : ''}{f.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Workflow de rétention : le Deal Coach porte déjà le goal
                        churn_prevention, seule la porte d'entrée manquait.
                        Un contact sans email ni LinkedIn n'a aucun canal · le
                        backend le refuse, autant ne pas l'ouvrir. */}
                    {(client.email || client.linkedin_url) && (() => {
                      const wf = workflows.get(client.id);
                      const live = wf?.status === 'active' || wf?.status === 'paused';
                      return (
                        <button
                          className={live ? 'btn btn-ghost' : 'btn btn-accent'}
                          style={live ? {
                            fontSize: 11, padding: '4px 12px', fontWeight: 700,
                            color: wf.status === 'active' ? 'var(--success)' : 'var(--text-secondary)',
                            border: `1px solid ${wf.status === 'active' ? 'var(--success)' : 'var(--border)'}`,
                          } : { fontSize: 11, padding: '4px 12px' }}
                          onClick={() => navigate(`/churn-risk/${client.id}/workflow`)}
                        >
                          {live
                            ? t(wf.status === 'active' ? 'workflow.badgeActive' : 'workflow.badgePaused', {
                                done: wf.done_steps ?? 0, total: wf.total_steps ?? 0,
                              })
                            : t(wf?.status === 'draft' ? 'workflow.resumeDraft' : 'workflow.propose')}
                        </button>
                      );
                    })()}
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
