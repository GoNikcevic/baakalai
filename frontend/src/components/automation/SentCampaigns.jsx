/* ===============================================================================
   BAKAL · Envois groupés par règle (ex-onglet « Séquences »)

   Le nom « Séquences » désignait ici un regroupement d'emails déjà envoyés,
   alors que les vraies séquences sont les workflows de relance. Renommé en
   « Envois par règle » et rangé dans Résultats, là où on regarde ce qui est
   parti · plus ce qu'on va faire.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';

export default function SentCampaigns() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    request('/nurture/emails?status=sent&limit=200')
      .then(d => setEmails(d.emails || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;
  }

  // Regroupement par règle : un envoi sans trigger vient d'une action manuelle.
  const campaigns = {};
  for (const e of emails) {
    const key = e.trigger_id || 'manual';
    if (!campaigns[key]) campaigns[key] = { trigger: e.trigger_name || (en ? 'Manual send' : 'Envoi manuel'), emails: [] };
    campaigns[key].emails.push(e);
  }
  const keys = Object.keys(campaigns);
  // Le plafond serveur est de 200 lignes : le dire, plutôt que de laisser
  // croire que ce tableau couvre tout l'historique.
  const truncated = emails.length >= 200;

  if (keys.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: 50,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
      }}>
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <Icon name="mail" size={28} strokeWidth={1.5} />
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{t('activation.noCampaigns')}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {truncated && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('activation.results.lastSends', { count: 200 })}</div>
      )}
      {keys.map(key => {
        const campaign = campaigns[key];
        const emailList = campaign.emails || [];
        const isOpen = expanded === key;

        const total = emailList.length;
        const uniqueContacts = new Set(emailList.map(e => e.to_email)).size;
        const firstSent = new Date(emailList[emailList.length - 1].sent_at || emailList[emailList.length - 1].created_at);
        const lastSent = new Date(emailList[0].sent_at || emailList[0].created_at);

        return (
          <div key={key} className="card" style={{ borderLeft: '3px solid var(--primary)' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setExpanded(isOpen ? null : key)}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{campaign.trigger}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {total} email{total > 1 ? 's' : ''} {en ? 'sent' : `envoyé${total > 1 ? 's' : ''}`}
                  {' · '}{uniqueContacts} contact{uniqueContacts > 1 ? 's' : ''}
                  {` · ${firstSent.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })} → ${lastSent.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}`}
                </div>
              </div>
              <span style={{ fontSize: 16, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>
                {'›'}
              </span>
            </div>

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
                            {en ? 'Analyzed' : 'Analysé'}
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
