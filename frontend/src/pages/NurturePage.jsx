/* ===============================================================================
   BAKAL — Nurture Page
   Configure triggers, view pending/sent emails, manage client nurturing.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';

const TRIGGER_TYPES = [
  { value: 'deal_won', label: 'Deal gagn\u00E9', desc: 'Email de bienvenue / onboarding quand un deal est gagn\u00E9', icon: '\uD83C\uDF89', defaultDays: 1, defaultName: 'Bienvenue nouveau client' },
  { value: 'deal_stagnant', label: 'Deal stagnant', desc: 'Relancer quand un deal est inactif depuis X jours', icon: '\u23F0', defaultDays: 30, defaultName: 'Relance deals stagnants' },
  { value: 'inactive_contact', label: 'Contact inactif', desc: 'R\u00E9engager un contact sans activit\u00E9 depuis X jours', icon: '\uD83D\uDCA4', defaultDays: 60, defaultName: 'R\u00E9activation contacts inactifs' },
  { value: 'deal_lost', label: 'Deal perdu', desc: 'Email de suivi apr\u00E8s un deal perdu (win-back)', icon: '\uD83D\uDC94', defaultDays: 14, defaultName: 'Win-back deals perdus' },
  { value: 'onboarding_check', label: 'Check onboarding', desc: 'V\u00E9rifier la prise en main X jours apr\u00E8s signature', icon: '\uD83D\uDE80', defaultDays: 7, defaultName: 'Suivi onboarding J+7' },
  { value: 'renewal_reminder', label: 'Renouvellement', desc: 'Rappel X jours avant la date de renouvellement', icon: '\uD83D\uDD14', defaultDays: 30, defaultName: 'Rappel renouvellement' },
  { value: 'upsell_opportunity', label: 'Opportunit\u00E9 upsell', desc: 'Proposer un upgrade aux clients actifs depuis X jours', icon: '\u2B06\uFE0F', defaultDays: 90, defaultName: 'Proposition upsell' },
  { value: 'feedback_request', label: 'Demande de feedback', desc: 'Demander un retour d\'exp\u00E9rience apr\u00E8s X jours', icon: '\u2B50', defaultDays: 30, defaultName: 'Demande de t\u00E9moignage' },
];

export default function NurturePage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [triggers, setTriggers] = useState([]);
  const [emails, setEmails] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [triggersData, emailsData, metricsData] = await Promise.all([
        request('/nurture/triggers'),
        request('/nurture/emails?limit=50'),
        request('/dashboard/activation').catch(() => null),
      ]);
      setTriggers(triggersData.triggers || []);
      setEmails(emailsData.emails || []);
      setMetrics(metricsData);
    } catch (err) {
      console.error('Failed to load nurture data:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const tabs = [
    { key: 'dashboard', label: 'Vue d\'ensemble', count: null },
    { key: 'triggers', label: 'Triggers', count: triggers.length },
    { key: 'pending', label: 'En attente', count: emails.filter(e => e.status === 'pending').length },
    { key: 'sent', label: 'Envoy\u00E9s', count: emails.filter(e => e.status === 'sent').length },
  ];

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Activation</h1>
          <div className="page-subtitle">
            Automatisez vos emails de suivi client
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={async () => {
              try {
                const result = await request('/nurture/run', { method: 'POST' });
                alert(`${result.triggered} triggers \u00E9valu\u00E9s, ${result.sent} envoy\u00E9s, ${result.queued} en attente`);
                loadData();
              } catch (err) {
                alert('Erreur: ' + err.message);
              }
            }}
          >
            {'\u25B6'} Ex\u00E9cuter maintenant
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => { setActiveTab('triggers'); setShowCreate(true); }}
          >
            + Nouveau trigger
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 18px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${activeTab === t.key ? 'var(--accent)' : 'transparent'}`,
              color: activeTab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === t.key ? 600 : 400, fontSize: 13, cursor: 'pointer',
            }}
          >
            {t.label} {t.count > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>({t.count})</span>}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement...</div>}

      {!loading && activeTab === 'dashboard' && <ActivationDashboard metrics={metrics} />}
      {!loading && activeTab === 'triggers' && (
        <TriggersSection triggers={triggers} onRefresh={loadData} showCreate={showCreate} setShowCreate={setShowCreate} />
      )}
      {!loading && activeTab === 'pending' && (
        <EmailsSection emails={emails.filter(e => e.status === 'pending')} type="pending" onRefresh={loadData} />
      )}
      {!loading && activeTab === 'sent' && (
        <EmailsSection emails={emails.filter(e => e.status === 'sent')} type="sent" onRefresh={loadData} />
      )}
    </div>
  );
}

/* ═══ Triggers Section ═══ */

function TriggersSection({ triggers, onRefresh, showCreate, setShowCreate }) {
  const [form, setForm] = useState({
    name: '',
    triggerType: 'deal_stagnant',
    days: 30,
    mode: 'approval',
    tone: 'professionnel mais chaleureux',
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await request('/nurture/triggers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          triggerType: form.triggerType,
          conditions: { days: parseInt(form.days, 10) || 30 },
          mode: form.mode,
          emailTemplate: { tone: form.tone },
        }),
      });
      setShowCreate(false);
      setForm({ name: '', triggerType: 'deal_stagnant', days: 30, mode: 'approval', tone: 'professionnel mais chaleureux' });
      onRefresh();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
    setSaving(false);
  };

  const handleToggle = async (id, enabled) => {
    try {
      await request(`/nurture/triggers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !enabled }),
      });
      onRefresh();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce trigger ?')) return;
    try {
      await request(`/nurture/triggers/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch { /* ignore */ }
  };

  return (
    <div>
      {/* Create form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Nouveau trigger</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                placeholder="Nom du trigger (ex: Relance deals stagnants)"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  value={form.triggerType}
                  onChange={e => {
                    const tt = TRIGGER_TYPES.find(t => t.value === e.target.value);
                    setForm(p => ({
                      ...p,
                      triggerType: e.target.value,
                      name: p.name || tt?.defaultName || '',
                      days: tt?.defaultDays || p.days,
                    }));
                  }}
                  className="form-input"
                  style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}
                >
                  {TRIGGER_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Jours"
                  value={form.days}
                  onChange={e => setForm(p => ({ ...p, days: e.target.value }))}
                  className="form-input"
                  style={{ width: 80, fontSize: 13, padding: '8px 12px' }}
                />
                <select
                  value={form.mode}
                  onChange={e => setForm(p => ({ ...p, mode: e.target.value }))}
                  className="form-input"
                  style={{ width: 140, fontSize: 13, padding: '8px 12px' }}
                >
                  <option value="approval">Approbation</option>
                  <option value="auto">Automatique</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                  Annuler
                </button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleCreate} disabled={saving || !form.name}>
                  {saving ? 'Cr\u00E9ation...' : 'Cr\u00E9er'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Triggers list */}
      {triggers.length === 0 && !showCreate ? (
        <div style={{
          textAlign: 'center', padding: 50,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{'\u26A1'}</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Aucun trigger configur{'\u00E9'}. Cr{'\u00E9'}ez votre premier trigger pour automatiser vos emails d'activation.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {triggers.map(trigger => {
            const typeConfig = TRIGGER_TYPES.find(t => t.value === trigger.trigger_type) || {};
            const conditions = trigger.conditions || {};
            return (
              <div key={trigger.id} className="card" style={{
                borderLeft: `3px solid ${trigger.enabled ? 'var(--success)' : 'var(--text-muted)'}`,
                opacity: trigger.enabled ? 1 : 0.6,
              }}>
                <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {typeConfig.icon || '\u26A1'} {trigger.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      {typeConfig.desc} {conditions.days ? `(${conditions.days}j)` : ''}
                      {' \u00B7 '} Mode : {trigger.mode === 'auto' ? 'automatique' : 'approbation'}
                      {trigger.last_run && ` \u00B7 Dernier run : ${new Date(trigger.last_run).toLocaleDateString('fr-FR')}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', color: trigger.enabled ? 'var(--warning)' : 'var(--success)' }}
                      onClick={() => handleToggle(trigger.id, trigger.enabled)}
                    >
                      {trigger.enabled ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                      onClick={() => handleDelete(trigger.id)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══ Emails Section ═══ */

function EmailsSection({ emails, type, onRefresh }) {
  const handleApprove = async (id) => {
    try {
      await request(`/nurture/emails/${id}/approve`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  };

  const handleCancel = async (id) => {
    try {
      await request(`/nurture/emails/${id}/cancel`, { method: 'POST' });
      onRefresh();
    } catch { /* ignore */ }
  };

  if (emails.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 50,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>
          {type === 'pending' ? '\uD83D\uDCEC' : '\u2705'}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {type === 'pending' ? 'Aucun email en attente d\'approbation' : 'Aucun email envoy\u00E9'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {emails.map(email => (
        <div key={email.id} className="card">
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{email.to_name || email.to_email}</span>
                  {email.trigger_name && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      {email.trigger_name}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>{email.subject}</div>
                <div style={{
                  fontSize: 12, color: 'var(--text-secondary)', marginTop: 6,
                  whiteSpace: 'pre-wrap', lineHeight: 1.5,
                  maxHeight: 80, overflow: 'hidden',
                }}>
                  {email.body}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  {email.to_email}
                  {email.sent_at && ` \u00B7 Envoy\u00E9 le ${new Date(email.sent_at).toLocaleString('fr-FR')}`}
                  {email.error && <span style={{ color: 'var(--danger)' }}> \u00B7 {email.error}</span>}
                </div>
              </div>

              {type === 'pending' && (
                <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '4px 12px' }}
                    onClick={() => handleApprove(email.id)}
                  >
                    Envoyer
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
                    onClick={() => handleCancel(email.id)}
                  >
                    Annuler
                  </button>
                </div>
              )}

              {type === 'sent' && (
                <span style={{ fontSize: 11, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                  {'\u2705'} Envoy{'\u00E9'}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══ Activation Dashboard ═══ */

const SEGMENT_CONFIG = [
  { key: 'active', label: 'Actifs', color: 'var(--success)', icon: '\u2705' },
  { key: 'won', label: 'Gagn\u00E9s', color: 'var(--purple)', icon: '\uD83C\uDFC6' },
  { key: 'stagnant', label: 'Stagnants', color: 'var(--warning)', icon: '\u23F0' },
  { key: 'churnRisk', label: 'Risque churn', color: 'var(--danger)', icon: '\u26A0\uFE0F' },
];

function ActivationDashboard({ metrics }) {
  if (!metrics) {
    return (
      <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)', fontSize: 13 }}>
        Connectez Pipedrive et importez vos contacts pour voir les m{'\u00E9'}triques d'activation.
      </div>
    );
  }

  const { segments, topStagnant, topChurnRisk, emailsLast30d, triggers } = metrics;

  return (
    <div>
      {/* Segment KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {SEGMENT_CONFIG.map(seg => (
          <div key={seg.key} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '16px 20px', borderTop: `3px solid ${seg.color}`,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{seg.icon} {seg.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: seg.color }}>{segments[seg.key] || 0}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">{'\u23F0'} Deals stagnants</div></div>
          <div className="card-body">
            {(topStagnant || []).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Aucun deal stagnant</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topStagnant.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      {c.company && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>@ {c.company}</span>}
                    </div>
                    <span style={{ color: 'var(--warning)', fontSize: 11 }}>{c.daysSinceUpdate}j</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">{'\u26A0\uFE0F'} Risque de churn</div></div>
          <div className="card-body">
            {(topChurnRisk || []).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>Aucun risque</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topChurnRisk.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      {c.company && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>@ {c.company}</span>}
                    </div>
                    <span style={{ color: 'var(--danger)', fontSize: 11 }}>{c.daysSinceUpdate}j</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title">{'\u2709\uFE0F'} Emails (30j)</div></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              {[
                { label: 'Envoy\u00E9s', value: emailsLast30d?.sent || 0, color: 'var(--success)' },
                { label: 'En attente', value: emailsLast30d?.pending || 0, color: 'var(--warning)' },
                { label: '\u00C9chou\u00E9s', value: emailsLast30d?.failed || 0, color: 'var(--danger)' },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">{'\u26A1'} Triggers actifs</div></div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{triggers?.active || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>sur {triggers?.total || 0}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
