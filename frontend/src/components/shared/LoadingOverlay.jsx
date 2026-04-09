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
          background: 'var(--bg-card, #18181b)',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          borderRadius: 16,
          padding: '40px 48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 24,
          maxWidth: 420,
          boxShadow: '0 25px 80px rgba(0,0,0,0.5)',
        }}
      >
        {/* Spinner: 3 chevrons echoing the Baakalai logo */}
        <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
          <polyline
            points="18,14 38,36 18,58"
            stroke="#2AB7CA"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            style={{ animation: 'baakalai-pulse 1.4s ease-in-out 0s infinite' }}
          />
          <polyline
            points="30,14 50,36 30,58"
            stroke="#FED766"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            style={{ animation: 'baakalai-pulse 1.4s ease-in-out 0.2s infinite' }}
          />
          <polyline
            points="42,14 62,36 42,58"
            stroke="#FE4A49"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            style={{ animation: 'baakalai-pulse 1.4s ease-in-out 0.4s infinite' }}
          />
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
          0%, 100% { opacity: 0.3; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes baakalai-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
