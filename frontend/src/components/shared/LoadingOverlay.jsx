/* ═══════════════════════════════════════════════════
   Full-screen blur loading overlay with spinner + message
   Used for long-running actions (Lemlist launch, etc.)
   ═══════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

/**
 * @param {boolean} show        — whether to display the overlay
 * @param {string}  title       — main headline (e.g. "Déploiement vers Lemlist…")
 * @param {string[]} steps      — optional cycling sub-messages (e.g. ["Création de la campagne", "Push des séquences"])
 * @param {number}  stepInterval — ms between step cycling (default 1800)
 */
export default function LoadingOverlay({ show, title, steps = [], stepInterval = 1800 }) {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!show || steps.length <= 1) return;
    const t = setInterval(() => {
      setStepIdx((i) => (i + 1) % steps.length);
    }, stepInterval);
    return () => clearInterval(t);
  }, [show, steps, stepInterval]);

  // Reset step index when overlay closes so next open starts at 0
  useEffect(() => {
    if (!show) setStepIdx(0);
  }, [show]);

  if (!show) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(10, 10, 15, 0.55)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font)',
      }}
    >
      <div
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '40px 48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          maxWidth: 420,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Spinner: animated hub + satellites logo */}
        <svg width="64" height="64" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ animation: 'baakalai-pulse 1.4s ease-in-out infinite' }}>
          <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" style={{ animation: 'baakalai-line 1.4s ease-in-out 0s infinite' }} />
          <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round" style={{ animation: 'baakalai-line 1.4s ease-in-out 0.2s infinite' }} />
          <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round" style={{ animation: 'baakalai-line 1.4s ease-in-out 0.4s infinite' }} />
          <circle cx="22" cy="26" r="7" fill="#C4B5FD" style={{ animation: 'baakalai-node 1.4s ease-in-out 0s infinite' }} />
          <circle cx="82" cy="30" r="8" fill="#9A84EB" style={{ animation: 'baakalai-node 1.4s ease-in-out 0.2s infinite' }} />
          <circle cx="30" cy="80" r="7" fill="#C4B5FD" style={{ animation: 'baakalai-node 1.4s ease-in-out 0.4s infinite' }} />
          <circle cx="50" cy="50" r="13" fill="#6E57FA" />
        </svg>

        {/* Title */}
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary, #fff)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {title}
        </div>

        {/* Cycling step message */}
        {steps.length > 0 && (
          <div
            key={stepIdx}
            style={{
              fontSize: 13,
              color: 'var(--text-secondary, rgba(255,255,255,0.65))',
              textAlign: 'center',
              minHeight: 18,
              animation: 'baakalai-fade-in 0.4s ease',
            }}
          >
            {steps[stepIdx]}
          </div>
        )}
      </div>

      {/* Keyframes injected once via a <style> tag */}
      <style>{`
        @keyframes baakalai-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes baakalai-node {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes baakalai-line {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.8; }
        }
        @keyframes baakalai-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
