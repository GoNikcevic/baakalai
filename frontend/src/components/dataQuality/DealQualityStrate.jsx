/* ===============================================================================
   BAKAL — Deal Quality Strate
   Surfaces missing/problematic deal fields that degrade "Deals à relancer" and churn
   scoring. Every issue resolves to "review" (go fix it on the client record) — nothing
   here is auto-fixable, since Baakalai has no reliable way to infer a sector, deal
   value, or true close date on its own (see backend/lib/data-quality-checks.js for why).
   stage_mapping_issue is a setup/config problem, not a per-deal issue — it's filtered
   out here and surfaced as a general banner instead (DataQualityBanners.jsx).
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';

const ISSUE_ICONS = {
  missing_sector: '🏷️',
  missing_deal_value: '💰',
  missing_won_lost_date: '📅',
  owner_not_mapped: '👤',
  zero_activity: '💤',
};

export default function DealQualityStrate() {
  const t = useT();
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/deal-quality');
      // stage_mapping_issue is a setup/config problem, not a per-deal data quality issue — it's
      // surfaced as a general banner at the top of the page instead (DataQualityBanners.jsx).
      setIssues((data.issues || []).filter(i => i.type !== 'stage_mapping_issue'));
    } catch {
      setIssues([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>;
  if (!issues || issues.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('dataQuality.dealQuality.noneFound')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {issues.map((issue, i) => {
        const label = t(`dataQuality.dealQuality.${issue.type.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);
        const count = issue.count || issue.contacts?.length || 0;
        return (
          <div key={i} className="card">
            <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {ISSUE_ICONS[issue.type] || '•'} {label}
                  {count > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{t('dataQuality.common.affectedCount', { count })}</span>}
                </div>
                {count > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {(issue.contacts || []).slice(0, 3).map(c => c.name || c.company || '?').join(', ')}
                    {count > 3 && ` +${count - 3}`}
                  </div>
                )}
              </div>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 12px' }}
                onClick={() => {
                  const ids = (issue.contacts || []).map(c => c.id).filter(Boolean).slice(0, 20);
                  const params = new URLSearchParams({ context: 'deal_quality', issue: issue.type });
                  if (ids.length > 0) params.set('highlight', ids.join(','));
                  navigate(`/clients?${params.toString()}`);
                }}
              >
                {t('dataQuality.common.view')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
