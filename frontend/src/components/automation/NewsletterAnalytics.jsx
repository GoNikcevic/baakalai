/* ===============================================================================
   BAKAL · Analytics des emails Salesforce / Fonteva

   Lecture d'EmailMessage dans Salesforce. Le bloc s'affichait pour tout le
   monde et renvoyait « Salesforce non connecté » à la majorité : il n'est
   désormais monté que lorsque Salesforce est effectivement connecté
   (voir ResultsSection).
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';

export default function NewsletterAnalytics() {
  const t = useT();
  const { lang } = useI18n();
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

  const EMAIL_STATUS = { '0': en ? 'New' : 'Nouveau', '1': en ? 'Read' : 'Lu', '2': en ? 'Replied' : 'Répondu', '3': en ? 'Sent' : 'Envoyé', '4': en ? 'Forwarded' : 'Transféré', '5': en ? 'Draft' : 'Brouillon' };
  const STATUS_COLORS = { '0': '#94A3B8', '1': '#3B82F6', '2': '#16A34A', '3': '#6E57FA', '4': '#F59E0B', '5': '#CBD5E1' };

  if (error) {
    return (
      <div style={{ padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>
        {en ? 'Salesforce EmailMessage not accessible' : 'EmailMessage Salesforce non accessible'} · {error}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {en ? 'Emails sent from Salesforce / Fonteva, outside baakalai' : 'Emails partis de Salesforce / Fonteva, hors baakalai'}
        </div>
        <select
          value={since}
          onChange={e => setSince(e.target.value)}
          className="form-input"
          style={{ width: 160, fontSize: 12, padding: '6px 10px' }}
          aria-label={en ? 'Period' : 'Période'}
        >
          <option value="LAST_N_DAYS:30">{en ? 'Last 30 days' : '30 derniers jours'}</option>
          <option value="LAST_N_DAYS:90">{en ? 'Last 90 days' : '90 derniers jours'}</option>
          <option value="LAST_N_DAYS:180">{en ? 'Last 6 months' : '6 derniers mois'}</option>
          <option value="LAST_N_DAYS:365">{en ? 'Last year' : 'Dernière année'}</option>
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
      ) : (
        <>
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
              {[
                { label: en ? 'Total' : 'Total', value: stats.total, color: 'var(--text-primary)' },
                { label: en ? 'Sent' : 'Envoyés', value: stats.sent, color: '#6E57FA' },
                { label: en ? 'Read' : 'Lus', value: stats.read, color: '#3B82F6' },
                { label: en ? 'Replied' : 'Répondus', value: stats.replied, color: '#16A34A' },
                { label: en ? 'Forwarded' : 'Transférés', value: stats.forwarded, color: '#F59E0B' },
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
                {en ? 'Recent emails' : 'Emails récents'} ({emails.length})
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
                        {e.to} · {new Date(e.createdAt).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}
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

          {emails.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              <Icon name="mail" size={20} strokeWidth={1.5} style={{ display: 'block', margin: '0 auto 8px' }} />
              {en ? 'No email messages found in Salesforce for this period' : 'Aucun email trouvé dans Salesforce pour cette période'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
