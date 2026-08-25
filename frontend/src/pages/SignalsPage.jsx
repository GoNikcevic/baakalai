/* ===============================================================================
   BAKAL — Signals Page
   Signal-based prospecting: configure monitoring + view/action detected signals
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';
import { showToast } from '../services/notifications';

const SIGNAL_TYPES = ['funding', 'hiring', 'news', 'job_change', 'leadership_change', 'competitor', 'product_launch', 'expansion', 'tech_adoption'];

const SIGNAL_ICONS = {
  funding: '💰', hiring: '👥', news: '📰', job_change: '🔄', leadership_change: '👔',
  competitor: '⚔️', product_launch: '🚀', expansion: '🌍', tech_adoption: '⚡',
};

const SIGNAL_COLORS = {
  funding: '#16A34A', hiring: '#2563EB', news: '#D97706',
  job_change: '#7C3AED', leadership_change: '#0891B2', competitor: '#DC2626',
  product_launch: '#EA580C', expansion: '#0D9488', tech_adoption: '#6D28D9',
};

export default function SignalsPage() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';

  const [activeTab, setActiveTab] = useState('feed');
  const [signals, setSignals] = useState([]);
  const [counts, setCounts] = useState({});
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState('new');
  const [showCreate, setShowCreate] = useState(false);
  const [actioningId, setActioningId] = useState(null);
  const [stats, setStats] = useState(null);
  const [companyView, setCompanyView] = useState(null);
  const [companyData, setCompanyData] = useState(null);
  const [sequenceResult, setSequenceResult] = useState(null);
  const [creatingSequence, setCreatingSequence] = useState(null);

  const [form, setForm] = useState({
    name: '',
    signalTypes: ['funding', 'hiring', 'news'],
    targetSectors: '',
    targetTitles: '',
    targetKeywords: '',
    targetCompetitors: '',
  });

  const loadData = useCallback(async () => {
    try {
      const [sigData, cfgData] = await Promise.all([
        request(`/signals?status=${filter}`).catch(() => ({ signals: [], counts: {} })),
        request('/signals/configs').catch(() => ({ configs: [] })),
      ]);
      setSignals(sigData.signals || []);
      setCounts(sigData.counts || {});
      setConfigs(cfgData.configs || []);
      // Load stats
      request('/signals/stats').then(d => setStats(d)).catch(() => {});
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await request('/signals/scan', { method: 'POST' });
      showToast({ type: 'success', title: t('signals.scanDone'), message: t('signals.scanDetected', { count: result.detected || 0 }) });
      await loadData();
    } catch { showToast({ type: 'error', title: t('signals.error'), message: t('signals.scanFailed') }); }
    setScanning(false);
  };

  const handleAction = async (signalId, action) => {
    setActioningId(signalId);
    try {
      await request(`/signals/${signalId}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      setSignals(prev => prev.map(s => s.id === signalId ? { ...s, status: action === 'dismiss' ? 'dismissed' : 'actioned', action_taken: action } : s));
      const label = action === 'add_to_crm' ? t('signals.addedToCrm') :
        action === 'send_email' ? t('signals.emailSent') : t('signals.dismissed');
      showToast({ type: 'success', title: label });
    } catch { showToast({ type: 'error', title: t('signals.error'), message: t('signals.actionFailed') }); }
    setActioningId(null);
  };

  // Endpoint dédié (pas /action) : l'état signals/actioningId vit ici,
  // SignalFeed ne reçoit que des callbacks.
  const handleLinkedInOutreach = async (signalId) => {
    setActioningId(signalId);
    try {
      await request(`/signals/${signalId}/linkedin-outreach`, { method: 'POST' });
      setSignals(prev => prev.map(sig => sig.id === signalId ? { ...sig, status: 'actioned', action_taken: 'linkedin_connect' } : sig));
      showToast({ type: 'success', title: t('signals.linkedinSent') });
    } catch (err) { showToast({ type: 'error', title: t('signals.error'), message: err.message }); }
    setActioningId(null);
  };

  const handleCreateConfig = async () => {
    if (!form.name.trim()) return;
    try {
      await request('/signals/configs', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          signalTypes: form.signalTypes,
          targetSectors: form.targetSectors.split(',').map(s => s.trim()).filter(Boolean),
          targetTitles: form.targetTitles.split(',').map(s => s.trim()).filter(Boolean),
          targetKeywords: form.targetKeywords.split(',').map(s => s.trim()).filter(Boolean),
          targetCompetitors: form.targetCompetitors.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      setShowCreate(false);
      setForm({ name: '', signalTypes: ['funding', 'hiring', 'news'], targetSectors: '', targetTitles: '', targetKeywords: '', targetCompetitors: '' });
      await loadData();
    } catch { showToast({ type: 'error', title: t('signals.error'), message: t('signals.createConfigFailed') }); }
  };

  const handleDeleteConfig = async (id) => {
    if (!window.confirm(t('signals.confirmDeleteConfig'))) return;
    try {
      await request(`/signals/configs/${id}`, { method: 'DELETE' });
      await loadData();
    } catch { showToast({ type: 'error', title: t('signals.error') }); }
  };

  const handleViewCompany = async (companyName) => {
    setCompanyView(companyName);
    setCompanyData(null);
    try {
      const data = await request(`/signals/company/${encodeURIComponent(companyName)}`);
      setCompanyData(data);
    } catch { setCompanyData({ signals: [], contacts: [] }); }
  };

  const handleCreateSequence = async (signalId) => {
    setCreatingSequence(signalId);
    setSequenceResult(null);
    try {
      const data = await request(`/signals/${signalId}/create-sequence`, { method: 'POST' });
      setSequenceResult(data);
      showToast({ type: 'success', title: t('signals.sequenceCreated') });
    } catch { showToast({ type: 'error', title: t('signals.sequenceFailed') }); }
    setCreatingSequence(null);
  };

  const handleToggleConfig = async (id, enabled) => {
    try {
      await request(`/signals/configs/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
      await loadData();
    } catch { showToast({ type: 'error', title: t('signals.error') }); }
  };

  const tabs = [
    { key: 'feed', label: t('signals.tabFeed'), count: counts.new || 0 },
    { key: 'config', label: t('signals.tabConfig'), count: configs.length },
    companyView ? { key: 'company', label: `📊 ${companyView}`, count: null } : null,
  ].filter(Boolean);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('signals.title')}</h1>
          <div className="page-subtitle">{t('signals.subtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeTab === 'config' && (
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }}
              onClick={() => setShowCreate(true)}>
              {t('signals.newConfigBtn')}
            </button>
          )}
          <button className="btn btn-primary" style={{ fontSize: 13, padding: '8px 18px' }}
            onClick={handleScan} disabled={scanning}>
            {scanning ? t('signals.scanning') : t('signals.scan')}
          </button>
        </div>
      </div>

      {/* KPIs Dashboard */}
      {stats?.kpis && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: t('signals.kpiWeek'), value: stats.kpis.this_week || 0, color: 'var(--accent)' },
            { label: t('signals.kpiPending'), value: stats.kpis.pending || 0, color: 'var(--warning)' },
            { label: t('signals.kpiActioned'), value: stats.kpis.actioned || 0, color: 'var(--success)' },
            { label: t('signals.kpiAvgRelevance'), value: stats.kpis.avg_relevance || 0, color: 'var(--text-primary)' },
            { label: t('signals.kpiCompanies'), value: stats.kpis.unique_companies_30d || 0, color: 'var(--blue)' },
          ].map(k => (
            <div key={k.label} style={{
              flex: '1 1 120px', background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderLeft: `3px solid ${k.color}`, borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            padding: '10px 18px', border: 'none', background: 'transparent',
            borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
            color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 13, cursor: 'pointer',
          }}>
            {tab.label} {tab.count > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>({tab.count})</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
      ) : activeTab === 'feed' ? (
        <SignalFeed signals={signals} counts={counts} filter={filter} setFilter={setFilter}
          onAction={handleAction} onLinkedInOutreach={handleLinkedInOutreach} actioningId={actioningId} en={en}
          onViewCompany={handleViewCompany} onCreateSequence={handleCreateSequence}
          creatingSequence={creatingSequence} sequenceResult={sequenceResult} />
      ) : activeTab === 'company' ? (
        <CompanyTimeline data={companyData} companyName={companyView} en={en}
          onClose={() => { setCompanyView(null); setActiveTab('feed'); }} />
      ) : (
        <ConfigSection configs={configs} showCreate={showCreate} form={form} setForm={setForm}
          onCreateConfig={handleCreateConfig} onDeleteConfig={handleDeleteConfig}
          onToggleConfig={handleToggleConfig} setShowCreate={setShowCreate} en={en} />
      )}
    </div>
  );
}

/* ═══ Signal Feed ═══ */

function SignalFeed({ signals, counts, filter, setFilter, onAction, onLinkedInOutreach, actioningId, en, onViewCompany, onCreateSequence, creatingSequence, sequenceResult }) {
  const t = useT();
  const filters = [
    { key: 'new', label: t('signals.filterNew'), count: counts.new || 0 },
    { key: 'actioned', label: t('signals.filterActioned'), count: counts.actioned || 0 },
    { key: 'dismissed', label: t('signals.filterDismissed'), count: counts.dismissed || 0 },
  ];

  return (
    <div>
      {/* Status filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {filters.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: '5px 12px', fontSize: 11, borderRadius: 8,
            border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border)'}`,
            background: filter === f.key ? 'rgba(110,87,250,0.08)' : 'transparent',
            color: filter === f.key ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer', fontWeight: filter === f.key ? 600 : 400,
          }}>
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Signal cards */}
      {signals.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 50, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t('signals.emptyFeed')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {signals.map(s => {
            const color = SIGNAL_COLORS[s.signal_type] || 'var(--text-muted)';
            return (
              <div key={s.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                borderLeft: `3px solid ${color}`, padding: '14px 18px',
                opacity: s.status === 'dismissed' ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 4,
                        background: `${color}15`, color, fontWeight: 600, textTransform: 'uppercase',
                      }}>
                        {SIGNAL_ICONS[s.signal_type]} {t(`signals.type.${s.signal_type}`)}
                      </span>
                      <span style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 4,
                        background: s.relevance_score >= 70 ? 'rgba(22,163,74,0.1)' : 'var(--bg-elevated)',
                        color: s.relevance_score >= 70 ? 'var(--success)' : 'var(--text-muted)',
                        fontWeight: 600,
                      }}>
                        {s.relevance_score}/100
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
                    {s.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{s.description}</div>}
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                      {s.company_name && <span style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        onClick={(e) => { e.stopPropagation(); onViewCompany?.(s.company_name); }}>🏢 {s.company_name}</span>}
                      {s.contact_name && <span>👤 {s.contact_name}{s.contact_title ? ` · ${s.contact_title}` : ''}</span>}
                      {s.contact_email && <span>✉️ {s.contact_email}</span>}
                      <span>{new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {s.status === 'new' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }}
                      onClick={() => onAction(s.id, 'add_to_crm')} disabled={actioningId === s.id}>
                      {t('signals.addToCrm')}
                    </button>
                    {s.contact_email && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px', border: '1px solid var(--border)' }}
                        onClick={() => onAction(s.id, 'send_email')} disabled={actioningId === s.id}>
                        {t('signals.sendEmail')}
                      </button>
                    )}
                    {s.contact_linkedin && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px', border: '1px solid #0A66C2', color: '#0A66C2' }}
                        onClick={() => onLinkedInOutreach(s.id)} disabled={actioningId === s.id}>
                        {t('signals.connectLinkedin')}
                      </button>
                    )}
                    {s.source_url && (
                      <a href={s.source_url} target="_blank" rel="noopener noreferrer"
                        className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px', textDecoration: 'none', border: '1px solid var(--border)' }}>
                        {t('signals.source')} ↗
                      </a>
                    )}
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px', border: '1px solid var(--accent)', color: 'var(--accent)' }}
                      onClick={() => onCreateSequence?.(s.id)} disabled={creatingSequence === s.id}>
                      {creatingSequence === s.id ? '...' : t('signals.createSequence')}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 12px', color: 'var(--text-muted)' }}
                      onClick={() => onAction(s.id, 'dismiss')} disabled={actioningId === s.id}>
                      {t('signals.dismiss')}
                    </button>
                  </div>
                )}
                {sequenceResult?.signal?.id === s.id && sequenceResult?.sequence && (
                  <div style={{ marginTop: 10, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--accent)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--accent)' }}>
                      ⚡ {sequenceResult.sequence.name}
                    </div>
                    {sequenceResult.queuedEmailId && (
                      <div style={{ fontSize: 11, color: 'var(--success)', marginBottom: 8 }}>
                        ✓ {t('activation.sequenceE1Queued')}
                      </div>
                    )}
                    {sequenceResult.sequence.steps.map((step, i) => (
                      <div key={i} style={{ fontSize: 11, marginBottom: 6, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
                        <div style={{ fontWeight: 600 }}>{step.step} ({step.timing}) — {step.subject}</div>
                        <div style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{step.body}</div>
                      </div>
                    ))}
                  </div>
                )}
                {s.status === 'actioned' && (
                  <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 8 }}>
                    ✅ {s.action_taken === 'add_to_crm' ? t('signals.addedToCrm') :
                        s.action_taken === 'send_email' ? t('signals.emailSent') : s.action_taken}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══ Company Timeline ═══ */

function CompanyTimeline({ data, companyName, en, onClose }) {
  const t = useT();
  if (!data) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📊 {companyName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('signals.signalsCount', { count: data.signals.length })} · {t('signals.contactsInCrm', { count: data.contacts.length })}
          </div>
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>
          {t('signals.backToFeed')}
        </button>
      </div>

      {/* CRM contacts for this company */}
      {data.contacts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            {t('signals.crmContacts')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {data.contacts.map(c => (
              <div key={c.id} style={{
                padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 12,
              }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {c.title || ''} · {c.status} {c.deal_value ? `· ${c.deal_value}€` : ''} {c.churn_score >= 50 ? `· Churn ${c.churn_score}%` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signal timeline */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
        {t('signals.timeline')}
      </div>
      {data.signals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>
          {t('signals.noCompanySignals')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.signals.map(s => {
            const color = SIGNAL_COLORS[s.signal_type] || 'var(--text-muted)';
            return (
              <div key={s.id} style={{
                padding: '10px 14px', borderLeft: `3px solid ${color}`,
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${color}15`, color, fontWeight: 600, textTransform: 'uppercase', marginRight: 8 }}>
                      {t(`signals.type.${s.signal_type}`)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(s.detected_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {s.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{s.description}</div>}
                {s.contact_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>👤 {s.contact_name} {s.contact_title ? `· ${s.contact_title}` : ''}</div>}
                {s.status === 'actioned' && (
                  <div style={{ fontSize: 10, color: 'var(--success)', marginTop: 4 }}>✅ {s.action_taken}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══ Config Section ═══ */

function ConfigSection({ configs, showCreate, form, setForm, onCreateConfig, onDeleteConfig, onToggleConfig, setShowCreate, en }) {
  const t = useT();
  return (
    <div>
      {/* Create form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
              {t('signals.newConfigTitle')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input type="text" placeholder={t('signals.configNamePh')}
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="form-input" style={{ fontSize: 13, padding: '8px 12px' }} />

              {/* Signal types */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t('signals.typesLabel')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {SIGNAL_TYPES.map(value => (
                    <button key={value} onClick={() => {
                      setForm(p => ({
                        ...p,
                        signalTypes: p.signalTypes.includes(value)
                          ? p.signalTypes.filter(v => v !== value)
                          : [...p.signalTypes, value],
                      }));
                    }} style={{
                      padding: '5px 12px', fontSize: 11, borderRadius: 8,
                      border: `1px solid ${form.signalTypes.includes(value) ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.signalTypes.includes(value) ? 'rgba(110,87,250,0.08)' : 'transparent',
                      color: form.signalTypes.includes(value) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                      {SIGNAL_ICONS[value]} {t(`signals.type.${value}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Targeting */}
              <input type="text" placeholder={t('signals.sectorsPh')}
                value={form.targetSectors} onChange={e => setForm(p => ({ ...p, targetSectors: e.target.value }))}
                className="form-input" style={{ fontSize: 13, padding: '8px 12px' }} />

              <input type="text" placeholder={t('signals.titlesPh')}
                value={form.targetTitles} onChange={e => setForm(p => ({ ...p, targetTitles: e.target.value }))}
                className="form-input" style={{ fontSize: 13, padding: '8px 12px' }} />

              <input type="text" placeholder={t('signals.keywordsPh')}
                value={form.targetKeywords} onChange={e => setForm(p => ({ ...p, targetKeywords: e.target.value }))}
                className="form-input" style={{ fontSize: 13, padding: '8px 12px' }} />

              <input type="text" placeholder={t('signals.competitorsPh')}
                value={form.targetCompetitors} onChange={e => setForm(p => ({ ...p, targetCompetitors: e.target.value }))}
                className="form-input" style={{ fontSize: 13, padding: '8px 12px' }} />

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                  {t('signals.cancel')}
                </button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={onCreateConfig} disabled={!form.name.trim()}>
                  {t('signals.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Existing configs */}
      {configs.length === 0 && !showCreate ? (
        <div style={{
          textAlign: 'center', padding: 50, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
            {t('signals.emptyConfig')}
          </div>
          <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => setShowCreate(true)}>
            {t('signals.createConfig')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {configs.map(c => (
            <div key={c.id} className="card" style={{
              borderLeft: `3px solid ${c.enabled ? 'var(--success)' : 'var(--text-muted)'}`,
              opacity: c.enabled ? 1 : 0.6,
            }}>
              <div className="card-body" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {(c.signal_types || []).map(st => (
                        <span key={st} style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 4,
                          background: `${SIGNAL_COLORS[st] || '#666'}15`,
                          color: SIGNAL_COLORS[st] || 'var(--text-muted)',
                        }}>
                          {SIGNAL_ICONS[st]} {t(`signals.type.${st}`)}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      {(c.target_sectors || []).length > 0 && <span>{t('signals.sectors')}: {c.target_sectors.join(', ')} · </span>}
                      {(c.target_keywords || []).length > 0 && <span>{t('signals.keywords')}: {c.target_keywords.join(', ')} · </span>}
                      {c.last_run && <span>{t('signals.lastScan')}: {new Date(c.last_run).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" style={{
                      fontSize: 10, padding: '4px 10px',
                      color: c.enabled ? 'var(--warning)' : 'var(--success)',
                    }} onClick={() => onToggleConfig(c.id, c.enabled)}>
                      {c.enabled ? t('signals.pause') : t('signals.enable')}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                      onClick={() => onDeleteConfig(c.id)}>
                      {t('signals.delete')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
