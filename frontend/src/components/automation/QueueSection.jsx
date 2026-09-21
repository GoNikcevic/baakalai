/* ===============================================================================
   BAKAL · « À valider » · la file de travail quotidienne

   Un seul endroit pour ce qui attend une décision : les brouillons de relance
   et les signaux détectés. Avant, les brouillons étaient un sous-onglet parmi
   neuf et les signaux une section séparée · deux niveaux de navigation pour
   trouver le travail du jour.
   =============================================================================== */

import { useState } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';
import EmailsQueue from './EmailsQueue';
import SignalsPage from '../../pages/SignalsPage';

export default function QueueSection({ summary, onSummaryRefresh, signalsRef }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [previews, setPreviews] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);

  const sendBlocked = summary ? !summary.hasMailbox : false;
  const totalPreviewed = previews ? previews.reduce((s, p) => s + (p.contactsCount || 0), 0) : 0;

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const data = await request('/nurture/preview', { method: 'POST' });
      setPreviews(data.previews || []);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setPreviewing(false);
  };

  const runEngine = async () => {
    setExecuting(true);
    try {
      await request('/nurture/run', { method: 'POST' });
      setPreviews(null);
      onSummaryRefresh();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setExecuting(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 650 }}>{t('activation.queue.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('activation.queue.subtitle')}</div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }}
          disabled={previewing}
          onClick={runPreview}
        >
          {previewing ? t('activation.previewing') : (
            <>
              <Icon name="search" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />
              {t('activation.preview')}
            </>
          )}
        </button>
      </div>

      {/* Aperçu des contacts que les règles actives vont toucher */}
      {previews && (
        <div style={{
          background: 'var(--primary-softer)', border: '1px solid var(--primary)',
          borderRadius: 'var(--r-xl)', padding: 20, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {previews.length > 0 ? t('activation.contactsToContact', { count: totalPreviewed }) : t('activation.noContactsToEmail')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--grey-500)', marginTop: 2 }}>
                {t('activation.triggersActive', { count: previews.length })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {previews.length > 0 && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 16px' }}
                  disabled={executing}
                  onClick={runEngine}
                >
                  {executing && <Icon name="clock" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />}
                  {executing ? t('activation.sending') : t('activation.runEngine')}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.triggerName}</div>
                <span style={{ fontSize: 11, color: 'var(--grey-500)' }}>
                  {p.manualOnly
                    ? t('activation.manualOnlyTrigger')
                    : <>{p.contactsCount} contact{p.contactsCount > 1 ? 's' : ''} · mode {p.mode === 'auto' ? 'auto' : (en ? 'approval' : 'approbation')}</>}
                </span>
              </div>

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
                    +{p.contactsCount - 5} {en ? 'more' : 'autres'}
                  </span>
                )}
              </div>

              {p.sampleEmail && (
                <div style={{
                  background: 'var(--paper-2)', borderRadius: 8, padding: '10px 14px',
                  borderLeft: '3px solid var(--lavender)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--grey-500)', marginBottom: 4 }}>
                    {en ? `Sample email for ${p.contacts[0]?.name || 'a contact'}:` : `Exemple d'email pour ${p.contacts[0]?.name || 'un contact'} :`}
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

      <EmailsQueue type="pending" sendBlocked={sendBlocked} summary={summary} onChange={onSummaryRefresh} />

      {/* Signaux · même nature de travail : quelque chose attend une décision */}
      <div ref={signalsRef} style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
        <SignalsPage view="feed" />
      </div>
    </div>
  );
}
