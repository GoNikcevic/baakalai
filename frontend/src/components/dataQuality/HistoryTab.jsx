/* ===============================================================================
   BAKAL — History Tab
   Everything that has happened via Baakalai's Data Quality page, grouped by user
   action (one merge = one group, even if it touched several contacts). Full undo —
   restoring the complete prior state — for any group still 'applied'.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';

export default function HistoryTab() {
  const t = useT();
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/history');
      setGroups(data.groups || []);
    } catch {
      setGroups([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUndo = async (groupId) => {
    setUndoingId(groupId);
    try {
      const result = await request(`/data-quality/history/${groupId}/undo`, { method: 'POST' });
      if (result.ok) {
        showToast({ type: 'success', title: t('dataQuality.history.undoSuccess') });
        load();
      } else {
        showToast({ type: 'error', title: t('dataQuality.history.undoFailed'), message: result.error || '' });
      }
    } catch (err) {
      showToast({ type: 'error', title: t('dataQuality.history.undoFailed'), message: err.message });
    }
    setUndoingId(null);
    setConfirmingId(null);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>;
  if (!groups || groups.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('dataQuality.history.noneFound')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {groups.map(g => {
        const names = [...new Set(g.rows.map(r => r.name || r.company).filter(Boolean))];
        const date = new Date(g.createdAt).toLocaleString('fr-FR');
        return (
          <div key={g.groupId} className="card">
            <div className="card-body" style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {t(`dataQuality.history.groupLabel.${g.changeType}`)}
                  {!g.canUndo && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>({t('dataQuality.history.undone')})</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {names.join(', ')} — {date}
                </div>
                {g.rows.some(r => r.remoteAction === 'manual_required') && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
                    {t('dataQuality.history.remoteActionLabel.manual_required')}
                  </div>
                )}
              </div>
              {g.canUndo && (
                confirmingId === g.groupId ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11 }}>{t('dataQuality.history.undoConfirm')}</span>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      disabled={undoingId === g.groupId}
                      onClick={() => handleUndo(g.groupId)}
                    >
                      {undoingId === g.groupId ? '…' : t('dataQuality.history.undo')}
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => setConfirmingId(null)}>×</button>
                  </div>
                ) : (
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => setConfirmingId(g.groupId)}>
                    {t('dataQuality.history.undo')}
                  </button>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
