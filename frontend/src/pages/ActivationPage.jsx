/* ===============================================================================
   BAKAL — Activation Page (wrapper)
   Merges Nurture (activation triggers/emails) + Signals into one nav entry.
   =============================================================================== */

import { useSearchParams } from 'react-router-dom';
import { useT } from '../i18n';
import NurturePage from './NurturePage';
import SignalsPage from './SignalsPage';

const SECTIONS = [
  { key: 'nurture', i18n: 'activation.title' },
  { key: 'signals', i18n: 'nav.signals' },
];

export default function ActivationPage() {
  const t = useT();
  // La section active vit dans l'URL (?section=) pour rester deep-linkable
  // depuis la TodayCard et le chat.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSection = searchParams.get('section');
  const section = SECTIONS.some(s => s.key === urlSection) ? urlSection : 'nurture';

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
            onClick={() => setSearchParams({ section: s.key }, { replace: true })}
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

      {section === 'nurture' && <NurturePage />}
      {section === 'signals' && <SignalsPage />}
    </div>
  );
}
