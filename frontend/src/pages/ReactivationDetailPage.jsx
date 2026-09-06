/* ===============================================================================
   BAKAL — Reactivation Detail (generic)
   Single-candidate view reached from ReactivationQueuePage's "Voir le mail". Generates
   the AI draft on demand (fresh CRM data), lets the user edit it, then send or regenerate.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';
import AppliedPatternsBanner from '../components/AppliedPatternsBanner';

export default function ReactivationDetailPage({ kind, detailRouteBase }) {
  const t = useT();
  const { opportunityId } = useParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
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
      ) : null}
    </div>
  );
}
