/* ===============================================================================
   BAKAL — Applied Patterns Banner
   Small, discreet card shown next to an AI-generated draft, listing the memory
   patterns (pattern_ids) that were injected into the prompt. Fetches labels once
   via POST /ai/memory/labels; renders nothing when there is nothing to show
   (no ids, fetch error, or no visible pattern for the caller).
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { useT } from '../i18n';

const CONFIDENCE_KEYS = { Haute: 'memory.high', Moyenne: 'memory.medium', Faible: 'memory.low' };

export default function AppliedPatternsBanner({ patternIds }) {
  const t = useT();
  const [patterns, setPatterns] = useState(null);
  // Stable key so the effect only re-runs when the actual ids change.
  const idsKey = Array.isArray(patternIds) && patternIds.length > 0 ? patternIds.join(',') : '';

  useEffect(() => {
    if (!idsKey) { setPatterns(null); return undefined; }
    let cancelled = false;
    request('/ai/memory/labels', {
      method: 'POST',
      body: JSON.stringify({ ids: idsKey.split(',') }),
    })
      .then(data => { if (!cancelled) setPatterns(data.patterns || []); })
      .catch(() => { if (!cancelled) setPatterns(null); });
    return () => { cancelled = true; };
  }, [idsKey]);

  if (!patterns || patterns.length === 0) return null;

  return (
    <div style={{
      background: 'var(--bg-elevated, rgba(110,87,250,0.05))',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      margin: '10px 0',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
        {'🧠'} {t('memory.appliedBanner', { count: patterns.length })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {patterns.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{p.pattern}</span>
            {p.applied ? (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: 'rgba(0,214,143,0.1)', color: 'var(--success, #16a34a)',
                border: '1px solid rgba(0,214,143,0.3)', flexShrink: 0,
              }}>
                {t('memory.appliedBadge')}
              </span>
            ) : (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                {CONFIDENCE_KEYS[p.confidence] ? t(CONFIDENCE_KEYS[p.confidence]) : p.confidence}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
