/* ===============================================================================
   BAKAL — Client Quality Strate
   Surfaces missing client fields that block lib/agents/upsell-detector.js from ever
   considering a won client — chiefly zero product-line assignments. Reuses the
   existing ProductLineTags component inline so assignment happens without leaving
   the page.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import ProductLineTags from '../ProductLineTags';

export default function ClientQualityStrate() {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);

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
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {t('dataQuality.clientQuality.missingProductLines')} — {t('dataQuality.common.affectedCount', { count: missingPl.count })}
      </div>
      {missingPl.contacts.map(c => (
        <div key={c.id} className="card">
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              {c.name}{c.company && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}> — {c.company}</span>}
            </div>
            <ProductLineTags clientId={c.id} lang={lang} />
          </div>
        </div>
      ))}
    </div>
  );
}
