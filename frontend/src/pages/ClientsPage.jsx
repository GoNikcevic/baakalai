/* ===============================================================================
   BAKAL — Clients Page
   Import contacts from CRM, view pipeline stages, manage client relationships.
   Click a client to open detail panel with timeline + emails + actions.
   =============================================================================== */

import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { request, runChurnScoring, getChurnSummary } from '../services/api-client';
import { showToast } from '../services/notifications';
import { getUser } from '../services/auth';
import { useT, useI18n } from '../i18n';

const STAGE_COLORS = [
  'var(--text-muted)', 'var(--blue)', 'var(--accent)',
  'var(--warning)', 'var(--purple)', 'var(--success)',
];

const STATUS_COLORS = {
  new: 'var(--text-muted)', imported: 'var(--blue)', interested: 'var(--accent)',
  meeting: 'var(--warning)', negotiation: 'var(--purple)', won: 'var(--success)', lost: 'var(--danger)',
};
function getStatusLabels(lang) {
  if (lang === 'en') return { new: 'New', imported: 'Imported', interested: 'Interested', meeting: 'Meeting', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
  return { new: 'Nouveau', imported: 'Import\u00e9', interested: 'Int\u00e9ress\u00e9', meeting: 'RDV', negotiation: 'N\u00e9go', won: 'Gagn\u00e9', lost: 'Perdu' };
}

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [stages, setStages] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [connectedCrm, setConnectedCrm] = useState(null);
  const [churnSummary, setChurnSummary] = useState(null);
  const [scoringChurn, setScoringChurn] = useState(false);
  const [owners, setOwners] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const t = useT();
  const { lang } = useI18n();
  const STATUS_LABELS = getStatusLabels(lang);
  const user = getUser();
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Parallel: providers + opportunities + churn + owners
      const [providersData, oppsData, churnData, ownersData] = await Promise.all([
        request('/crm/providers').catch(() => ({ providers: [] })),
        request('/dashboard/opportunities').catch(() => ({ opportunities: [] })),
        getChurnSummary().catch(() => null),
        request('/crm/team-owners').catch(() => ({ owners: [] })),
      ]);

      const crmProviders = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];
      const connected = (providersData.providers || []).find(p => crmProviders.includes(p.provider) && p.connected);
      setConnectedCrm(connected?.provider || null);
      setClients(oppsData.opportunities || []);
      if (churnData) setChurnSummary(churnData);
      setOwners(ownersData.owners || []);

      // Load pipeline stages (depends on detected provider)
      if (connected?.provider === 'pipedrive') {
        const pipelinesData = await request('/crm/pipedrive/pipelines').catch(() => ({ pipelines: [] }));
        if (pipelinesData.pipelines?.length > 0) {
          const stagesData = await request(`/crm/pipedrive/stages/${pipelinesData.pipelines[0].id}`).catch(() => ({ stages: [] }));
          setStages(stagesData.stages || []);
        }
      } else if (connected?.provider === 'odoo') {
        const stagesData = await request('/crm/odoo/stages').catch(() => ({ stages: [] }));
        setStages(stagesData.stages || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const crmLabel = connectedCrm
    ? connectedCrm.charAt(0).toUpperCase() + connectedCrm.slice(1)
    : 'CRM';

  const handleImport = useCallback(async () => {
    if (!connectedCrm) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await request(`/crm/import/${connectedCrm}`, { method: 'POST' });
      setImportResult(result);
      await loadData();
    } catch (err) {
      setImportResult({ error: err.message });
    }
    setImporting(false);
  }, [loadData, connectedCrm]);

  const filtered = useMemo(() => clients.filter(c => {
    if (filter === 'churn_risk' && (c.churn_score == null || c.churn_score < 50)) return false;
    else if (filter !== 'all' && filter !== 'churn_risk' && c.status !== filter) return false;
    if (ownerFilter !== 'all' && c.owner_id !== ownerFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.name || '').toLowerCase().includes(q)
        || (c.company || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => {
    if (filter === 'churn_risk') return (b.churn_score || 0) - (a.churn_score || 0);
    return 0;
  }), [clients, filter, ownerFilter, search]);

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const c of clients) counts[c.status || 'unknown'] = (counts[c.status || 'unknown'] || 0) + 1;
    return counts;
  }, [clients]);

  const statusTabs = [
    { key: 'all', label: t('clients.all'), count: clients.length },
    { key: 'imported', label: STATUS_LABELS.imported, count: statusCounts.imported || 0 },
    { key: 'new', label: STATUS_LABELS.new, count: statusCounts.new || 0 },
    { key: 'interested', label: STATUS_LABELS.interested, count: statusCounts.interested || 0 },
    { key: 'meeting', label: STATUS_LABELS.meeting, count: statusCounts.meeting || 0 },
    { key: 'won', label: lang === 'en' ? 'Won' : 'Gagn\u00e9s', count: statusCounts.won || 0 },
    { key: 'churn_risk', label: lang === 'en' ? 'Churn risk' : 'Risque churn', count: clients.filter(c => c.churn_score >= 50).length },
  ].filter(t => t.key === 'all' || t.count > 0);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('clients.title')}</h1>
          <div className="page-subtitle">
            {t('clients.contactsInCrm', { count: clients.length })}
          </div>
        </div>
        {isAdmin && (connectedCrm ? (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? `\u23F3 ${t('clients.importing')}` : t('clients.importFrom', { crm: crmLabel })}
          </button>
        ) : (
          <button
            className="btn btn-outline"
            style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={() => window.location.href = '/settings'}
          >
            {t('clients.connectCrm')}
          </button>
        ))}
      </div>

      {importResult && (
        <div style={{
          background: importResult.error ? 'var(--danger-bg)' : 'rgba(0, 214, 143, 0.1)',
          border: `1px solid ${importResult.error ? 'rgba(255,107,107,0.3)' : 'rgba(0, 214, 143, 0.3)'}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12,
          color: importResult.error ? 'var(--danger)' : 'var(--success)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            {importResult.error
              ? `Erreur : ${importResult.error}`
              : `${importResult.imported} import\u00e9(s), ${importResult.skipped} d\u00e9j\u00e0 pr\u00e9sent(s)`}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setImportResult(null)}>{'\u2715'}</button>
        </div>
      )}

      {/* Churn risk summary */}
      {churnSummary && churnSummary.scored > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {[
            { label: lang === 'en' ? 'Critical' : 'Critique', count: churnSummary.critical, color: 'var(--danger)' },
            { label: lang === 'en' ? 'High' : 'Haut', count: churnSummary.high, color: 'var(--warning)' },
            { label: lang === 'en' ? 'Medium' : 'Moyen', count: churnSummary.medium, color: '#D97706' },
            { label: lang === 'en' ? 'Low' : 'Bas', count: churnSummary.low, color: 'var(--success)' },
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
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{churnSummary.avgScore}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lang === 'en' ? 'Avg score' : 'Score moyen'}</div>
          </div>
          <button
            className="btn btn-outline"
            style={{ fontSize: 11, padding: '8px 14px', alignSelf: 'center' }}
            disabled={scoringChurn}
            onClick={async () => {
              setScoringChurn(true);
              try {
                await runChurnScoring();
                const summary = await getChurnSummary();
                setChurnSummary(summary);
                await loadData();
              } catch { showToast({ type: 'error', title: 'Erreur', message: 'Churn scoring failed' }); }
              setScoringChurn(false);
            }}
          >
            {scoringChurn ? (lang === 'en' ? 'Scoring...' : 'Calcul...') : (lang === 'en' ? 'Rescore' : 'Recalculer')}
          </button>
        </div>
      )}

      {!churnSummary || churnSummary.scored === 0 ? (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{lang === 'en' ? 'Churn Prediction' : 'Pr\u00e9diction de churn'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {lang === 'en' ? 'Score your contacts to detect churn risk' : 'Scorez vos contacts pour d\u00e9tecter les risques de churn'}
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '8px 16px' }}
            disabled={scoringChurn}
            onClick={async () => {
              setScoringChurn(true);
              try {
                await runChurnScoring();
                const summary = await getChurnSummary();
                setChurnSummary(summary);
                await loadData();
              } catch { showToast({ type: 'error', title: 'Erreur', message: 'Churn scoring failed' }); }
              setScoringChurn(false);
            }}
          >
            {scoringChurn ? (lang === 'en' ? 'Scoring...' : 'Calcul...') : (lang === 'en' ? 'Run churn scoring' : 'Lancer le scoring churn')}
          </button>
        </div>
      ) : null}

      {/* Pipeline stages */}
      {stages.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', padding: '4px 0' }}>
          {stages.map((stage, i) => (
            <div key={stage.id} style={{
              flex: '1 0 120px', background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderTop: `3px solid ${STAGE_COLORS[i % STAGE_COLORS.length]}`, borderRadius: 10,
              padding: '12px 14px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{stage.name}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: STAGE_COLORS[i % STAGE_COLORS.length] }}>
                {clients.filter(c => c.crm_stage === stage.id || c.status === stage.name?.toLowerCase()).length}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="text" placeholder={lang === 'en' ? 'Search...' : 'Rechercher...'} value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 14px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
        {isAdmin && owners.length > 1 && (
          <select
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)',
              borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
            }}
          >
            <option value="all">{lang === 'en' ? 'All reps' : 'Tous les commerciaux'}</option>
            {owners.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({o.contact_count})</option>
            ))}
          </select>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          {statusTabs.map(tab => (
            <button key={tab.key} onClick={() => setFilter(tab.key)} style={{
              padding: '6px 12px', border: `1px solid ${filter === tab.key ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === tab.key ? 'rgba(99,102,241,0.1)' : 'transparent', borderRadius: 8,
              fontSize: 11, color: filter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: filter === tab.key ? 600 : 400, whiteSpace: 'nowrap',
            }}>
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Main content: list + detail panel */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Client list */}
        <div style={{ flex: selectedClient ? '0 0 55%' : '1 1 100%', transition: 'flex 0.2s' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 50, background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{'\uD83D\uDC65'}</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {clients.length === 0 ? t('clients.noClients') : t('clients.noResults')}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map(c => {
                const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
                const isSelected = selectedClient?.id === c.id;
                return (
                  <div key={c.id} onClick={() => setSelectedClient(c)} style={{
                    display: 'grid', gridTemplateColumns: selectedClient ? '2fr 1fr 80px' : (owners.length > 1 ? '2fr 1fr 0.8fr 60px 80px 80px' : '2fr 1.2fr 1fr 60px 80px'),
                    padding: '10px 14px', background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{c.name || '\u2014'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title || c.email || ''}</div>
                    </div>
                    {!selectedClient && <div style={{ color: 'var(--text-secondary)' }}>{c.company || '\u2014'}</div>}
                    {!selectedClient && (
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${color}15`, color, fontWeight: 600, width: 'fit-content' }}>
                        {STATUS_LABELS[c.status] || c.status || '\u2014'}
                      </span>
                    )}
                    {!selectedClient && owners.length > 1 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.owner_email ? c.owner_email.split('@')[0] : '\u2014'}
                      </div>
                    )}
                    {!selectedClient && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.churn_score != null ? (
                          <>
                            <div style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: c.churn_score >= 76 ? 'var(--danger)' : c.churn_score >= 51 ? 'var(--warning)' : c.churn_score >= 26 ? '#D97706' : 'var(--success)',
                            }} />
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: c.churn_score >= 76 ? 'var(--danger)' : c.churn_score >= 51 ? 'var(--warning)' : c.churn_score >= 26 ? '#D97706' : 'var(--success)',
                            }}>
                              {c.churn_score}
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{'\u2014'}</span>
                        )}
                      </div>
                    )}
                    <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: `${color}15`, color, fontWeight: 600 }}>
                      {STATUS_LABELS[c.status] || '\u2014'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedClient && (
          <ClientDetailPanel client={selectedClient} onClose={() => setSelectedClient(null)} />
        )}
      </div>
    </div>
  );
}

/* ═══ Client Detail Panel ═══ */

function ClientDetailPanel({ client, onClose }) {
  const t = useT();
  const { lang } = useI18n();
  const STATUS_LABELS = getStatusLabels(lang);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setLoading(true);
    request(`/crm/client/${client.id}`)
      .then(data => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [client.id]);

  const handleQuickEmail = async () => {
    const subject = prompt('Objet de l\'email :');
    if (!subject) return;
    const body = prompt('Message :');
    if (!body) return;
    setSending(true);
    try {
      await request('/nurture/send', {
        method: 'POST',
        body: JSON.stringify({ to: client.email, toName: client.name, subject, body, opportunityId: client.id }),
      });
      alert('Email envoy\u00e9 !');
      // Reload detail
      const data = await request(`/crm/client/${client.id}`);
      setDetail(data);
    } catch (err) {
      alert('Erreur : ' + err.message);
    }
    setSending(false);
  };

  const color = STATUS_COLORS[client.status] || 'var(--text-muted)';
  const emails = detail?.emails || [];
  const activities = detail?.crmActivities || [];

  return (
    <div style={{
      flex: '0 0 44%', background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 20, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{client.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            {client.title && <span>{client.title}</span>}
            {client.company && <span>{client.title ? ' @ ' : ''}{client.company}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{client.email}</div>
        </div>
        <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 14, padding: '4px 8px' }}>{'\u2715'}</button>
      </div>

      {/* Status + Score */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <span style={{
          fontSize: 12, padding: '4px 14px', borderRadius: 8,
          background: `${color}15`, color, fontWeight: 600,
        }}>
          {STATUS_LABELS[client.status] || client.status}
        </span>
        {client.score != null && (
          <span style={{
            fontSize: 12, padding: '4px 14px', borderRadius: 8,
            background: 'var(--bg-elevated)', fontWeight: 700,
            color: client.score >= 70 ? 'var(--success)' : client.score >= 40 ? 'var(--warning)' : 'var(--text-muted)',
          }}>
            Score : {client.score}/100
          </span>
        )}
        {client.churn_score != null && (
          <span style={{
            fontSize: 12, padding: '4px 14px', borderRadius: 8,
            background: client.churn_score >= 76 ? 'var(--danger-soft)' : client.churn_score >= 51 ? 'var(--warning-soft)' : client.churn_score >= 26 ? '#FEF3C7' : 'var(--success-soft)',
            color: client.churn_score >= 76 ? 'var(--danger)' : client.churn_score >= 51 ? 'var(--warning)' : client.churn_score >= 26 ? '#D97706' : 'var(--success)',
            fontWeight: 700,
          }}>
            Churn : {client.churn_score}/100
          </span>
        )}
        {client.owner_email && (
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-muted)',
          }}>
            {lang === 'en' ? 'Owner' : 'Commercial'}: {client.owner_email.split('@')[0]}
          </span>
        )}
        {client.crm_provider && (
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-muted)', textTransform: 'capitalize',
          }}>
            {client.crm_provider}
          </span>
        )}
      </div>

      {/* Churn factors */}
      {client.churn_factors && client.churn_factors.length > 0 && (
        <div style={{
          background: client.churn_score >= 50 ? 'rgba(220,38,38,0.04)' : 'var(--bg-elevated)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
            {lang === 'en' ? 'Churn risk factors' : 'Facteurs de risque churn'}
          </div>
          {client.churn_factors.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{f.detail}</span>
              <span style={{ fontWeight: 600, color: f.weight >= 15 ? 'var(--danger)' : 'var(--warning)' }}>+{f.weight}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 11, padding: '6px 14px' }}
          onClick={handleQuickEmail}
          disabled={sending || !client.email}
        >
          {sending ? '\u23F3...' : `\u2709\uFE0F ${t('clients.sendEmail')}`}
        </button>
        {client.linkedin_url && (
          <a href={client.linkedin_url} target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 14px', textDecoration: 'none' }}>
            LinkedIn
          </a>
        )}
      </div>

      {/* Product lines */}
      <ProductLineTags clientId={client.id} lang={lang} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Timeline */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {/* Nurture emails */}
            {emails.map(e => (
              <div key={e.id} style={{
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                borderLeft: `3px solid ${e.status === 'sent' ? 'var(--success)' : e.status === 'pending' ? 'var(--warning)' : 'var(--text-muted)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{'\u2709\uFE0F'} Email {e.status === 'sent' ? 'envoy\u00e9' : e.status === 'pending' ? 'en attente' : e.status}</span>
                  <span>{new Date(e.sent_at || e.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{e.subject}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, maxHeight: 40, overflow: 'hidden' }}>{e.body}</div>
              </div>
            ))}

            {/* CRM activities */}
            {activities.map(a => (
              <div key={a.id} style={{
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                borderLeft: '3px solid var(--blue)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{a.type === 'call' ? '\uD83D\uDCDE' : a.type === 'meeting' ? '\uD83D\uDCC5' : '\uD83D\uDCCB'} {a.type} {a.done ? '\u2705' : ''}</span>
                  <span>{a.dueDate}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{a.subject}</div>
                {a.note && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, maxHeight: 40, overflow: 'hidden' }}>{a.note}</div>}
              </div>
            ))}

            {emails.length === 0 && activities.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
                {t('clients.noActivity')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══ Product Line Tags ═══ */

function ProductLineTags({ clientId, lang }) {
  const en = lang === 'en';
  const [allLines, setAllLines] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    request('/crm/product-lines').then(d => {
      setAllLines(d.productLines || []);
    }).catch(() => {});
    // Load assigned product lines for this client
    request(`/crm/client/${clientId}/product-lines`).then(d => {
      setAssigned(d.productLines || []);
    }).catch(() => setAssigned([]));
  }, [clientId]);

  const handleAssign = async (plId) => {
    try {
      await request(`/crm/product-lines/${plId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [clientId] }),
      });
      setAssigned(prev => [...prev, allLines.find(l => l.id === plId)].filter(Boolean));
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Failed to assign product line' }); }
  };

  const handleRemove = async (plId) => {
    try {
      await request(`/crm/product-lines/${plId}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [clientId] }),
      });
      setAssigned(prev => prev.filter(p => p.id !== plId));
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Failed to remove product line' }); }
  };

  if (allLines.length === 0) return null;

  const assignedIds = new Set(assigned.map(a => a.id));
  const available = allLines.filter(l => !assignedIds.has(l.id));

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        {en ? 'Product lines' : 'Lignes de produits'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {assigned.map(pl => (
          <span key={pl.id} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 12,
            background: 'rgba(110,87,250,0.1)', color: 'var(--accent)',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {pl.icon || '\uD83D\uDCE6'} {pl.name}
            <button onClick={() => handleRemove(pl.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 10, padding: 0, marginLeft: 2,
            }}>{'\u2715'}</button>
          </span>
        ))}
        {available.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 12,
                border: '1px dashed var(--border)', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              + {en ? 'Add' : 'Ajouter'}
            </button>
            {showPicker && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 6, minWidth: 160, marginTop: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                {available.map(pl => (
                  <div key={pl.id} onClick={() => { handleAssign(pl.id); setShowPicker(false); }} style={{
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                    borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>{pl.icon || '\uD83D\uDCE6'}</span> {pl.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
