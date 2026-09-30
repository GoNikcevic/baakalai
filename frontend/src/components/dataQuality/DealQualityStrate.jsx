/* ===============================================================================
   BAKAL · Deal Quality Strate

   Surfaces missing/problematic deal fields that degrade "Deals à relancer" and churn
   scoring. stage_mapping_issue is a setup/config problem, not a per-deal issue · it's
   filtered out here and surfaced as a general banner instead (DataQualityBanners.jsx).

   Trois de ces problèmes se corrigent ici même, dans le panneau de correction, et deux
   non · la distinction est un choix, pas une limite technique :

     secteur, montant, date de clôture · une valeur à écrire, donc une file de travail.
       Le secteur est le seul à porter une proposition (le classifieur), les deux autres
       n'en ont aucune qui soit honnête, et le panneau le dit à l'écran.

     owner non rattaché · une CORRESPONDANCE entre un owner du CRM et un membre de
       l'équipe, à faire une fois. La mettre dans une file ferait répéter N fois une
       décision unique : c'est le bouton Voir, en attendant son propre écran.

     aucune activité · rien à saisir. Une affaire sans activité n'est pas une donnée
       fausse, c'est une affaire à travailler, ce qui relève de la prospection.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';
import FixQueuePanel from './FixQueuePanel';
import OwnerMappingPanel from './OwnerMappingPanel';
import Icon from '../Icon';

const ISSUE_ICONS = {
  missing_sector: 'tag',
  missing_deal_value: 'revenue',
  missing_won_lost_date: 'calendar',
  owner_not_mapped: 'user',
  zero_activity: 'moon',
};

// Doit rester aligné avec FIX_QUEUE_KINDS dans backend/routes/data-quality.js : cette
// table décide quels problèmes ouvrent le panneau, celle du serveur décide ce qu'il
// accepte d'écrire.
const FIXABLE_ISSUE_TYPES = ['missing_sector', 'missing_deal_value', 'missing_won_lost_date'];

export default function DealQualityStrate() {
  const t = useT();
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [panelIssue, setPanelIssue] = useState(null);
  const [ownerPanel, setOwnerPanel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/deal-quality');
      // stage_mapping_issue is a setup/config problem, not a per-deal data quality issue · it's
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
      {panelIssue && (
        <FixQueuePanel
          strate="deal"
          issueType={panelIssue.type}
          issueLabel={panelIssue.label}
          onClose={() => setPanelIssue(null)}
          onChanged={load}
        />
      )}
      {ownerPanel && (
        <OwnerMappingPanel onClose={() => setOwnerPanel(false)} onChanged={load} />
      )}
      {issues.map((issue, i) => {
        const label = t(`dataQuality.dealQuality.${issue.type.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);
        const count = issue.count || issue.contacts?.length || 0;
        const fixable = FIXABLE_ISSUE_TYPES.includes(issue.type) && count > 0;
        return (
          <div key={i} className="card">
            <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  <Icon name={ISSUE_ICONS[issue.type] || 'alert'} size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                  {label}
                  {count > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{t('dataQuality.common.affectedCount', { count })}</span>}
                </div>
                {count > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {(issue.contacts || []).slice(0, 3).map(c => c.name || c.company || '?').join(', ')}
                    {count > 3 && ` +${count - 3}`}
                  </div>
                )}
              </div>
              {fixable ? (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 12px' }}
                  onClick={() => setPanelIssue({ type: issue.type, label })}
                >
                  {t('dataQuality.dealQuality.fixButton')}
                </button>
              ) : issue.type === 'owner_not_mapped' ? (
                // Pas une file de saisie : une correspondance, prise une fois par
                // personne et pas une fois par affaire.
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
                  onClick={() => setOwnerPanel(true)}
                >
                  {t('dataQuality.dealQuality.mapOwnersButton')}
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 12px' }}
                  onClick={() => {
                    const ids = (issue.contacts || []).map(c => c.id).filter(Boolean).slice(0, 20);
                    const params = new URLSearchParams({ context: 'deal_quality', issue: issue.type });
                    if (ids.length > 0) params.set('highlight', ids.join(','));
                    navigate(`/deals?${params.toString()}`);
                  }}
                >
                  {t('dataQuality.common.view')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
