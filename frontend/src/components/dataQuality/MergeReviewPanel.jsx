/* ===============================================================================
   BAKAL — Merge Review Panel
   Inline expand-to-confirm (not a modal — matches SettingsPage's DeleteAccountSection
   and ReactivationQueuePage's postpone flow). Shows a full field-by-field diff across
   every contact in a duplicate group before any merge is committed, lets the user pick
   which contact survives and resolve conflicting field values, then shows the EXACT
   list of contacts that will be removed before the final confirmation.
   =============================================================================== */

import { useState } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';

const FIELD_LABELS = { name: 'Nom', email: 'Email', phone: 'Téléphone', title: 'Poste', company: 'Entreprise' };

function formatActivity(counts, t) {
  if (!counts) return '—';
  return t('dataQuality.duplicates.activityCounts', {
    emails: counts.emails,
    activities: counts.activities,
    lines: counts.productLines,
  });
}

export default function MergeReviewPanel({ provider, group, onMerged }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState(null);
  const [activityCounts, setActivityCounts] = useState({});
  const [keepId, setKeepId] = useState(null);
  const [resolvedFields, setResolvedFields] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);

  const contactIds = group.contacts.map(c => c.id);

  const handleExpand = async () => {
    setExpanded(true);
    setLoading(true);
    try {
      const data = await request(`/data-quality/duplicates/${provider}/preview-merge`, {
        method: 'POST',
        body: JSON.stringify({ contactIds }),
      });
      setDiff(data.diff);
      setActivityCounts(data.activityCounts || {});
      setResolvedFields(data.diff.suggested);
      setKeepId(group.contacts[0].id);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
      setExpanded(false);
    }
    setLoading(false);
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const data = await request(`/data-quality/duplicates/${provider}/confirm-merge`, {
        method: 'POST',
        body: JSON.stringify({ contactIds, keepId, resolvedFields }),
      });
      setResult(data);
      showToast({ type: 'success', title: t('dataQuality.duplicates.mergeSuccess') });
      if (onMerged) onMerged();
    } catch (err) {
      showToast({ type: 'error', title: t('dataQuality.duplicates.mergeError'), message: err.message });
    }
    setConfirming(false);
  };

  if (result) {
    return (
      <div className="card" style={{ marginTop: 8, borderLeft: '3px solid var(--success)' }}>
        <div className="card-body" style={{ padding: '12px 16px', fontSize: 12 }}>
          <div style={{ color: 'var(--success)', fontWeight: 600 }}>{t('dataQuality.duplicates.mergeSuccess')}</div>
          {result.manualChecklist?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, color: 'var(--warning)' }}>{t('dataQuality.duplicates.manualChecklistTitle')}</div>
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{t('dataQuality.duplicates.manualChecklistNote')}</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.manualChecklist.map((c, i) => (
                  <li key={i}>{c.name || c.email}{c.name && c.email ? ` (${c.email})` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={handleExpand}>
        {t('dataQuality.duplicates.mergeButton')}
      </button>
    );
  }

  if (loading || !diff) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>{t('dataQuality.duplicates.scanning')}</div>;
  }

  const others = group.contacts.filter(c => String(c.id) !== String(keepId));
  const kept = group.contacts.find(c => String(c.id) === String(keepId));

  return (
    <div className="card" style={{ marginTop: 8, border: '1px solid var(--border)' }}>
      <div className="card-body" style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('dataQuality.duplicates.reviewDiff')}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{t('dataQuality.duplicates.pickColumnHint')}</div>

        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)' }}></th>
                {diff.perContact.map((c, i) => {
                  const isKept = String(c.id) === String(keepId);
                  return (
                    <th key={c.id} onClick={() => setKeepId(c.id)} title={t('dataQuality.duplicates.pickColumnHint')}
                      style={{
                        textAlign: 'left', padding: '8px', cursor: 'pointer', verticalAlign: 'top',
                        background: isKept ? 'var(--accent-glow)' : 'transparent',
                        borderBottom: `2px solid ${isKept ? 'var(--accent)' : 'var(--border-light)'}`,
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="radio" checked={isKept} onChange={() => setKeepId(c.id)} style={{ cursor: 'pointer' }} />
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.name || c.email || t('dataQuality.duplicates.fieldFromContact', { n: i + 1 })}</span>
                      </div>
                      {c.name && c.email && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 22, wordBreak: 'break-all' }}>{c.email}</div>
                      )}
                      <div style={{ marginLeft: 22, marginTop: 4 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
                          padding: '2px 6px', borderRadius: 4,
                          background: isKept ? 'var(--accent)' : 'var(--danger-bg)',
                          color: isKept ? 'var(--text-on-color)' : 'var(--danger)',
                        }}>
                          {isKept ? t('dataQuality.duplicates.keptBadge') : t('dataQuality.duplicates.toRemoveBadge')}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                <td style={{ padding: '4px 8px', fontWeight: 600 }}>{t('dataQuality.duplicates.activityRow')}</td>
                {diff.perContact.map(c => (
                  <td key={c.id} style={{ padding: '4px 8px', fontWeight: 600, whiteSpace: 'nowrap', background: String(c.id) === String(keepId) ? 'var(--accent-glow)' : 'transparent' }}>
                    {formatActivity(activityCounts[c.id], t)}
                  </td>
                ))}
              </tr>
              {diff.fields.map(field => (
                <tr key={field}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{FIELD_LABELS[field] || field}</td>
                  {diff.perContact.map(c => {
                    const isKept = String(c.id) === String(keepId);
                    return (
                      <td key={c.id} style={{ padding: '4px 8px', background: isKept ? 'var(--accent-glow)' : 'transparent', color: diff.diffs[field].conflict ? 'var(--warning)' : 'inherit' }}>
                        {c[field] || '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {t('dataQuality.duplicates.historyMergedNote')}
        </div>

        {diff.fields.filter(f => diff.diffs[f].conflict).map(field => (
          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
            <span style={{ minWidth: 80, fontWeight: 600 }}>{FIELD_LABELS[field] || field}</span>
            <span style={{ fontSize: 10, color: 'var(--warning)' }}>{t('dataQuality.duplicates.conflictBadge')}</span>
            <select
              value={resolvedFields[field] || ''}
              onChange={e => setResolvedFields(prev => ({ ...prev, [field]: e.target.value }))}
              style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)' }}
            >
              {diff.diffs[field].values.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}

        {kept && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('dataQuality.duplicates.keepSummary')} </span>
            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{kept.name || kept.email}</span>
            {kept.name && kept.email && <span style={{ color: 'var(--text-muted)' }}> ({kept.email})</span>}
          </div>
        )}

        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--danger)' }}>
          {t('dataQuality.duplicates.willBeRemoved')}
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {others.map(c => <li key={c.id}>{c.name || c.email}{c.email && c.name ? ` (${c.email})` : ''}</li>)}
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '5px 14px' }} disabled={confirming} onClick={handleConfirm}>
            {confirming ? '…' : t('dataQuality.duplicates.confirmMerge')}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 14px' }} onClick={() => setExpanded(false)}>
            {t('dataQuality.duplicates.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
