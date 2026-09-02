/* ===============================================================================
   BAKAL — Data Quality Page
   Organized into strates (one per data-quality need) + a change history tab + a GDPR
   compliance tab: General (CRM hygiene not specific to deals or clients — duplicates,
   missing/invalid fields, inactivity), Deal quality, Client quality, Historique,
   Conformité (GDPR purge of long-inactive contacts). A score-trend header on top shows
   the current quality score, its 30-day delta and a sparkline. Every strate adapts
   to what each connected CRM actually supports — see lib/crm-cleaning-agent.js.
   =============================================================================== */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../i18n';
import DataQualityBanners from '../components/dataQuality/DataQualityBanners';
import ScoreTrendHeader from '../components/dataQuality/ScoreTrendHeader';
import DuplicatesStrate from '../components/dataQuality/DuplicatesStrate';
import DealQualityStrate from '../components/dataQuality/DealQualityStrate';
import ClientQualityStrate from '../components/dataQuality/ClientQualityStrate';
import HistoryTab from '../components/dataQuality/HistoryTab';
import GdprStrate from '../components/dataQuality/GdprStrate';

const TABS = [
  { key: 'general', labelKey: 'dataQuality.tabs.general', Component: DuplicatesStrate },
  { key: 'dealQuality', labelKey: 'dataQuality.tabs.dealQuality', Component: DealQualityStrate },
  { key: 'clientQuality', labelKey: 'dataQuality.tabs.clientQuality', Component: ClientQualityStrate },
  { key: 'history', labelKey: 'dataQuality.tabs.history', Component: HistoryTab },
  { key: 'gdpr', labelKey: 'dataQuality.tabs.gdpr', Component: GdprStrate },
];

export default function DataQualityPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState(TABS.some(tb => tb.key === initialTab) ? initialTab : 'general');
  const ActiveComponent = TABS.find(tb => tb.key === tab)?.Component;

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dataQuality.title')}</h1>
          <div className="page-subtitle">{t('dataQuality.subtitle')}</div>
        </div>
      </div>

      <ScoreTrendHeader />

      <DataQualityBanners />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-light)', marginBottom: 16 }}>
        {TABS.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            style={{
              fontSize: 12, fontWeight: 600, padding: '8px 14px', border: 'none', cursor: 'pointer',
              borderRadius: '6px 6px 0 0',
              background: tab === tb.key ? 'var(--accent-glow)' : 'none',
              color: tab === tb.key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === tb.key ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {ActiveComponent && <ActiveComponent />}
    </div>
  );
}
