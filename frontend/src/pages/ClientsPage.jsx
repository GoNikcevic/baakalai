/* ===============================================================================
   BAKAL — Clients Page
   Import contacts from CRM, view pipeline stages, manage client relationships.
   Click a client to open detail panel with timeline + emails + actions.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import api, { request } from '../services/api-client';
import { useT } from '../i18n';

const STAGE_COLORS = [
  'var(--text-muted)', 'var(--blue)', 'var(--accent)',
  'var(--warning)', 'var(--purple)', 'var(--success)',
];

const STATUS_COLORS = {
  new: 'var(--text-muted)', imported: 'var(--blue)', interested: 'var(--accent)',
  meeting: 'var(--warning)', negotiation: 'var(--purple)', won: 'var(--success)', lost: 'var(--danger)',
};
const STATUS_LABELS = {
  new: 'Nouveau', imported: 'Import\u00e9', interested: 'Int\u00e9ress\u00e9',
  meeting: 'RDV', negotiation: 'N\u00e9go', won: 'Gagn\u00e9', lost: 'Perdu',
};

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
  const t = useT();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Detect connected CRM
      const providersData = await request('/crm/providers').catch(() => ({ providers: [] }));
      const crmProviders = ['pipedrive', 'hubspot', 'salesforce', 'odoo'];
      const connected = (providersData.providers || []).find(p => crmProviders.includes(p.provider) && p.connected);
      setConnectedCrm(connected?.provider || null);

      const [oppsData] = await Promise.all([
        request('/dashboard/opportunities').catch(() => ({ opportunities: [] })),
      ]);
      setClients(oppsData.opportunities || []);

      // Load pipeline stages for connected CRM
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
  }, [loadData]);

  const filtered = clients.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.name || '').toLowerCase().includes(q)
        || (c.company || '').toLowerCase().includes(q)
        || (c.email || '').toLowerCase().includes(q);
    }
    return true;
  });

  const statusCounts = {};
  for (const c of clients) statusCounts[c.status || 'unknown'] = (statusCounts[c.status || 'unknown'] || 0) + 1;

  const statusTabs = [
    { key: 'all', label: 'Tous', count: clients.length },
    { key: 'imported', label: 'Import\u00e9s', count: statusCounts.imported || 0 },
    { key: 'new', label: 'Nouveaux', count: statusCounts.new || 0 },
    { key: 'interested', label: 'Int\u00e9ress\u00e9s', count: statusCounts.interested || 0 },
    { key: 'meeting', label: 'RDV', count: statusCounts.meeting || 0 },
    { key: 'won', label: 'Gagn\u00e9s', count: statusCounts.won || 0 },
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
        {connectedCrm ? (
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
        )}
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
          type="text" placeholder="Rechercher..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 14px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13,
          }}
        />
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
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement...</div>
          ) : filtered.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 50, background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{'\uD83D\uDC65'}</div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {clients.length === 0 ? 'Aucun contact. Importez depuis Pipedrive.' : 'Aucun r\u00e9sultat.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map(c => {
                const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
                const isSelected = selectedClient?.id === c.id;
                return (
                  <div key={c.id} onClick={() => setSelectedClient(c)} style={{
                    display: 'grid', gridTemplateColumns: selectedClient ? '2fr 1fr 80px' : '2fr 1.5fr 1fr 1fr 80px',
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
                    {!selectedClient && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: c.score >= 70 ? 'var(--success)' : c.score >= 40 ? 'var(--warning)' : 'var(--text-muted)' }}>
                        {c.score != null ? `${c.score}/100` : '\u2014'}
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
        {client.crm_provider && (
          <span style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 8,
            background: 'var(--bg-elevated)', color: 'var(--text-muted)', textTransform: 'capitalize',
          }}>
            {client.crm_provider}
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 11, padding: '6px 14px' }}
          onClick={handleQuickEmail}
          disabled={sending || !client.email}
        >
          {sending ? '\u23F3...' : '\u2709\uFE0F Envoyer un email'}
        </button>
        {client.linkedin_url && (
          <a href={client.linkedin_url} target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost" style={{ fontSize: 11, padding: '6px 14px', textDecoration: 'none' }}>
            LinkedIn
          </a>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>Chargement...</div>
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
                Aucune activit\u00e9 pour ce contact
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
