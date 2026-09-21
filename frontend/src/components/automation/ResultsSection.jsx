/* ===============================================================================
   BAKAL · « Résultats » · ce que l'automatisation a produit

   Regroupe les chiffres d'envoi, les envois par règle, les tests A/B et, pour
   les comptes Salesforce seulement, les emails partis de Salesforce/Fonteva.
   Ce dernier bloc s'affichait pour tout le monde et répondait « Salesforce non
   connecté » à la plupart des comptes.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT } from '../../i18n';
import AutomationStats from '../AutomationStats';
import SentCampaigns from './SentCampaigns';
import ABResults from './ABResults';
import NewsletterAnalytics from './NewsletterAnalytics';

const BLOCK = { marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' };
const BLOCK_TITLE = { fontSize: 15, fontWeight: 650, marginBottom: 10 };

export default function ResultsSection() {
  const t = useT();
  const [hasSalesforce, setHasSalesforce] = useState(false);

  useEffect(() => {
    request('/crm/providers')
      .then(d => setHasSalesforce((d.providers || []).some(p => p.provider === 'salesforce' && p.connected)))
      .catch(() => {});
  }, []);

  return (
    <div>
      <AutomationStats />

      <div style={BLOCK}>
        <div style={BLOCK_TITLE}>{t('activation.results.byRule')}</div>
        <SentCampaigns />
      </div>

      <div style={BLOCK}>
        <div style={BLOCK_TITLE}>{t('activation.results.abTests')}</div>
        <ABResults />
      </div>

      {hasSalesforce && (
        <div style={BLOCK}>
          <div style={BLOCK_TITLE}>{t('activation.results.newsletters')}</div>
          <NewsletterAnalytics />
        </div>
      )}
    </div>
  );
}
