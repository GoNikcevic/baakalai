/* ===============================================================================
   BAKAL — Nurture Page
   Configure triggers, view pending/sent emails, manage client nurturing.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { getUser } from '../services/auth';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';

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
  const t = useT();
  const { lang } = useI18n();
  const user = getUser();
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';
  const [activeTab, setActiveTab] = useState('dashboard');
  const [triggers, setTriggers] = useState([]);
  const [emails, setEmails] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [previews, setPreviews] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);

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

  // Group sent emails by trigger to form "campaigns"
  const sentEmails = emails.filter(e => e.status === 'sent');
  const campaignsByTrigger = {};
  for (const e of sentEmails) {
    const key = e.trigger_id || 'manual';
    if (!campaignsByTrigger[key]) campaignsByTrigger[key] = { trigger: e.trigger_name || 'Envoi manuel', emails: [] };
    campaignsByTrigger[key].emails.push(e);
  }

  const tabs = [
    { key: 'dashboard', label: t('activation.overview'), count: null },
    { key: 'campaigns', label: t('activation.campaigns'), count: Object.keys(campaignsByTrigger).length },
    { key: 'triggers', label: t('activation.triggers'), count: triggers.length },
    { key: 'pending', label: t('activation.pending'), count: emails.filter(e => e.status === 'pending').length },
    { key: 'sent', label: t('activation.sent'), count: sentEmails.length },
    isAdmin ? { key: 'team', label: lang === 'en' ? 'Team Campaigns' : 'Campagnes \u00E9quipe', count: null } : null,
  ].filter(Boolean);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('activation.title')}</h1>
          <div className="page-subtitle">
            {t('activation.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px' }}
            disabled={previewing}
            onClick={async () => {
              setPreviewing(true);
              try {
                const data = await request('/nurture/preview', { method: 'POST' });
                setPreviews(data.previews || []);
              } catch (err) {
                alert('Erreur: ' + err.message);
              }
              setPreviewing(false);
            }}
          >
            {previewing ? `\u23F3 ${t('activation.previewing')}` : `\uD83D\uDD0D ${t('activation.preview')}`}
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => { setActiveTab('triggers'); setShowCreate(true); }}
          >
            {t('activation.newTrigger')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px', border: 'none', background: 'transparent',
              borderBottom: `2px solid ${activeTab === tab.key ? 'var(--accent)' : 'transparent'}`,
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.key ? 600 : 400, fontSize: 13, cursor: 'pointer',
            }}
          >
            {tab.label} {tab.count > 0 && <span style={{ fontSize: 11, opacity: 0.7 }}>({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Preview panel */}
      {previews && (
        <div style={{
          background: 'var(--primary-softer)', border: '1px solid var(--primary)',
          borderRadius: 'var(--r-xl)', padding: 24, marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {previews.length > 0 ? t('activation.contactsToContact', { count: previews.reduce((s, p) => s + p.contactsCount, 0) }) : t('activation.noContactsToEmail')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--grey-500)', marginTop: 2 }}>
                {previews.length} trigger{previews.length > 1 ? 's' : ''} actif{previews.length > 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {previews.length > 0 && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 16px' }}
                  disabled={executing}
                  onClick={async () => {
                    setExecuting(true);
                    try {
                      const result = await request('/nurture/run', { method: 'POST' });
                      setPreviews(null);
                      loadData();
                    } catch (err) {
                      alert('Erreur: ' + err.message);
                    }
                    setExecuting(false);
                  }}
                >
                  {executing ? `\u23F3 ${t('activation.sending')}` : t('activation.sendEmails', { count: previews.reduce((s, p) => s + p.contactsCount, 0) })}
                </button>
              )}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setPreviews(null)}>
                {t('activation.close')}
              </button>
            </div>
          </div>

          {previews.map(p => (
            <div key={p.triggerId} style={{
              background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
              padding: 16, marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.triggerName}</div>
                <span style={{ fontSize: 11, color: 'var(--grey-500)' }}>
                  {p.contactsCount} contact{p.contactsCount > 1 ? 's' : ''} {'\u00B7'} mode {p.mode === 'auto' ? 'auto' : 'approbation'}
                </span>
              </div>

              {/* Contacts preview */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {p.contacts.map(c => (
                  <span key={c.id} style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 'var(--r-full)',
                    background: 'var(--paper-2)', border: '1px solid var(--border)',
                  }}>
                    {c.name}{c.company ? ` @ ${c.company}` : ''}
                  </span>
                ))}
                {p.contactsCount > 5 && (
                  <span style={{ fontSize: 11, color: 'var(--grey-500)', padding: '3px 6px' }}>
                    +{p.contactsCount - 5} autres
                  </span>
                )}
              </div>

              {/* Sample email preview */}
              {p.sampleEmail && (
                <div style={{
                  background: 'var(--paper-2)', borderRadius: 8, padding: '10px 14px',
                  borderLeft: '3px solid var(--lavender)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--grey-500)', marginBottom: 4 }}>
                    Exemple d'email pour {p.contacts[0]?.name || 'un contact'} :
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{p.sampleEmail.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-700)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {p.sampleEmail.body}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('common.loading')}</div>}

      {!loading && activeTab === 'dashboard' && <ActivationDashboard metrics={metrics} />}
      {!loading && activeTab === 'campaigns' && <CampaignsSection campaigns={campaignsByTrigger} />}
      {!loading && activeTab === 'triggers' && (
        <TriggersSection triggers={triggers} onRefresh={loadData} showCreate={showCreate} setShowCreate={setShowCreate} />
      )}
      {!loading && activeTab === 'pending' && (
        <EmailsSection emails={emails.filter(e => e.status === 'pending')} type="pending" onRefresh={loadData} />
      )}
      {!loading && activeTab === 'sent' && (
        <EmailsSection emails={emails.filter(e => e.status === 'sent')} type="sent" onRefresh={loadData} />
      )}
      {!loading && activeTab === 'team' && <TeamCampaignsSection lang={lang} />}
    </div>
  );
}

/* ═══ Triggers Section ═══ */

function TriggersSection({ triggers, onRefresh, showCreate, setShowCreate }) {
  const t = useT();
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
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Failed to update trigger' }); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('activation.delete') + '?')) return;
    try {
      await request(`/nurture/triggers/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Operation failed' }); }
  };

  return (
    <div>
      {/* Create form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{t('activation.newTriggerTitle')}</div>
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
            {t('activation.noTriggers')}
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
                      {trigger.enabled ? t('activation.disable') : t('activation.enable')}
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
  const t = useT();
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
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Operation failed' }); }
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
          {type === 'pending' ? t('activation.noPending') : t('activation.noSent')}
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
  const t = useT();
  if (!metrics) {
    return (
      <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('activation.connectCrm')}
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
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>{t('activation.noStagnant')}</div>
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
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>{t('activation.noRisk')}</div>
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

/* ═══ Campaigns Section ═══ */

function CampaignsSection({ campaigns }) {
  const t = useT();
  const [expanded, setExpanded] = useState(null);
  const keys = Object.keys(campaigns);

  if (keys.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 50,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>{'\u2709\uFE0F'}</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {t('activation.noCampaigns')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {keys.map(key => {
        const campaign = campaigns[key];
        const emailList = campaign.emails || [];
        const isOpen = expanded === key;

        // Compute campaign stats
        const total = emailList.length;
        const uniqueContacts = new Set(emailList.map(e => e.to_email)).size;
        const firstSent = emailList.length > 0
          ? new Date(emailList[emailList.length - 1].sent_at || emailList[emailList.length - 1].created_at)
          : null;
        const lastSent = emailList.length > 0
          ? new Date(emailList[0].sent_at || emailList[0].created_at)
          : null;

        return (
          <div key={key} className="card" style={{ borderLeft: '3px solid var(--primary)' }}>
            {/* Campaign header */}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setExpanded(isOpen ? null : key)}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{campaign.trigger}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {total} email{total > 1 ? 's' : ''} envoy{'\u00E9'}{total > 1 ? 's' : ''}
                  {' \u00B7 '}{uniqueContacts} contact{uniqueContacts > 1 ? 's' : ''}
                  {firstSent && ` \u00B7 ${firstSent.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} \u2192 ${lastSent.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
                </div>
              </div>
              <span style={{ fontSize: 16, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                {'\u203A'}
              </span>
            </div>

            {/* Expanded: email list */}
            {isOpen && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {emailList.slice(0, 20).map(e => (
                    <div key={e.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 12px', borderRadius: 8, background: 'var(--paper-2)',
                      fontSize: 12,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{e.to_name || e.to_email}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{e.subject}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                        {e.analyzed_at ? (
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--success-soft)', color: 'var(--success)' }}>
                            Analys{'\u00E9'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--paper-3)', color: 'var(--grey-500)' }}>
                            En attente
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {e.sent_at ? new Date(e.sent_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                  {emailList.length > 20 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                      +{emailList.length - 20} autres
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══ Team Campaigns Section ═══ */

function TeamCampaignsSection({ lang }) {
  const en = lang === 'en';
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [owners, setOwners] = useState([]);
  const [productLines, setProductLines] = useState([]);
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewedId, setPreviewedId] = useState(null);
  const [launching, setLaunching] = useState(null);

  const [form, setForm] = useState({
    name: '',
    targetOwners: [],
    targetProductLines: [],
    emailPrompt: '',
    emailTone: 'professional',
  });

  const load = useCallback(async () => {
    try {
      const [campData, ownerData, plData] = await Promise.all([
        request('/team-campaigns'),
        request('/crm/team-owners').catch(() => ({ owners: [] })),
        request('/crm/product-lines').catch(() => ({ productLines: [] })),
      ]);
      setCampaigns(campData.campaigns || []);
      setOwners(ownerData.owners || []);
      setProductLines(plData.productLines || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await request('/team-campaigns', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ name: '', targetOwners: [], targetProductLines: [], emailPrompt: '', emailTone: 'professional' });
      setShowCreate(false);
      await load();
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Failed to create campaign' }); }
  };

  const handlePreview = async (id) => {
    setPreviewing(id);
    setPreviewData(null);
    setPreviewedId(id);
    try {
      const data = await request(`/team-campaigns/${id}/preview`, { method: 'POST' });
      setPreviewData(data);
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Preview failed' }); }
    setPreviewing(null);
  };

  const handleLaunch = async (id) => {
    if (!window.confirm(en ? 'Launch this campaign? Emails will be sent from each rep\'s inbox.' : 'Lancer cette campagne ? Les emails seront envoy\u00E9s depuis la bo\u00EEte de chaque commercial.')) return;
    setLaunching(id);
    try {
      await request(`/team-campaigns/${id}/launch`, { method: 'POST' });
      await load();
    } catch { showToast({ type: 'error', title: 'Erreur', message: 'Launch failed' }); }
    setLaunching(null);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>;

  const STATUS_COLORS = {
    draft: 'var(--text-muted)', preview: 'var(--blue)', running: 'var(--warning)',
    completed: 'var(--success)', cancelled: 'var(--danger)',
  };
  const STATUS_LABELS = en
    ? { draft: 'Draft', preview: 'Preview', running: 'Running', completed: 'Completed', cancelled: 'Cancelled' }
    : { draft: 'Brouillon', preview: 'Aper\u00E7u', running: 'En cours', completed: 'Termin\u00E9e', cancelled: 'Annul\u00E9e' };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {en ? 'Launch email campaigns sent from each sales rep\'s inbox' : 'Lancez des campagnes email envoy\u00E9es depuis la bo\u00EEte de chaque commercial'}
        </div>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }} onClick={() => setShowCreate(true)}>
          {en ? '+ New campaign' : '+ Nouvelle campagne'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 20, marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
            {en ? 'New team campaign' : 'Nouvelle campagne \u00E9quipe'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text" placeholder={en ? 'Campaign name' : 'Nom de la campagne'}
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="form-input" style={{ fontSize: 13, padding: '8px 12px' }}
            />

            {/* Target owners */}
            {owners.length > 1 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {en ? 'Sales reps (empty = all)' : 'Commerciaux (vide = tous)'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {owners.map(o => (
                    <button key={o.id} onClick={() => {
                      setForm(p => ({
                        ...p,
                        targetOwners: p.targetOwners.includes(o.id)
                          ? p.targetOwners.filter(id => id !== o.id)
                          : [...p.targetOwners, o.id],
                      }));
                    }} style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 8,
                      border: `1px solid ${form.targetOwners.includes(o.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.targetOwners.includes(o.id) ? 'rgba(110,87,250,0.1)' : 'transparent',
                      color: form.targetOwners.includes(o.id) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                      {o.name} ({o.contact_count})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Target product lines */}
            {productLines.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {en ? 'Product lines (empty = all)' : 'Lignes de produits (vide = toutes)'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {productLines.map(pl => (
                    <button key={pl.id} onClick={() => {
                      setForm(p => ({
                        ...p,
                        targetProductLines: p.targetProductLines.includes(pl.id)
                          ? p.targetProductLines.filter(id => id !== pl.id)
                          : [...p.targetProductLines, pl.id],
                      }));
                    }} style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 8,
                      border: `1px solid ${form.targetProductLines.includes(pl.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.targetProductLines.includes(pl.id) ? 'rgba(110,87,250,0.1)' : 'transparent',
                      color: form.targetProductLines.includes(pl.id) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                      {pl.icon || '\uD83D\uDCE6'} {pl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Email prompt */}
            <textarea
              placeholder={en ? 'Email instructions for AI (e.g., "Follow up on Q2 proposal, mention the cybersecurity offer")' : 'Instructions pour l\'IA (ex: "Relance sur la proposition Q2, mentionner l\'offre cybers\u00E9curit\u00E9")'}
              value={form.emailPrompt} onChange={e => setForm(p => ({ ...p, emailPrompt: e.target.value }))}
              className="form-input"
              style={{ fontSize: 13, padding: '8px 12px', minHeight: 80, resize: 'vertical' }}
            />

            {/* Tone */}
            <div style={{ display: 'flex', gap: 6 }}>
              {['professional', 'casual', 'direct', 'warm'].map(tone => (
                <button key={tone} onClick={() => setForm(p => ({ ...p, emailTone: tone }))} style={{
                  padding: '4px 12px', fontSize: 11, borderRadius: 8,
                  border: `1px solid ${form.emailTone === tone ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.emailTone === tone ? 'rgba(110,87,250,0.1)' : 'transparent',
                  color: form.emailTone === tone ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}>
                  {tone}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                {en ? 'Cancel' : 'Annuler'}
              </button>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={handleCreate} disabled={!form.name.trim()}>
                {en ? 'Create campaign' : 'Cr\u00E9er la campagne'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign list */}
      {campaigns.length === 0 && !showCreate && (
        <div style={{
          textAlign: 'center', padding: 50, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>{'\uD83D\uDCE8'}</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {en ? 'No team campaigns yet' : 'Aucune campagne \u00E9quipe'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {campaigns.map(c => {
          const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
          return (
            <div key={c.id} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {en ? 'by' : 'par'} {c.created_by_name} {'\u00B7'} {new Date(c.created_at).toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 6,
                  background: `${color}15`, color, fontWeight: 600,
                }}>
                  {STATUS_LABELS[c.status] || c.status}
                </span>
              </div>

              {/* Stats */}
              {c.total_contacts > 0 && (
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
                  <span>{c.total_contacts} contacts</span>
                  {c.sent_count > 0 && <span style={{ color: 'var(--success)' }}>{c.sent_count} {en ? 'sent' : 'envoy\u00E9s'}</span>}
                  {c.failed_count > 0 && <span style={{ color: 'var(--danger)' }}>{c.failed_count} {en ? 'failed' : '\u00E9chec'}</span>}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {c.status === 'draft' && (
                  <>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => handlePreview(c.id)} disabled={previewing === c.id}>
                      {previewing === c.id ? '...' : (en ? 'Preview' : 'Aper\u00E7u')}
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => handleLaunch(c.id)} disabled={launching === c.id}>
                      {launching === c.id ? '...' : (en ? 'Launch' : 'Lancer')}
                    </button>
                  </>
                )}
                {c.status === 'completed' && (
                  <span style={{ fontSize: 11, color: 'var(--success)' }}>
                    {'\u2705'} {en ? 'Completed' : 'Termin\u00E9e'}
                  </span>
                )}
              </div>

              {/* Preview results */}
              {previewData && previewedId === c.id && previewing === null && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    {en ? `${previewData.totalContacts} contacts targeted` : `${previewData.totalContacts} contacts cibl\u00E9s`}
                  </div>
                  {(previewData.previews || []).map((p, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                      marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {p.ownerEmail || (en ? 'Unassigned' : 'Non assign\u00E9')} ({p.contactCount} contacts)
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {p.contacts.map(c => c.name).join(', ')}{p.contactCount > 5 ? '...' : ''}
                      </div>
                      {p.sampleEmail && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{p.sampleEmail.subject}</div>
                          <div style={{ color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.sampleEmail.body}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
