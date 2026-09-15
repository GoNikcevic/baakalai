/* ===============================================================================
   BAKAL — Reactivation Detail (generic)
   Single-candidate view reached from ReactivationQueuePage's "Voir le mail". Generates
   the AI draft on demand (fresh CRM data), lets the user edit it, then send or regenerate.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT, useI18n } from '../i18n';
import AppliedPatternsBanner from '../components/AppliedPatternsBanner';

const URGENCY_STYLES = {
  high: { background: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.25)' },
  medium: { background: 'rgba(245,158,11,0.08)', color: '#d97706', border: '1px solid rgba(245,158,11,0.25)' },
  low: { background: 'var(--bg-elevated, rgba(0,0,0,0.03))', color: 'var(--text-muted)', border: '1px solid var(--border)' },
};

function ContextFact({ label, children }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
      background: 'var(--bg-default, #fff)', minWidth: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{children}</div>
    </div>
  );
}

/* Why this email exists: where the relationship with this account stands
   (stage, value, inactivity, churn) + the AI's own justification. */
function DraftContextCard({ context, kind }) {
  const t = useT();
  const { lang } = useI18n();
  const dateLocale = lang === 'en' ? 'en-US' : 'fr-FR';
  const isDeal = kind === 'deal_reactivation';

  return (
    <div style={{
      background: 'var(--bg-elevated, rgba(110,87,250,0.05))',
      border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 16px', margin: '0 0 14px', fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {context.company
            ? t('reactivation.contextTitle', { company: context.company })
            : t('reactivation.contextTitleNoCompany')}
        </span>
        {isDeal && context.urgency && URGENCY_STYLES[context.urgency] && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            ...URGENCY_STYLES[context.urgency],
          }}>
            {t(`reactivation.urgency_${context.urgency}`)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {context.contactName && (
          <ContextFact label={t('reactivation.ctxContact')}>
            {context.contactName}{context.contactTitle ? ` — ${context.contactTitle}` : ''}
          </ContextFact>
        )}
        {isDeal ? (
          context.stage && <ContextFact label={t('reactivation.ctxStage')}>{context.stage}</ContextFact>
        ) : (
          <ContextFact label={t('reactivation.ctxRelationship')}>{t('reactivation.ctxClient')}</ContextFact>
        )}
        {context.dealValue != null && (
          <ContextFact label={t('reactivation.ctxValue')}>
            {Math.round(context.dealValue).toLocaleString(dateLocale)} €
          </ContextFact>
        )}
        <ContextFact label={t('reactivation.ctxActivity')}>
          {context.hasPlannedDate && context.plannedFollowupDate
            ? t('reactivation.ctxPlanned', { date: new Date(context.plannedFollowupDate).toLocaleDateString(dateLocale) })
            : t('reactivation.ctxInactive', { days: context.overdueDays })}
        </ContextFact>
        {isDeal && context.churnScore != null && (
          <ContextFact label={t('reactivation.ctxChurn')}>{context.churnScore}/100</ContextFact>
        )}
      </div>

      {isDeal && context.reason && (
        <div style={{ marginTop: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('reactivation.ctxWhyNow')} </span>
          {context.reason}
        </div>
      )}
      {!isDeal && Array.isArray(context.crossSellProducts) && context.crossSellProducts.length > 0 && (
        <div style={{ marginTop: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('reactivation.ctxCrossSell')} </span>
          {context.crossSellProducts.join(', ')}
        </div>
      )}
    </div>
  );
}

export default function ReactivationDetailPage({ kind, detailRouteBase }) {
  const t = useT();
  const { opportunityId } = useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const [context, setContext] = useState(null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  const loadDraft = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await request(`/reactivation/${opportunityId}/draft?kind=${kind}${force ? '&force=true' : ''}`);
      setEmail(data.email);
      setContext(data.context || null);
      // Same row can be reused (id unchanged) on regenerate — bump a version so the
      // uncontrolled subject/body fields below remount with the fresh content.
      setDraftVersion(v => v + 1);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [opportunityId, kind]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  const saveField = async (field, value) => {
    if (!email) return;
    try {
      await request(`/reactivation/emails/${email.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
    } catch (err) {
      showToast({ type: 'error', title: t('clients.error'), message: err.message });
    }
  };

  const handleSend = async () => {
    if (!email) return;
    setSending(true);
    try {
      const result = await request(`/nurture/emails/${email.id}/approve`, { method: 'POST' });
      if (result.success) {
        showToast({ type: 'success', title: t('reactivation.sent'), message: '' });
        navigate(detailRouteBase);
      } else {
        showToast({ type: 'error', title: t('clients.error'), message: result.error });
      }
    } catch (err) {
      showToast({ type: 'error', title: t('clients.error'), message: err.message });
    }
    setSending(false);
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => navigate(detailRouteBase)}>
          ← {t('reactivation.back')}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('reactivation.generating')}</div>
          <div style={{ fontSize: 12 }}>{t('reactivation.generatingHint')}</div>
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--danger)' }}>{error}</div>
      ) : email ? (
        <>
        {context && <DraftContextCard context={context} kind={kind} />}
        <div className="touchpoint-card">
          <div className="tp-body">
            <div className="tp-field tp-subject">
              <div className="tp-field-label">{t('reactivation.subjectLabel')}</div>
              <input
                key={`subject-${email.id}-${draftVersion}`}
                type="text"
                className="tp-editable"
                style={{ width: '100%', boxSizing: 'border-box' }}
                defaultValue={email.subject}
                onBlur={(e) => saveField('subject', e.target.value)}
              />
            </div>
            <div className="tp-field">
              <div className="tp-field-label">{t('reactivation.bodyLabel')}</div>
              <textarea
                key={`body-${email.id}-${draftVersion}`}
                className="tp-editable"
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                rows={8}
                defaultValue={email.body}
                onBlur={(e) => saveField('body', e.target.value)}
              />
            </div>
            <AppliedPatternsBanner patternIds={email.pattern_ids} />
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 20px' }}>
            <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }} disabled={sending} onClick={handleSend}>
              {sending ? '...' : t('reactivation.send')}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 16px' }} onClick={() => loadDraft(true)}>
              {t('reactivation.regenerate')}
            </button>
          </div>
        </div>
        </>
      ) : null}
    </div>
  );
}
