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
        {/* Spinner: pulsing mark */}
        <div style={{
          width: 48, height: 48,
          background: 'var(--ink)',
          borderRadius: 12,
          position: 'relative',
          overflow: 'hidden',
          animation: 'baakalai-pulse 1.4s ease-in-out infinite',
        }}>
          <div style={{
            position: 'absolute',
            inset: '8px 8px 20px 8px',
            background: 'var(--primary)',
            borderRadius: 4,
          }} />
          <div style={{
            position: 'absolute',
            left: 8, right: 8, bottom: 8, height: 6,
            background: 'var(--lavender)',
            borderRadius: 2,
          }} />
        </div>

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
