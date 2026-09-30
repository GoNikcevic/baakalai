/* ===============================================================================
   BAKAL · Client Quality Strate

   Surfaces missing client fields that block lib/agents/upsell-detector.js from ever
   considering a won client · chiefly zero product-line assignments. L'agent compare
   les lignes affectées aux lignes disponibles : un client sans aucune affectation ne
   remonte JAMAIS, qu'il ait du potentiel ou non. Mesuré sur un tenant de staging :
   36 clients gagnés, 36 sans la moindre ligne produit, donc un des quatre métiers du
   produit inerte.

   L'écran empilait une carte par client, avec son sélecteur de tags, sans pagination
   ni ordre · le même défaut que l'onglet Général avant sa refonte, en pire, puisque
   chaque ligne occupait une carte entière. Il passe au panneau de correction commun,
   avec les pastilles en éditeur : trier par impact, cocher, appliquer d'un geste.

   La carte de configuration reste quand l'équipe n'a aucune ligne produit : là, le
   blocage n'est pas dans cet écran, il est en amont, et refaire la liste n'y changerait
   rien.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';
import FixQueuePanel from './FixQueuePanel';
import Icon from '../Icon';

export default function ClientQualityStrate() {
  const t = useT();
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/client-quality');
      setIssues(data.issues || []);
    } catch {
      setIssues([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>...</div>;
  if (!issues || issues.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('dataQuality.clientQuality.noneFound')}</div>;
  }

  const noProductLines = issues.find(i => i.type === 'no_product_lines_configured');
  if (noProductLines) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('dataQuality.clientQuality.noProductLinesConfigured')}</div>
          <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => navigate('/settings')}>
            {t('dataQuality.clientQuality.configureProductLines')}
          </button>
        </div>
      </div>
    );
  }

  const missingPl = issues.find(i => i.type === 'missing_product_lines');
  if (!missingPl) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {panelOpen && (
        <FixQueuePanel
          strate="client"
          issueType="missing_product_lines"
          issueLabel={t('dataQuality.clientQuality.missingProductLines')}
          onClose={() => setPanelOpen(false)}
          onChanged={load}
        />
      )}

      <div className="card">
        <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              <Icon name="package" size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
              {t('dataQuality.clientQuality.missingProductLines')}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                {t('dataQuality.common.affectedCount', { count: missingPl.count })}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {(missingPl.contacts || []).slice(0, 3).map(c => c.name || c.company || '?').join(', ')}
              {missingPl.count > 3 && ` +${missingPl.count - 3}`}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
            onClick={() => setPanelOpen(true)}
          >
            {t('dataQuality.clientQuality.fixButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
