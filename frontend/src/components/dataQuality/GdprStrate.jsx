/* ===============================================================================
   BAKAL — Conformité strate (Data Quality's GDPR tab)
   Contacts with zero activity for more than {thresholdMonths} months (active clients
   excluded) — candidates for GDPR data-minimisation purge. The purge button only
   unlocks after the current selection has been exported to CSV (we keep a trace
   before deleting anything). Purge itself goes through the generic Data Quality
   history circuit (data_quality_changes, change_type 'gdpr_purge') so it is fully
   undoable from the Historique tab.
   =============================================================================== */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';
import { useConfirm } from '../ConfirmModal';

function selectionSignature(ids) {
  return [...ids].sort().join(',');
}

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'name,email,company,status,lastActivityAt';
  const lines = rows.map(r => [r.name, r.email, r.company, r.status, r.lastActivityAt].map(esc).join(','));
  return [header, ...lines].join('\n');
}

export default function GdprStrate() {
  const t = useT();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [exportedSignature, setExportedSignature] = useState(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await request('/data-quality/gdpr');
      setData(d);
    } catch {
      setData({ thresholdMonths: 24, candidates: [] });
    }
    setSelected(new Set());
    setExportedSignature(null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidates = data?.candidates || [];
  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const currentSignature = useMemo(() => selectionSignature([...selected]), [selected]);
  const canPurge = selected.size > 0 && exportedSignature === currentSignature;

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(candidates.map(c => c.id)));
  };

  const handleExport = () => {
    const rows = candidates.filter(c => selected.has(c.id));
    if (rows.length === 0) return;
    // UTF-8 BOM so Excel opens the CSV with correct accents.
    const blob = new Blob([String.fromCharCode(0xFEFF) + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gdpr-purge-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportedSignature(currentSignature);
  };

  const handlePurge = async () => {
    if (!canPurge || purging) return;
    const count = selected.size;
    if (!await confirm(t('dataQuality.gdpr.confirmPurge', { count }), { danger: true })) return;
    setPurging(true);
    try {
      const result = await request('/data-quality/gdpr/purge', {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [...selected] }),
      });
      showToast({
        type: 'success',
        title: t('dataQuality.gdpr.purgeSuccessTitle'),
        message: t('dataQuality.gdpr.purgeSuccessMessage', { count: result.deleted ?? count }),
      });
      await load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setPurging(false);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>…</div>;

  if (candidates.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('dataQuality.gdpr.empty')}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
        {t('dataQuality.gdpr.explanation', { months: data.thresholdMonths })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          {t('dataQuality.gdpr.selectAll')}
        </label>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {t('dataQuality.gdpr.selectedCount', { selected: selected.size, total: candidates.length })}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '5px 12px' }}
            disabled={selected.size === 0}
            onClick={handleExport}
          >
            {t('dataQuality.gdpr.exportCsv')}
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: '5px 12px' }}
            disabled={!canPurge || purging}
            title={canPurge ? undefined : t('dataQuality.gdpr.purgeLockedHint')}
            onClick={handlePurge}
          >
            {purging ? '…' : t('dataQuality.gdpr.purgeSelection')}
          </button>
        </div>
      </div>

      {selected.size > 0 && !canPurge && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {t('dataQuality.gdpr.purgeLockedHint')}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {candidates.map(c => (
          <div key={c.id} className="card">
            <div className="card-body" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || c.email || '?'}
                  {c.company && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>{c.company}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.email, c.status].filter(Boolean).join(' — ')}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--warning)', flexShrink: 0, textAlign: 'right' }}>
                {t('dataQuality.gdpr.monthsInactive', { months: c.monthsInactive })}
                {c.lastActivityAt && (
                  <div style={{ color: 'var(--text-muted)' }}>
                    {t('dataQuality.gdpr.lastActivity', { date: new Date(c.lastActivityAt).toLocaleDateString('fr-FR') })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
