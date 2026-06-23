/* ===============================================================================
   BAKAL — Settings Wrapper
   Merges Settings + Profile + Integrations + Memory into one nav entry with tabs.
   =============================================================================== */

import { useState } from 'react';
import { useT } from '../i18n';
import SettingsPage from './SettingsPage';
import ProfilePage from './ProfilePage';
import MemoryExplorerPage from './MemoryExplorerPage';

const SECTIONS = [
  { key: 'integrations', i18n: 'nav.integrations' },
  { key: 'profile', i18n: 'nav.profile' },
  { key: 'memory', i18n: 'nav.memory' },
];

export default function SettingsWrapper() {
  const t = useT();
  const [section, setSection] = useState('integrations');

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

      {section === 'integrations' && <SettingsPage />}
      {section === 'profile' && <ProfilePage />}
      {section === 'memory' && <MemoryExplorerPage />}
    </div>
  );
}
