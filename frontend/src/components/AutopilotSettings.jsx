/* ===============================================================================
   BAKAL — Autopilot de réponse (réglage cadré sur une population)

   Un seul moteur, deux portées. Répondre tout seul à un inconnu qui répond à
   une séquence froide et répondre tout seul dans une conversation avec un
   client qui paie n'engagent pas le même risque : chaque population a donc son
   interrupteur, et sa file.

   Ce composant remplace deux copies quasi identiques (page Prospection et page
   Activation) qui commandaient le même interrupteur global sous deux noms
   contradictoires — l'activer d'un côté le montrait actif de l'autre.

   `scope` vaut 'prospection' (prospects froids issus d'une campagne) ou 'crm'
   (contacts et clients synchronisés depuis le CRM). Voir backend/lib/crm-scope.js.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';
import Icon from './Icon';

export default function AutopilotSettings({ scope }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  const [settings, setSettings] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  // `scope` est fixe pour un point de montage donné (Prospection monte la portée
  // prospection, Activation la portée CRM) : l'état initial `loading` suffit,
  // inutile de le remettre à true dans l'effet — ce que React déconseille.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      request('/crm/autopilot/settings').catch(() => ({})),
      request(`/crm/autopilot/queue?scope=${scope}`).catch(() => ({ queue: [] })),
    ]).then(([s, q]) => {
      if (cancelled) return;
      setSettings(s);
      setQueue(q.queue || []);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const enabled = !!settings?.[scope];

  const toggleEnabled = async () => {
    const next = !enabled;
    try {
      await request('/crm/autopilot/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [scope]: next }),
      });
      setSettings(prev => ({ ...prev, [scope]: next }));
      showToast({
        type: 'success',
        title: t('autopilot.title'),
        message: next ? t('autopilot.enabled') : t('autopilot.disabled'),
      });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  const cancelMessage = async (id) => {
    try {
      await request(`/crm/autopilot/queue/${id}`, { method: 'DELETE' });
      setQueue(prev => prev.map(q => (q.id === id ? { ...q, status: 'cancelled' } : q)));
    } catch { /* la ligne reste affichée telle quelle */ }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        {t('common.loading')}
      </div>
    );
  }

  const pending = queue.filter(q => q.status === 'pending');
  const sent = queue.filter(q => q.status === 'sent');
  const fmt = (d) => new Date(d).toLocaleString(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const parseContent = (c) => {
    if (typeof c !== 'string') return c || {};
    try { return JSON.parse(c); } catch { return {}; }
  };

  const steps = [
    scope === 'crm' ? t('autopilot.stepCrm1') : t('autopilot.stepProspection1'),
    t('autopilot.step2'), t('autopilot.step3'), t('autopilot.step4'), t('autopilot.step5'),
  ];

  return (
    <div>
      {/* Interrupteur de cette portée uniquement */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="bot" size={15} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                {scope === 'crm' ? t('autopilot.titleCrm') : t('autopilot.titleProspection')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, maxWidth: 560 }}>
                {scope === 'crm' ? t('autopilot.descCrm') : t('autopilot.descProspection')}
              </div>
            </div>
            <button
              className={`btn ${enabled ? 'btn-success' : 'btn-outline'}`}
              style={{ fontSize: 12, padding: '8px 18px', minWidth: 90, flexShrink: 0 }}
              onClick={toggleEnabled}
            >
              {enabled ? t('autopilot.active') : t('autopilot.enable')}
            </button>
          </div>
        </div>
      </div>

      {!enabled && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--bg-elevated)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{t('autopilot.howItWorks')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              {steps.map((step, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6, borderLeft: '2px solid var(--primary)' }}>
                  {i + 1}. {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            <Icon name="clock" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {t('autopilot.pendingCount', { count: pending.length })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map(q => {
              const content = parseContent(q.content);
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          <Icon name={q.channel === 'linkedin' ? 'message' : 'mail'} size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                          {q.contact_name || q.to_name || q.to_email}
                          {q.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {q.company}</span>}
                        </div>
                        {content.subject && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{content.subject}</div>}
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                          {content.body || content.message || ''}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {t('autopilot.sendsAt')} {fmt(q.scheduled_at)}
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)', flexShrink: 0 }}
                        onClick={() => cancelMessage(q.id)}
                      >
                        {t('autopilot.cancel')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            <Icon name="checkCircle" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {t('autopilot.sentCount', { count: sent.length })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sent.slice(0, 20).map(q => {
              const content = parseContent(q.content);
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--success)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      <Icon name={q.channel === 'linkedin' ? 'message' : 'mail'} size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                          {q.contact_name || q.to_name || q.to_email}
                      {q.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {q.company}</span>}
                    </div>
                    {content.subject && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{content.subject}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                      {content.body || content.message || ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {t('autopilot.sentAt')} {fmt(q.sent_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {enabled && pending.length === 0 && sent.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Icon name="bot" size={28} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {scope === 'crm' ? t('autopilot.emptyCrm') : t('autopilot.emptyProspection')}
          </div>
        </div>
      )}
    </div>
  );
}
