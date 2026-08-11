/* ===============================================================================
   BAKAL — Nurture Page
   Configure triggers, view pending/sent emails, manage client nurturing.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { getUser } from '../services/auth';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';
import { useConfirm } from '../components/ConfirmModal';

function getTriggerTypes(lang) {
  const en = lang === 'en';
  return [
    { value: 'deal_won', label: en ? 'Deal won' : 'Deal gagn\u00E9', desc: en ? 'Welcome/onboarding email when a deal is won' : 'Email de bienvenue quand un deal est gagn\u00E9', icon: '\uD83C\uDF89', defaultDays: 1, defaultName: en ? 'Welcome new client' : 'Bienvenue nouveau client' },
    { value: 'deal_stagnant', label: en ? 'Stagnant deal' : 'Deal stagnant', desc: en ? 'Follow up when a deal is inactive for X days' : 'Relancer quand un deal est inactif depuis X jours', icon: '\u23F0', defaultDays: 30, defaultName: en ? 'Stagnant deal follow-up' : 'Relance deals stagnants' },
    { value: 'inactive_contact', label: en ? 'Inactive contact' : 'Contact inactif', desc: en ? 'Re-engage a contact with no activity for X days' : 'R\u00E9engager un contact sans activit\u00E9 depuis X jours', icon: '\uD83D\uDCA4', defaultDays: 60, defaultName: en ? 'Re-engage inactive contacts' : 'R\u00E9activation contacts inactifs' },
    { value: 'deal_lost', label: en ? 'Deal lost' : 'Deal perdu', desc: en ? 'Win-back email after a lost deal' : 'Email de suivi apr\u00E8s un deal perdu', icon: '\uD83D\uDC94', defaultDays: 14, defaultName: en ? 'Win-back lost deals' : 'Win-back deals perdus' },
    { value: 'onboarding_check', label: en ? 'Onboarding check' : 'Check onboarding', desc: en ? 'Check adoption X days after signing' : 'V\u00E9rifier la prise en main X jours apr\u00E8s signature', icon: '\uD83D\uDE80', defaultDays: 7, defaultName: en ? 'Onboarding follow-up D+7' : 'Suivi onboarding J+7' },
    { value: 'renewal_reminder', label: en ? 'Renewal' : 'Renouvellement', desc: en ? 'Reminder X days before renewal date' : 'Rappel X jours avant la date de renouvellement', icon: '\uD83D\uDD14', defaultDays: 30, defaultName: en ? 'Renewal reminder' : 'Rappel renouvellement' },
    { value: 'upsell_opportunity', label: en ? 'Upsell opportunity' : 'Opportunit\u00E9 upsell', desc: en ? 'Suggest upgrade to active clients after X days' : 'Proposer un upgrade aux clients actifs depuis X jours', icon: '\u2B06\uFE0F', defaultDays: 90, defaultName: en ? 'Upsell proposal' : 'Proposition upsell' },
    { value: 'feedback_request', label: en ? 'Feedback request' : 'Demande de feedback', desc: en ? 'Ask for feedback after X days' : 'Demander un retour d\'exp\u00E9rience apr\u00E8s X jours', icon: '\u2B50', defaultDays: 30, defaultName: en ? 'Testimonial request' : 'Demande de t\u00E9moignage' },
    { value: 'newsletter_inactive', label: en ? 'Newsletter inactive' : 'Newsletter inactif', desc: en ? 'Re-engage contacts who never open newsletters (Salesforce/Fonteva)' : 'R\u00E9engager les contacts qui n\'ouvrent pas les newsletters (Salesforce/Fonteva)', icon: '\uD83D\uDCE7', defaultDays: 30, defaultName: en ? 'Newsletter re-engagement' : 'R\u00E9activation newsletter' },
    { value: 'newsletter_engaged', label: en ? 'Newsletter engaged' : 'Newsletter engag\u00E9', desc: en ? 'Notify sales when contacts actively engage with newsletters (Salesforce/Fonteva)' : 'Alerter le commercial quand un contact engage avec les newsletters (Salesforce/Fonteva)', icon: '\uD83D\uDD25', defaultDays: 30, defaultName: en ? 'Hot newsletter lead' : 'Lead chaud newsletter' },
  ];
}

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
    if (!campaignsByTrigger[key]) campaignsByTrigger[key] = { trigger: e.trigger_name || (lang === 'en' ? 'Manual send' : 'Envoi manuel'), emails: [] };
    campaignsByTrigger[key].emails.push(e);
  }

  const tabs = [
    { key: 'dashboard', label: t('activation.overview'), count: null },
    { key: 'campaigns', label: t('activation.campaigns'), count: Object.keys(campaignsByTrigger).length },
    { key: 'triggers', label: t('activation.triggers'), count: triggers.length },
    { key: 'pending', label: t('activation.pending'), count: emails.filter(e => e.status === 'pending').length },
    { key: 'sent', label: t('activation.sent'), count: sentEmails.length },
    { key: 'autopilot', label: lang === 'en' ? 'Autopilot' : 'Autopilot', count: null },
    { key: 'ab', label: 'A/B Tests', count: null },
    { key: 'newsletters', label: lang === 'en' ? 'Newsletters' : 'Newsletters', count: null },
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
                showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: err.message });
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
                {previews.length} trigger{previews.length > 1 ? 's' : ''} {lang === 'en' ? 'active' : ('actif' + (previews.length > 1 ? 's' : ''))}
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
                      showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: err.message });
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
                  {p.manualOnly
                    ? t('activation.manualOnlyTrigger')
                    : <>{p.contactsCount} contact{p.contactsCount > 1 ? 's' : ''} {'\u00B7'} mode {p.mode === 'auto' ? 'auto' : (lang === 'en' ? 'approval' : 'approbation')}</>}
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
                    +{p.contactsCount - 5} {lang === 'en' ? 'more' : 'autres'}
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
                    {lang === 'en' ? `Sample email for ${p.contacts[0]?.name || 'a contact'}:` : `Exemple d'email pour ${p.contacts[0]?.name || 'un contact'} :`}
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
      {!loading && activeTab === 'autopilot' && <AutopilotSection lang={lang} />}
      {!loading && activeTab === 'ab' && <ABResultsSection lang={lang} />}
      {!loading && activeTab === 'newsletters' && <NewsletterAnalyticsSection lang={lang} />}
      {!loading && activeTab === 'team' && <TeamCampaignsSection lang={lang} />}
    </div>
  );
}

/* ═══ Triggers Section ═══ */

function TriggersSection({ triggers, onRefresh, showCreate, setShowCreate }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const confirm = useConfirm();
  const TRIGGER_TYPES = getTriggerTypes(lang);
  const [form, setForm] = useState({
    name: '',
    triggerType: 'deal_stagnant',
    actionType: 'email',
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
          actionType: form.actionType,
          conditions: { days: parseInt(form.days, 10) || 30 },
          mode: form.actionType.startsWith('linkedin_') ? 'auto' : form.mode,
          emailTemplate: { tone: form.tone },
        }),
      });
      setShowCreate(false);
      setForm({ name: '', triggerType: 'deal_stagnant', actionType: 'email', days: 30, mode: 'approval', tone: 'professionnel mais chaleureux' });
      onRefresh();
    } catch (err) {
      showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: err.message });
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
    } catch { showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: lang === 'en' ? 'Failed to update trigger' : 'Échec de mise à jour du trigger' }); }
  };

  const handleDelete = async (id) => {
    if (!await confirm(en ? 'Delete this trigger?' : 'Supprimer ce trigger ?', { danger: true })) return;
    try {
      await request(`/nurture/triggers/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch { showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: lang === 'en' ? 'Operation failed' : 'Opération échouée' }); }
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
                placeholder={lang === 'en' ? 'Trigger name (e.g., Stagnant deal follow-up)' : 'Nom du trigger (ex: Relance deals stagnants)'}
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
                  placeholder={lang === 'en' ? 'Days' : 'Jours'}
                  value={form.days}
                  onChange={e => setForm(p => ({ ...p, days: e.target.value }))}
                  className="form-input"
                  style={{ width: 80, fontSize: 13, padding: '8px 12px' }}
                />
                <select
                  value={form.actionType}
                  onChange={e => setForm(p => ({ ...p, actionType: e.target.value }))}
                  className="form-input"
                  style={{ width: 160, fontSize: 13, padding: '8px 12px' }}
                >
                  <option value="email">{'\u2709\uFE0F'} Email</option>
                  <option value="linkedin_connect">{'\uD83D\uDD17'} LinkedIn Connect</option>
                  <option value="linkedin_message">{'\uD83D\uDCAC'} LinkedIn Message</option>
                  <option value="linkedin_visit">{'\uD83D\uDC41\uFE0F'} LinkedIn Visit</option>
                </select>
                {!form.actionType.startsWith('linkedin_') && (
                  <select
                    value={form.mode}
                    onChange={e => setForm(p => ({ ...p, mode: e.target.value }))}
                    className="form-input"
                    style={{ width: 140, fontSize: 13, padding: '8px 12px' }}
                  >
                    <option value="approval">{lang === 'en' ? 'Approval' : 'Approbation'}</option>
                    <option value="auto">{lang === 'en' ? 'Automatic' : 'Automatique'}</option>
                  </select>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                  {lang === 'en' ? 'Cancel' : 'Annuler'}
                </button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleCreate} disabled={saving || !form.name}>
                  {saving ? '...' : (lang === 'en' ? 'Create' : 'Cr\u00e9er')}
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
                      {' \u00B7 '} {lang === 'en' ? 'Mode' : 'Mode'}: {trigger.mode === 'auto' ? (lang === 'en' ? 'automatic' : 'automatique') : (lang === 'en' ? 'approval' : 'approbation')}
                      {trigger.last_run && ` \u00B7 ${lang === 'en' ? 'Last run:' : 'Dernier run :'} ${new Date(trigger.last_run).toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR')}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      style={{
                        fontSize: 10, padding: '4px 10px',
                        color: trigger.ab_enabled ? 'var(--accent)' : 'var(--text-muted)',
                        border: `1px solid ${trigger.ab_enabled ? 'var(--accent)' : 'var(--border)'}`,
                        background: trigger.ab_enabled ? 'rgba(110,87,250,0.06)' : 'transparent',
                      }}
                      onClick={async () => {
                        try {
                          await request(`/nurture/triggers/${trigger.id}`, { method: 'PATCH', body: JSON.stringify({ abEnabled: !trigger.ab_enabled }) });
                          onRefresh();
                        } catch { showToast({ type: 'error', title: lang === 'en' ? 'Error' : 'Erreur', message: lang === 'en' ? 'Failed to toggle A/B' : 'Échec du basculement A/B' }); }
                      }}
                    >
                      A/B {trigger.ab_enabled ? 'ON' : 'OFF'}
                    </button>
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
                      {lang === 'en' ? 'Delete' : 'Supprimer'}
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
  const { lang } = useI18n();
  const en = lang === 'en';
  // emails est une prop : l'état déplié/replié vit ici, pas chez le parent.
  const [expandedIds, setExpandedIds] = useState(new Set());
  const toggleExpanded = (id, value) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      const expand = value !== undefined ? value : !next.has(id);
      if (expand) next.add(id); else next.delete(id);
      return next;
    });
  };
  const handleApprove = async (id) => {
    try {
      await request(`/nurture/emails/${id}/approve`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message });
    }
  };

  const handleCancel = async (id) => {
    try {
      await request(`/nurture/emails/${id}/cancel`, { method: 'POST' });
      onRefresh();
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Operation failed' : 'Opération échouée' }); }
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
                <div
                  style={{
                    fontSize: 12, color: 'var(--text-secondary)', marginTop: 6,
                    whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    maxHeight: expandedIds.has(email.id) ? 'none' : 80, overflow: 'hidden',
                    cursor: 'pointer',
                  }}
                  onClick={() => toggleExpanded(email.id)}
                  title={en ? 'Click to expand/collapse' : 'Cliquer pour d\u00E9plier/replier'}
                >
                  {email.body}
                </div>
                {!expandedIds.has(email.id) && email.body && email.body.length > 200 && (
                  <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2, cursor: 'pointer' }}
                    onClick={() => toggleExpanded(email.id, true)}
                  >
                    {en ? 'Show full email' : 'Voir l\'email complet'}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  {email.to_email}
                  {email.sent_at && ` \u00B7 ${en ? 'Sent on' : 'Envoy\u00E9 le'} ${new Date(email.sent_at).toLocaleString(en ? 'en-US' : 'fr-FR')}`}
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
                    {en ? 'Send' : 'Envoyer'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 12px', color: 'var(--danger)' }}
                    onClick={() => handleCancel(email.id)}
                  >
                    {en ? 'Cancel' : 'Annuler'}
                  </button>
                </div>
              )}

              {type === 'sent' && (
                <span style={{ fontSize: 11, color: 'var(--success)', whiteSpace: 'nowrap' }}>
                  {'\u2705'} {en ? 'Sent' : `Envoy${'\u00E9'}`}
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

function getSegmentConfig(lang) {
  const en = lang === 'en';
  return [
    { key: 'active', label: en ? 'Active' : 'Actifs', color: 'var(--success)', icon: '\u2705' },
    { key: 'won', label: en ? 'Won' : 'Gagn\u00E9s', color: 'var(--purple)', icon: '\uD83C\uDFC6' },
    { key: 'stagnant', label: en ? 'Stagnant' : 'Stagnants', color: 'var(--warning)', icon: '\u23F0' },
    { key: 'churnRisk', label: en ? 'Churn risk' : 'Risque churn', color: 'var(--danger)', icon: '\u26A0\uFE0F' },
  ];
}

function ActivationDashboard({ metrics }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const SEGMENT_CONFIG = getSegmentConfig(lang);
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
          <div className="card-header"><div className="card-title">{'\u23F0'} {en ? 'Stagnant deals' : 'Deals stagnants'}</div></div>
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
          <div className="card-header"><div className="card-title">{'\u26A0\uFE0F'} {en ? 'Churn risk' : 'Risque de churn'}</div></div>
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
          <div className="card-header"><div className="card-title">{'\u2709\uFE0F'} {en ? 'Emails (30d)' : 'Emails (30j)'}</div></div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              {[
                { label: en ? 'Sent' : 'Envoy\u00E9s', value: emailsLast30d?.sent || 0, color: 'var(--success)' },
                { label: en ? 'Pending' : 'En attente', value: emailsLast30d?.pending || 0, color: 'var(--warning)' },
                { label: en ? 'Failed' : '\u00C9chou\u00E9s', value: emailsLast30d?.failed || 0, color: 'var(--danger)' },
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
          <div className="card-header"><div className="card-title">{'\u26A1'} {en ? 'Active triggers' : 'Triggers actifs'}</div></div>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{triggers?.active || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'of' : 'sur'} {triggers?.total || 0}</div>
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
  const { lang } = useI18n();
  const en = lang === 'en';
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
                  {total} email{total > 1 ? 's' : ''} {en ? 'sent' : (`envoy${'\u00E9'}${total > 1 ? 's' : ''}`)}
                  {' \u00B7 '}{uniqueContacts} contact{uniqueContacts > 1 ? 's' : ''}
                  {firstSent && ` \u00B7 ${firstSent.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })} \u2192 ${lastSent.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}`}
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
                            {en ? 'Analyzed' : `Analys${'\u00E9'}`}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--paper-3)', color: 'var(--grey-500)' }}>
                            {en ? 'Pending' : 'En attente'}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {e.sent_at ? new Date(e.sent_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' }) : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                  {emailList.length > 20 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                      +{emailList.length - 20} {en ? 'more' : 'autres'}
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
  const confirm = useConfirm();
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
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Failed to create campaign' : 'Échec de création de la campagne' }); }
  };

  const handlePreview = async (id) => {
    setPreviewing(id);
    setPreviewData(null);
    setPreviewedId(id);
    try {
      const data = await request(`/team-campaigns/${id}/preview`, { method: 'POST' });
      setPreviewData(data);
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Preview failed' : 'Échec de l\'aperçu' }); }
    setPreviewing(null);
  };

  const handleLaunch = async (id) => {
    if (!await confirm(en ? 'Launch this campaign? Emails will be sent from each rep\'s inbox.' : 'Lancer cette campagne ? Les emails seront envoy\u00E9s depuis la bo\u00EEte de chaque commercial.')) return;
    setLaunching(id);
    try {
      await request(`/team-campaigns/${id}/launch`, { method: 'POST' });
      await load();
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Launch failed' : 'Échec du lancement' }); }
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

/* ═══ Autopilot Section ═══ */

function AutopilotSection({ lang }) {
  const en = lang === 'en';
  const [settings, setSettings] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      request('/crm/autopilot/settings').catch(() => ({ enabled: false })),
      request('/crm/autopilot/queue').catch(() => ({ queue: [] })),
    ]).then(([s, q]) => {
      setSettings(s);
      setQueue(q.queue || []);
    }).finally(() => setLoading(false));
  }, []);

  const toggleEnabled = async () => {
    const next = !settings?.enabled;
    try {
      await request('/crm/autopilot/settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setSettings(prev => ({ ...prev, enabled: next }));
      showToast({ type: 'success', title: 'Autopilot', message: next ? (en ? 'Enabled' : 'Activé') : (en ? 'Disabled' : 'Désactivé') });
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message });
    }
  };

  const cancelMessage = async (id) => {
    try {
      await request(`/crm/autopilot/queue/${id}`, { method: 'DELETE' });
      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'cancelled' } : q));
    } catch { /* ignore */ }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{en ? 'Loading...' : 'Chargement...'}</div>;

  const pending = queue.filter(q => q.status === 'pending');
  const sent = queue.filter(q => q.status === 'sent');

  return (
    <div>
      {/* Settings card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                {'\uD83E\uDD16'} {en ? 'Conversation Autopilot' : 'Autopilot de conversation'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {en
                  ? 'AI manages replies to your prospects until a meeting is booked. Max 5 turns, 2-4h delay between responses.'
                  : 'L\'IA gère les réponses à vos prospects jusqu\'à ce qu\'un RDV soit fixé. Max 5 tours, 2-4h entre chaque réponse.'}
              </div>
            </div>
            <button
              className={`btn ${settings?.enabled ? 'btn-success' : 'btn-outline'}`}
              style={{ fontSize: 12, padding: '8px 18px', minWidth: 90 }}
              onClick={toggleEnabled}
            >
              {settings?.enabled ? (en ? 'Active' : 'Actif') : (en ? 'Enable' : 'Activer')}
            </button>
          </div>
        </div>
      </div>

      {/* How it works */}
      {!settings?.enabled && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--bg-elevated)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{en ? 'How it works' : 'Comment ça marche'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              {[
                en ? '1. A prospect replies to your email or LinkedIn message' : '1. Un prospect répond à votre email ou message LinkedIn',
                en ? '2. AI analyzes the intent (interested, question, meeting request...)' : '2. L\'IA analyse l\'intent (intéressé, question, demande de RDV...)',
                en ? '3. AI generates a contextual reply using your conversation history + learned patterns' : '3. L\'IA génère une réponse contextuelle avec l\'historique + les patterns appris',
                en ? '4. Reply is sent after 2-4 hours (human-like delay)' : '4. La réponse est envoyée après 2-4h (délai naturel)',
                en ? '5. Conversation continues until a meeting is accepted or max 5 turns' : '5. La conversation continue jusqu\'au RDV accepté ou max 5 tours',
              ].map((step, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6, borderLeft: '2px solid var(--primary)' }}>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pending queue */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {'\u23F3'} {en ? `${pending.length} pending reply(ies)` : `${pending.length} réponse(s) en attente`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map(q => {
              const content = typeof q.content === 'string' ? (() => { try { return JSON.parse(q.content); } catch { return {}; } })() : (q.content || {});
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {q.channel === 'linkedin' ? '\uD83D\uDCAC' : '\u2709\uFE0F'} {q.to_name || q.to_email}
                          {q.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {q.company}</span>}
                        </div>
                        {content.subject && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{content.subject}</div>}
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                          {content.body || content.message || ''}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {en ? 'Scheduled:' : 'Planifié :'} {new Date(q.scheduled_at).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={() => cancelMessage(q.id)}>
                        {en ? 'Cancel' : 'Annuler'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sent history */}
      {sent.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {'\u2705'} {en ? `${sent.length} auto-reply(ies) sent` : `${sent.length} réponse(s) auto envoyée(s)`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sent.slice(0, 20).map(q => {
              const content = typeof q.content === 'string' ? (() => { try { return JSON.parse(q.content); } catch { return {}; } })() : (q.content || {});
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--success)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {q.channel === 'linkedin' ? '\uD83D\uDCAC' : '\u2709\uFE0F'} {q.to_name || q.to_email}
                      {q.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {q.company}</span>}
                    </div>
                    {content.subject && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{content.subject}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                      {content.body || content.message || ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {settings?.enabled && pending.length === 0 && sent.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{'\uD83E\uDD16'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {en ? 'Autopilot is active. Replies will appear here when prospects respond.' : 'L\'autopilot est actif. Les réponses apparaîtront ici quand vos prospects répondront.'}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ A/B Results Section ═══ */

function ABResultsSection({ lang }) {
  const en = lang === 'en';
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request('/nurture/ab-results')
      .then(data => setTests(data.tests || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{en ? 'Loading...' : 'Chargement...'}</div>;

  if (tests.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
        {en ? 'No A/B tests yet. Enable A/B on your triggers to start testing.' : 'Aucun test A/B. Active le A/B sur tes triggers pour commencer.'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tests.map(test => {
        const a = test.variants?.A;
        const b = test.variants?.B;
        if (!a && !b) return null;

        const totalSent = (a?.sent || 0) + (b?.sent || 0);
        const winner = a && b ? (a.replyRate > b.replyRate ? 'A' : b.replyRate > a.replyRate ? 'B' : null) : null;
        const diff = a && b ? Math.abs(a.replyRate - b.replyRate) : 0;
        const significant = totalSent >= 10 && diff >= 10;

        return (
          <div key={test.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: '20px 24px',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {test.startedAt ? new Date(test.startedAt).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                {' · '}{totalSent} {en ? 'emails sent' : 'emails envoyés'}
              </div>
              {winner && significant && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                  background: '#DCFCE7', color: '#16A34A',
                }}>
                  {en ? `Variant ${winner} wins (+${diff}pts)` : `Variante ${winner} gagne (+${diff}pts)`}
                </span>
              )}
              {!significant && totalSent >= 4 && (
                <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, background: '#FEF3C7', color: '#D97706' }}>
                  {en ? 'Not enough data yet' : 'Pas assez de données'}
                </span>
              )}
            </div>

            {/* Variants comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['A', 'B'].map(variant => {
                const v = test.variants?.[variant];
                if (!v) return <div key={variant} />;
                const isWinner = winner === variant && significant;
                return (
                  <div key={variant} style={{
                    padding: 14, borderRadius: 10,
                    border: `2px solid ${isWinner ? '#16A34A' : 'var(--border)'}`,
                    background: isWinner ? 'rgba(22,163,74,0.03)' : 'var(--bg-elevated)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>
                        {en ? 'Variant' : 'Variante'} {variant}
                        {isWinner ? ' 🏆' : ''}
                      </span>
                      <span style={{
                        fontSize: 20, fontWeight: 800,
                        color: v.replyRate >= 20 ? '#16A34A' : v.replyRate >= 10 ? '#D97706' : 'var(--text-primary)',
                      }}>
                        {v.replyRate}%
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {v.sent} {en ? 'sent' : 'envoyés'} · {v.replies} {en ? 'replies' : 'réponses'}
                    </div>
                    {/* Reply rate bar */}
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, transition: 'width 0.5s',
                        width: `${Math.min(v.replyRate, 100)}%`,
                        background: isWinner ? '#16A34A' : 'var(--accent)',
                      }} />
                    </div>
                    {v.sampleSubject && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        "{v.sampleSubject}"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══ Newsletter Analytics Section (Salesforce/Fonteva emails) ═══ */

function NewsletterAnalyticsSection({ lang }) {
  const en = lang === 'en';
  const [stats, setStats] = useState(null);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [since, setSince] = useState('LAST_N_DAYS:90');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsData, emailsData] = await Promise.all([
          request(`/crm/salesforce/email-stats?since=${since}`),
          request(`/crm/salesforce/emails?since=${since}&limit=100`),
        ]);
        if (!cancelled) {
          setStats(statsData);
          setEmails(emailsData.emails || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [since]);

  const EMAIL_STATUS = { '0': en ? 'New' : 'Nouveau', '1': en ? 'Read' : 'Lu', '2': en ? 'Replied' : 'R\u00E9pondu', '3': en ? 'Sent' : 'Envoy\u00E9', '4': en ? 'Forwarded' : 'Transf\u00E9r\u00E9', '5': en ? 'Draft' : 'Brouillon' };
  const STATUS_COLORS = { '0': '#94A3B8', '1': '#3B82F6', '2': '#16A34A', '3': '#6E57FA', '4': '#F59E0B', '5': '#CBD5E1' };

  if (error) {
    return (
      <div className="card" style={{ padding: 30, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{'\uD83D\uDCE7'}</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>
          {en ? 'Salesforce not connected or EmailMessage not accessible' : 'Salesforce non connect\u00E9 ou EmailMessage non accessible'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--grey-400)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {en ? 'Salesforce / Fonteva Email Analytics' : 'Analytics emails Salesforce / Fonteva'}
        </div>
        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="form-input"
          style={{ width: 160, fontSize: 12, padding: '6px 10px' }}
        >
          <option value="LAST_N_DAYS:30">{en ? 'Last 30 days' : '30 derniers jours'}</option>
          <option value="LAST_N_DAYS:90">{en ? 'Last 90 days' : '90 derniers jours'}</option>
          <option value="LAST_N_DAYS:180">{en ? 'Last 6 months' : '6 derniers mois'}</option>
          <option value="LAST_N_DAYS:365">{en ? 'Last year' : 'Derni\u00E8re ann\u00E9e'}</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{en ? 'Loading...' : 'Chargement...'}</div>
      ) : (
        <>
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
              {[
                { label: en ? 'Total' : 'Total', value: stats.total, color: 'var(--text-primary)' },
                { label: en ? 'Sent' : 'Envoy\u00E9s', value: stats.sent, color: '#6E57FA' },
                { label: en ? 'Read' : 'Lus', value: stats.read, color: '#3B82F6' },
                { label: en ? 'Replied' : 'R\u00E9pondus', value: stats.replied, color: '#16A34A' },
                { label: en ? 'Forwarded' : 'Transf\u00E9r\u00E9s', value: stats.forwarded, color: '#F59E0B' },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {stats && stats.total > 0 && (
            <div className="card" style={{ padding: '14px 18px', marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{en ? 'Engagement rate' : 'Taux d\'engagement'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                  {Math.round(((stats.read + stats.replied + stats.forwarded) / stats.total) * 100)}%
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--paper-2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${Math.round(((stats.read + stats.replied + stats.forwarded) / stats.total) * 100)}%`,
                  background: 'linear-gradient(90deg, var(--accent), var(--lavender))',
                }} />
              </div>
            </div>
          )}

          {emails.length > 0 && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
                {en ? 'Recent emails' : 'Emails r\u00E9cents'} ({emails.length})
              </div>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {emails.map(e => (
                  <div key={e.id} style={{
                    padding: '10px 18px', borderBottom: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.subject || (en ? '(no subject)' : '(sans objet)')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {e.to} &middot; {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 'var(--r-full)',
                      background: `${STATUS_COLORS[e.status] || '#94A3B8'}18`,
                      color: STATUS_COLORS[e.status] || '#94A3B8',
                      fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {EMAIL_STATUS[e.status] || e.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {emails.length === 0 && !loading && (
            <div className="card" style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                {en ? 'No email messages found in Salesforce for this period' : 'Aucun email trouv\u00E9 dans Salesforce pour cette p\u00E9riode'}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
