/* ===============================================================================
   BAKAL — Analytics Page (wrapper)
   Merges CRM Analytics + Membership Analytics into one nav entry.
   =============================================================================== */

import { useState } from 'react';
import { useT } from '../i18n';
import CRMAnalyticsPage from './CRMAnalyticsPage';
import MembershipPage from './MembershipPage';

const SECTIONS = [
  { key: 'crm', i18n: 'nav.crmAnalytics' },
  { key: 'membership', i18n: 'nav.membership' },
];

export default function AnalyticsPage() {
  const t = useT();
  const [section, setSection] = useState('crm');

  return (
    <div>
      {/* Top-level section switcher */}
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3,
        background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 10,
        marginBottom: 20,
      }}>
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            style={{
              padding: '7px 18px', border: 'none', borderRadius: 8,
              background: section === s.key ? 'var(--bg-card, white)' : 'transparent',
              color: section === s.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: section === s.key ? 600 : 400,
              fontSize: 13, cursor: 'pointer',
              boxShadow: section === s.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {t(s.i18n)}
          </button>
        ))}
      </div>

      {section === 'crm' && <CRMAnalyticsPage />}
      {section === 'membership' && <MembershipPage />}
    </div>
  );
}
