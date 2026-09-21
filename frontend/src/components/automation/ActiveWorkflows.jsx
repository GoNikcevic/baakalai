/* ===============================================================================
   BAKAL · Workflows de relance en cours

   Un workflow se crée depuis un deal (/deals-to-reactivate/:id/workflow) et
   n'apparaissait ensuite nulle part : quatre chiffres dans les stats, aucune
   liste. Impossible de savoir qui était enrôlé, ni où en était la séquence.

   Le bloc disparaît si la table n'existe pas encore sur l'environnement
   (migration 103) : c'est une absence, pas une erreur à afficher.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';

const GOAL_BASE = {
  reactivation: '/deals-to-reactivate',
  upsell: '/clients-to-upsell',
  churn_prevention: '/churn-risk',
};

export default function ActiveWorkflows() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState(null);

  useEffect(() => {
    request('/enrollments?status=active')
      .then(d => setWorkflows(d.enrollments || []))
      .catch(() => setWorkflows([]));
  }, []);

  if (!workflows || workflows.length === 0) return null;

  const goalLabels = {
    reactivation: en ? 'Reactivation' : 'Réactivation',
    upsell: 'Upsell',
    churn_prevention: en ? 'Churn prevention' : 'Prévention churn',
  };

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 2 }}>{t('activation.workflows.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{t('activation.workflows.subtitle')}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {workflows.map(w => {
          const base = GOAL_BASE[w.goal];
          const canOpen = !!base && !!w.opportunity_id && w.goal !== 'churn_prevention';
          return (
            <div key={w.id} className="card" style={{ borderLeft: '3px solid var(--blue)' }}>
              <div className="card-body" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    <Icon name="zap" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                    {w.contact_name || w.contact_company || (en ? 'Unknown contact' : 'Contact inconnu')}
                    {w.contact_company && w.contact_name && (
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {w.contact_company}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {goalLabels[w.goal] || w.goal}
                    {w.total_steps > 0 && ` · ${t('activation.workflows.step', { done: w.done_steps || 0, total: w.total_steps })}`}
                    {w.started_at && ` · ${en ? 'started' : 'démarré'} ${new Date(w.started_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })}`}
                  </div>
                </div>
                {canOpen && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}
                    onClick={() => navigate(`${base}/${w.opportunity_id}/workflow`)}
                  >
                    {t('activation.workflows.open')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
