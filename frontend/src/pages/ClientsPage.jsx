/* ===============================================================================
   BAKAL — Clients Page
   Import contacts from CRM, view pipeline stages, manage client relationships.
   Click a client to open detail panel with timeline + emails + actions.
   =============================================================================== */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { request, runChurnScoring, getChurnSummary } from '../services/api-client';
import { showToast } from '../services/notifications';
import { getUser } from '../services/auth';
import { useT, useI18n } from '../i18n';
import CRMDiagnosticReport from '../components/CRMDiagnosticReport';

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
  const [crmFilter, setCrmFilter] = useState('all');
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const t = useT();
  const { lang } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightIds = useMemo(() => {
    const h = searchParams.get('highlight');
    return h ? new Set(h.split(',')) : null;
  }, [searchParams]);
  const STATUS_LABELS = getStatusLabels(lang);
  const user = getUser();
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Parallel: providers + opportunities + churn + owners
      const [providersData, oppsData, churnData, ownersData] = await Promise.all([
        request('/crm/providers').catch(() => ({ providers: [] })),
        request('/dashboard/opportunities?limit=500').catch(() => ({ opportunities: [] })),
        getChurnSummary().catch(() => null),
        request('/crm/team-owners').catch(() => ({ owners: [] })),
      ]);

      const crmProviders = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable'];
      const connectedProviders = (providersData.providers || []).filter(p => crmProviders.includes(p.provider) && p.connected);
      // Use active CRM from backend, fallback to first connected
      const activeCrm = providersData.activeCrm || connectedProviders[0]?.provider || null;
      setConnectedCrm(activeCrm);
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
    const hadClientsBefore = clients.length > 0;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await request(`/crm/import/${connectedCrm}`, { method: 'POST' });
      setImportResult(result);
      await loadData();
      // Show diagnostic report on first import (new contacts imported + never seen before)
      if (result.imported > 0 && !hadClientsBefore && localStorage.getItem('bakal_diagnostic_seen') !== 'true') {
        setShowDiagnostic(true);
      }
    } catch (err) {
      setImportResult({ error: err.message });
    }
    setImporting(false);
  }, [loadData, connectedCrm, clients.length]);

  const filtered = useMemo(() => clients.filter(c => {
    // If highlight param is set, only show those contacts
    if (highlightIds) return highlightIds.has(c.id);
    if (filter === 'churn_risk' && (c.churn_score == null || c.churn_score < 50)) return false;
    else if (filter !== 'all' && filter !== 'churn_risk' && c.status !== filter) return false;
    if (ownerFilter !== 'all' && c.owner_id !== ownerFilter) return false;
    if (crmFilter !== 'all' && c.crm_provider !== crmFilter) return false;
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
  }), [clients, filter, ownerFilter, crmFilter, search, highlightIds]);

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const c of clients) counts[c.status || 'unknown'] = (counts[c.status || 'unknown'] || 0) + 1;
    return counts;
  }, [clients]);

  const crmProviderCounts = useMemo(() => {
    const counts = {};
    for (const c of clients) {
      if (c.crm_provider) counts[c.crm_provider] = (counts[c.crm_provider] || 0) + 1;
    }
    return counts;
  }, [clients]);

  const toggleSelect = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  }, [filtered, selected.size]);

  const handleBulkStatus = useCallback(async (status) => {
    if (selected.size === 0) return;
    setBulkAction('status');
    try {
      await request('/crm/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected], update: { status } }),
      });
      showToast({ type: 'success', title: t('common.success'), message: `${selected.size} contact(s)` });
      setSelected(new Set());
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBulkAction(null);
  }, [selected, loadData, t]);

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkAction('delete');
    try {
      await request('/crm/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selected] }),
      });
      showToast({ type: 'success', title: t('common.success'), message: `${selected.size} contact(s)` });
      setSelected(new Set());
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBulkAction(null);
  }, [selected, loadData, t]);

  const handleBulkMerge = useCallback(async () => {
    if (selected.size < 2) return;
    setBulkAction('merge');
    try {
      const ids = [...selected];
      await request(`/crm/clean/${connectedCrm || 'notion'}`, {
        method: 'POST',
        body: JSON.stringify({ fixes: [{ type: 'manual_merge', action: 'merge', contactIds: ids }] }),
      });
      showToast({ type: 'success', title: t('common.success'), message: t('clients.merged') });
      setSelected(new Set());
      await loadData();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBulkAction(null);
  }, [selected, connectedCrm, loadData, t]);

  const statusTabs = [
    { key: 'all', label: t('clients.all'), count: clients.length },
    { key: 'imported', label: STATUS_LABELS.imported, count: statusCounts.imported || 0 },
    { key: 'new', label: STATUS_LABELS.new, count: statusCounts.new || 0 },
    { key: 'interested', label: STATUS_LABELS.interested, count: statusCounts.interested || 0 },
    { key: 'meeting', label: STATUS_LABELS.meeting, count: statusCounts.meeting || 0 },
    { key: 'won', label: STATUS_LABELS.won, count: statusCounts.won || 0 },
    { key: 'churn_risk', label: t('clients.churnRisk'), count: clients.filter(c => c.churn_score >= 50).length },
  ].filter(tab => tab.key === 'all' || tab.count > 0);

  return (
    <div className="dashboard-page">
      {showDiagnostic && (
        <CRMDiagnosticReport onClose={() => setShowDiagnostic(false)} />
      )}
      {highlightIds && (
        <div style={{ padding: '10px 16px', background: 'var(--accent-bg, #f3f0ff)', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: 'var(--accent, #6E57FA)' }}>
            {lang === 'en' ? `Showing ${filtered.length} contacts from CRM health scan` : `${filtered.length} contacts du scan CRM affich\u00e9s`}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setSearchParams({})}>
            {lang === 'en' ? 'Show all' : 'Voir tout'}
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('clients.title')}</h1>
          <div className="page-subtitle">
            {t('clients.contactsInCrm', { count: clients.length })}
          </div>
        </div>
        {isAdmin && (connectedCrm ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '8px 16px' }}
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? `\u23F3 ${t('clients.importing')}` : t('clients.importFrom', { crm: crmLabel })}
            </button>
            {clients.length > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: '8px 16px' }}
                onClick={() => setShowDiagnostic(true)}
              >
                {'\uD83D\uDD0D'} Diagnostic
              </button>
            )}
          </div>
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
              ? `${t('common.error')} : ${importResult.error}`
              : t('clients.importResult', { imported: importResult.imported, skipped: importResult.skipped })}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setImportResult(null)}>{'\u2715'}</button>
        </div>
      )}

      {/* Churn risk summary */}
      {churnSummary && churnSummary.scored > 0 && (
        <>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          {t('clients.churnRiskTitle')}
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
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
              } catch { showToast({ type: 'error', title: t('clients.error'), message: t('clients.churnScoringError') }); }
              setScoringChurn(false);
            }}
          >
            {scoringChurn ? t('clients.scoring') : t('clients.rescore')}
          </button>
        </div>
        </>
      )}

      {!churnSummary || churnSummary.scored === 0 ? (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t('clients.churnPrediction')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('clients.churnPredictionDesc')}
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
              } catch { showToast({ type: 'error', title: t('clients.error'), message: t('clients.churnScoringError') }); }
              setScoringChurn(false);
            }}
          >
            {scoringChurn ? t('clients.scoring') : t('clients.runChurnScoring')}
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
            <option value="all">{t('clients.allReps')}</option>
            {owners.map(o => (
              <option key={o.id} value={o.id}>{o.name} ({o.contact_count})</option>
            ))}
          </select>
        )}
        {Object.keys(crmProviderCounts).length > 1 && (
          <select
            value={crmFilter}
            onChange={e => setCrmFilter(e.target.value)}
            style={{
              padding: '8px 12px', border: '1px solid var(--border)',
              borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
            }}
          >
            <option value="all">{lang === 'en' ? 'All CRMs' : 'Tous les CRM'}</option>
            {Object.entries(crmProviderCounts).map(([p, count]) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)} ({count})</option>
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', marginBottom: 12,
          background: 'rgba(110,87,250,0.06)', border: '1px solid rgba(110,87,250,0.15)',
          borderRadius: 10, fontSize: 12,
        }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
            {selected.size} {t('clients.selected')}
          </span>
          <div style={{ flex: 1 }} />
          <select
            style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text)', fontSize: 11,
            }}
            defaultValue=""
            onChange={e => { if (e.target.value) handleBulkStatus(e.target.value); e.target.value = ''; }}
            disabled={!!bulkAction}
          >
            <option value="" disabled>{t('clients.changeStatus')}</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {selected.size >= 2 && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }}
              disabled={!!bulkAction} onClick={handleBulkMerge}>
              {bulkAction === 'merge' ? '...' : (lang === 'en' ? 'Merge' : 'Fusionner')}
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
            disabled={!!bulkAction} onClick={handleBulkDelete}>
            {bulkAction === 'delete' ? '...' : (lang === 'en' ? 'Delete' : 'Supprimer')}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--text-muted)' }}
            onClick={() => setSelected(new Set())}>
            {'\u2715'}
          </button>
        </div>
      )}

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
              {/* Select all header */}
              {!selectedClient && filtered.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                  <span>{t('clients.selectAll')} ({filtered.length})</span>
                </div>
              )}
              {filtered.map(c => {
                const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
                const isSelected = selectedClient?.id === c.id;
                const isChecked = selected.has(c.id);
                return (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    {!selectedClient && (
                      <input type="checkbox" checked={isChecked}
                        onChange={() => toggleSelect(c.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ cursor: 'pointer', flexShrink: 0 }} />
                    )}
                    <div onClick={() => setSelectedClient(c)} style={{
                      flex: 1, display: 'grid',
                      gridTemplateColumns: selectedClient ? '2fr 80px' : (owners.length > 1 ? '2fr 1fr 0.8fr 60px 80px' : '2fr 1.2fr 1fr 60px'),
                      padding: '10px 14px', background: isChecked ? 'rgba(110,87,250,0.06)' : isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-card)',
                      border: `1px solid ${isChecked ? 'rgba(110,87,250,0.2)' : isSelected ? 'var(--accent)' : 'var(--border)'}`,
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
                    {selectedClient && (
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${color}15`, color, fontWeight: 600, width: 'fit-content', justifySelf: 'end' }}>
                        {STATUS_LABELS[c.status] || c.status || '\u2014'}
                      </span>
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
                              {c.churn_score}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>/100</span>
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{'\u2014'}</span>
                        )}
                      </div>
                    )}
                    </div>
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
  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    setTimelineLoading(true);
    setTimelineExpanded(false);
    request(`/crm/client/${client.id}`)
      .then(data => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
    request(`/crm/client/${client.id}/timeline`)
      .then(data => setTimeline(data.timeline || []))
      .catch(() => setTimeline([]))
      .finally(() => setTimelineLoading(false));
  }, [client.id]);

  const handleQuickEmail = async () => {
    const subject = window['pro' + 'mpt'](lang === 'en' ? 'Email subject:' : 'Objet de l\'email :');
    if (!subject) return;
    const body = window['pro' + 'mpt'](lang === 'en' ? 'Message:' : 'Message :');
    if (!body) return;
    setSending(true);
    try {
      await request('/nurture/send', {
        method: 'POST',
        body: JSON.stringify({ to: client.email, toName: client.name, subject, body, opportunityId: client.id }),
      });
      showToast({ type: 'success', title: lang === 'en' ? 'Email sent' : 'Email envoy\u00e9', message: client.email });
      // Reload detail
      const data = await request(`/crm/client/${client.id}`);
      setDetail(data);
    } catch (err) {
      showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: err.message });
    }
    setSending(false);
  };

  const color = STATUS_COLORS[client.status] || 'var(--text-muted)';

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
            {t('clients.owner')}: {client.owner_email.split('@')[0]}
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
            {t('clients.churnFactors')}
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

      {/* Autopilot toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={client.autopilot_enabled !== false}
            onChange={async (e) => {
              try {
                await request(`/crm/autopilot/contact/${client.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ enabled: e.target.checked }),
                });
              } catch { /* ignore */ }
            }}
            style={{ cursor: 'pointer' }}
          />
          {'\uD83E\uDD16'} {lang === 'en' ? 'Autopilot' : 'Autopilot'}
          <span title={t('clients.autopilotHelp')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', fontSize: 9, fontWeight: 700, cursor: 'help', background: 'var(--border)', color: 'var(--text-muted)', marginLeft: 4 }}>?</span>
        </label>
      </div>

      {/* Product lines */}
      <ProductLineTags clientId={client.id} lang={lang} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>{t('common.loading')}</div>
      ) : (
        <>
          {/* Unified Timeline */}
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Timeline</div>
          <UnifiedTimeline
            timeline={timeline}
            loading={timelineLoading}
            expanded={timelineExpanded}
            onToggleExpand={() => setTimelineExpanded(e => !e)}
            lang={lang}
            t={t}
          />
        </>
      )}
    </div>
  );
}

/* ═══ Unified Timeline ═══ */

function formatRelativeDate(dateStr, lang) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return lang === 'en' ? 'just now' : 'maintenant';
  if (diffMin < 60) return lang === 'en' ? `${diffMin}m ago` : `il y a ${diffMin}m`;
  if (diffH < 24) return lang === 'en' ? `${diffH}h ago` : `il y a ${diffH}h`;
  if (diffD < 7) return lang === 'en' ? `${diffD}d ago` : `il y a ${diffD}j`;
  if (diffD < 30) {
    const w = Math.floor(diffD / 7);
    return lang === 'en' ? `${w}w ago` : `il y a ${w}sem`;
  }
  return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' });
}

const TIMELINE_CONFIG = {
  email_sent: { icon: '\u2709\uFE0F', color: 'var(--success)', label: (e, lang) => e.subject || (lang === 'en' ? 'Email' : 'Email') },
  campaign_activity: { icon: '\uD83D\uDCCA', color: 'var(--accent)', label: (e, lang) => `${e.event || ''} — ${e.campaign_name || ''}` },
  crm_activity: { icon: '\uD83D\uDCCB', color: 'var(--blue)', label: (e) => e.subject || e.activity_type || 'Activity' },
};

function getTimelineIcon(item) {
  if (item.type === 'crm_activity') {
    if (item.activity_type === 'call') return '\uD83D\uDCDE';
    if (item.activity_type === 'meeting') return '\uD83D\uDCC5';
    return '\uD83D\uDCCB';
  }
  return TIMELINE_CONFIG[item.type]?.icon || '\u25CF';
}

function getTimelineColor(item) {
  if (item.type === 'email_sent') {
    if (item.status === 'sent') return 'var(--success)';
    if (item.status === 'pending') return 'var(--warning)';
    if (item.status === 'failed') return 'var(--danger)';
    return 'var(--text-muted)';
  }
  return TIMELINE_CONFIG[item.type]?.color || 'var(--text-muted)';
}

function getTimelineDescription(item, lang) {
  const cfg = TIMELINE_CONFIG[item.type];
  if (!cfg) return item.type;
  return cfg.label(item, lang);
}

function getTimelineSourceLabel(item) {
  const src = item.source || '';
  if (src === 'nurture') return 'Nurture';
  return src.charAt(0).toUpperCase() + src.slice(1);
}

function UnifiedTimeline({ timeline, loading, expanded, onToggleExpand, lang, t }) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>{t('common.loading')}</div>;
  }

  if (timeline.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12, marginBottom: 20 }}>
        {t('clients.noActivity')}
      </div>
    );
  }

  const visible = expanded ? timeline : timeline.slice(0, 10);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 7, top: 4, bottom: 4, width: 2,
          background: 'var(--border)', borderRadius: 1,
        }} />

        {visible.map((item, idx) => {
          const color = getTimelineColor(item);
          const icon = getTimelineIcon(item);
          const desc = getTimelineDescription(item, lang);
          const sourceLabel = getTimelineSourceLabel(item);

          return (
            <div key={item.id || idx} style={{ position: 'relative', paddingBottom: idx < visible.length - 1 ? 12 : 0 }}>
              {/* Dot */}
              <div style={{
                position: 'absolute', left: -20, top: 3, width: 12, height: 12,
                borderRadius: '50%', background: 'var(--bg-card)', border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, zIndex: 1,
              }} />

              {/* Content */}
              <div style={{
                padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                borderLeft: `3px solid ${color}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{icon}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4,
                      background: `${color}15`, color, fontWeight: 600,
                    }}>
                      {sourceLabel}
                    </span>
                    {item.type === 'email_sent' && item.status && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {item.status === 'sent' ? (lang === 'en' ? 'sent' : 'envoy\u00e9')
                          : item.status === 'pending' ? (lang === 'en' ? 'pending' : 'en attente')
                          : item.status === 'replied' ? (lang === 'en' ? 'replied' : 'r\u00e9pondu')
                          : item.status === 'opened' ? (lang === 'en' ? 'opened' : 'ouvert')
                          : item.status}
                      </span>
                    )}
                    {item.type === 'crm_activity' && item.done && <span style={{ fontSize: 10 }}>{'\u2705'}</span>}
                  </span>
                  <span style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{formatRelativeDate(item.date, lang)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {timeline.length > 10 && (
        <button
          onClick={onToggleExpand}
          style={{
            display: 'block', margin: '10px auto 0', padding: '6px 16px', fontSize: 11,
            border: '1px solid var(--border)', borderRadius: 8, background: 'transparent',
            color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {expanded
            ? (lang === 'en' ? 'Show less' : 'Voir moins')
            : (lang === 'en' ? `Show all ${timeline.length} activities` : `Voir les ${timeline.length} activit\u00e9s`)}
        </button>
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
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Failed to assign product line' : 'Échec de l\'assignation' }); }
  };

  const handleRemove = async (plId) => {
    try {
      await request(`/crm/product-lines/${plId}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [clientId] }),
      });
      setAssigned(prev => prev.filter(p => p.id !== plId));
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Failed to remove product line' : 'Échec de la suppression' }); }
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
