/* ═══════════════════════════════════════════════════
   Optimize Campaign Modal — 2-step flow
   Step 1: Diagnostic + touchpoint selection
   Step 2: Variant validation + deploy to Lemlist
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api-client';
import { sanitizeHtml } from '../../services/sanitize';
import { useI18n } from '../../i18n';

export default function OptimizeCampaignModal({ campaign, onClose, onSuccess }) {
  const { lang } = useI18n(); const en = lang === 'en';
  const [step, setStep] = useState(1); // 1 = diagnostic, 2 = validation
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [selectedSteps, setSelectedSteps] = useState(new Set());
  const [hypothesis, setHypothesis] = useState('');
  const [forceResolve, setForceResolve] = useState(false);
  const [forceCooldown, setForceCooldown] = useState(false);

  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState(null);
  const [deploying, setDeploying] = useState(false);

  /* ── Step 1: Fetch diagnostic on mount ── */
  useEffect(() => {
    let cancelled = false;
    async function loadDiagnostic() {
      setLoading(true);
      setError(null);
      try {
        const backendId = campaign._backendId || campaign.id;
        const data = await api.diagnoseCampaign(backendId);
        if (cancelled) return;
        setDiagnostic(data);
        // Pre-check the recommended touchpoints
        const recommended = new Set((data.recommendations || []).map(r => r.step));
        setSelectedSteps(recommended);
        if (data.recommendations && data.recommendations[0]) {
          setHypothesis(data.recommendations[0].reason || '');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || (en ? 'Error during diagnostic' : 'Erreur lors du diagnostic'));
      }
      if (!cancelled) setLoading(false);
    }
    loadDiagnostic();
    return () => { cancelled = true; };
  }, [campaign._backendId, campaign.id]);

  const toggleStep = (stepKey) => {
    setSelectedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepKey)) next.delete(stepKey);
      else {
        if (next.size >= 2) return prev; // max 2
        next.add(stepKey);
      }
      return next;
    });
  };

  /* ── Step 1 → 2: Run optimization ── */
  const handleGenerate = useCallback(async () => {
    setOptimizing(true);
    setError(null);
    try {
      const backendId = campaign._backendId || campaign.id;
      const data = await api.optimizeCampaign(backendId, {
        touchpointSteps: Array.from(selectedSteps),
        hypothesis,
        forceResolveExisting: forceResolve,
      });
      setResult(data);
      setStep(2);
    } catch (err) {
      // If the error is about unresolved active test, offer force option
      if (err.message && err.message.includes('ACTIVE_TEST')) {
        setError(en ? 'An A/B test is running and not yet conclusive. Enable "Force resolution" then retry.' : 'Un test A/B est en cours et pas encore concluant. Active "Forcer la résolution" puis relance.');
      } else {
        setError(err.message || (en ? 'Error during optimization' : 'Erreur lors de l\'optimisation'));
      }
    }
    setOptimizing(false);
  }, [campaign, selectedSteps, hypothesis, forceResolve]);

  /* ── Step 2: Close after successful deploy ── */
  const handleComplete = useCallback(() => {
    if (onSuccess) onSuccess(result);
    onClose();
  }, [onClose, onSuccess, result]);

  if (loading) {
    return (
      <ModalShell onClose={onClose} title={en ? 'Analyzing' : 'Analyse en cours'}>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {en ? 'Baakalai is analyzing your campaign performance...' : 'Baakalai analyse les performances de ta campagne...'}
          </div>
        </div>
      </ModalShell>
    );
  }

  if (error && !result) {
    return (
      <ModalShell onClose={onClose} title={en ? 'Error' : 'Erreur'}>
        <div style={{ padding: 24 }}>
          <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>{en ? 'Close' : 'Fermer'}</button>
        </div>
      </ModalShell>
    );
  }

  // Guard: blocked by minimum data
  if (diagnostic && !diagnostic.guards.canOptimize) {
    return (
      <ModalShell onClose={onClose} title={en ? 'Optimization unavailable' : 'Optimisation indisponible'}>
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
            {diagnostic.guards.blockedReason}
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12 }}>{en ? 'Close' : 'Fermer'}</button>
        </div>
      </ModalShell>
    );
  }

  /* ── Step 2: Variant validation ── */
  if (step === 2 && result) {
    return (
      <ModalShell onClose={onClose} title={en ? 'Step 2/2 — Validate generated variant' : 'Étape 2/2 — Valider la variante générée'} wide>
        <div style={{ padding: 24 }}>
          {result.abResolved && (
            <div
              style={{
                background: 'rgba(0, 214, 143, 0.08)',
                border: '1px solid rgba(0, 214, 143, 0.25)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 20,
                fontSize: 12,
                color: 'var(--success)',
              }}
            >
              {en
                ? `Previous A/B test resolved: variant ${result.abResolved.winner} promoted${result.abResolved.improvement ? ` (+${result.abResolved.improvement}%)` : ''}${result.abResolved.forced ? ' (forced)' : ' (auto)'}.`
                : `✅ Test A/B précédent résolu : variante ${result.abResolved.winner} promue${result.abResolved.improvement ? ` (+${result.abResolved.improvement}%)` : ''}${result.abResolved.forced ? ' (forcé)' : ' (auto)'}.`}
            </div>
          )}

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            {en ? 'Baakalai generated a new variant B for the selected touchpoints. Review before deploying to Lemlist.' : 'Baakalai a généré une nouvelle variante B pour les touchpoints sélectionnés. Vérifie avant de déployer vers Lemlist.'}
          </div>

          {(result.variants || []).map(v => (
            <VariantDiff key={v.step} variant={v} />
          ))}

          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
              marginTop: 24,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
            }}
          >
            <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12, padding: '10px 18px' }}>
              {en ? 'Close' : 'Fermer'}
            </button>
            <button
              className="btn btn-success"
              onClick={handleComplete}
              style={{ fontSize: 12, padding: '10px 18px' }}
              disabled={deploying}
            >
              {en ? 'Variant deployed — Close' : '✅ Variante déployée — Fermer'}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  /* ── Step 1: Diagnostic ── */
  const guards = diagnostic?.guards || {};
  const stats = diagnostic?.stats || {};
  const abTest = diagnostic?.abTest || { hadTest: false };
  const touchpointList = stats.touchpoints || [];
  const recommendedSteps = new Set((diagnostic?.recommendations || []).map(r => r.step));

  const selectedOverBudget = selectedSteps.size > 2;
  const blockedByCooldown = guards.cooldownActive && !forceCooldown;
  const blockedByActiveTest = abTest.hadTest && !abTest.resolved && abTest.canForce && !forceResolve;
  const canGenerate = selectedSteps.size > 0 && !selectedOverBudget && !blockedByCooldown && !blockedByActiveTest;

  return (
    <ModalShell onClose={onClose} title={en ? 'Step 1/2 — Diagnostic and selection' : 'Étape 1/2 — Diagnostic et sélection'} wide>
      <div style={{ padding: 24 }}>
        {/* Warnings */}
        {guards.warningReason && (
          <div
            style={{
              background: 'rgba(255, 170, 0, 0.08)',
              border: '1px solid rgba(255, 170, 0, 0.25)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--warning)',
              lineHeight: 1.5,
            }}
          >
            ⚠️ {guards.warningReason}
          </div>
        )}

        {guards.cooldownActive && (
          <div
            style={{
              background: 'rgba(108, 92, 231, 0.08)',
              border: '1px solid rgba(108, 92, 231, 0.25)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--accent)',
              lineHeight: 1.5,
            }}
          >
            ⏳ {guards.cooldownWarning}
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 11, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={forceCooldown}
                  onChange={e => setForceCooldown(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                {en ? 'Optimize anyway (override)' : 'Optimiser quand même (override)'}
              </label>
            </div>
          </div>
        )}

        {abTest.hadTest && abTest.canForce && (
          <div
            style={{
              background: 'rgba(255, 170, 0, 0.08)',
              border: '1px solid rgba(255, 170, 0, 0.25)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--warning)',
              lineHeight: 1.5,
            }}
          >
            {en
              ? `🧬 An A/B test is currently running on this campaign but hasn't reached significance yet (${abTest.daysSinceStart}d, ${abTest.audience} prospects). Current leader: `
              : `🧬 Un test A/B est actuellement en cours sur cette campagne mais n'a pas encore atteint son seuil de significativité (${abTest.daysSinceStart}j, ${abTest.audience} prospects). Leader actuel : `}
            <strong>{en ? 'Variant' : 'Variante'} {abTest.leader}</strong>
            {abTest.improvement ? ` (+${abTest.improvement}%)` : ''}.
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 11, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={forceResolve}
                  onChange={e => setForceResolve(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                {en ? 'Force promote current leader to launch a new optimization' : 'Forcer la promotion du leader actuel pour lancer une nouvelle optimisation'}
              </label>
            </div>
          </div>
        )}

        {/* Recommendation */}
        {diagnostic?.recommendations && diagnostic.recommendations.length > 0 && (
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--blue)',
              lineHeight: 1.5,
            }}
          >
            💡 <strong>{en ? 'Baakalai recommendation:' : 'Recommandation Baakalai :'}</strong>
            {diagnostic.recommendations.map(r => (
              <div key={r.step} style={{ marginTop: 4 }}>
                {en ? 'Regenerate' : 'Régénérer'} <strong>{r.step}</strong> — {r.reason}
              </div>
            ))}
          </div>
        )}

        {/* Touchpoint list */}
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
          {en ? `Touchpoints to optimize (${selectedSteps.size}/2 selected)` : `Touchpoints à optimiser (${selectedSteps.size}/2 sélectionnés)`}
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
          {touchpointList.map(tp => {
            const isSelected = selectedSteps.has(tp.step);
            const isRecommended = recommendedSteps.has(tp.step);
            return (
              <div
                key={tp.step}
                onClick={() => toggleStep(tp.step)}
                style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  background: isSelected ? 'var(--bg-elevated)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  readOnly
                  disabled={!isSelected && selectedSteps.size >= 2}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {tp.step} — {tp.label || tp.type}
                    {isRecommended && (
                      <span
                        style={{
                          fontSize: 9,
                          background: 'rgba(59, 130, 246, 0.15)',
                          color: 'var(--blue)',
                          padding: '2px 6px',
                          borderRadius: 8,
                          fontWeight: 700,
                        }}
                      >
                        {en ? 'RECOMMENDED' : 'RECOMMANDÉ'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {tp.stats.open != null && `Ouv ${tp.stats.open}%`}
                    {tp.stats.reply != null && ` · Rép ${tp.stats.reply}%`}
                    {tp.stats.accept != null && ` · Acc ${tp.stats.accept}%`}
                  </div>
                  {tp.signals && tp.signals.length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
                      ⚠️ {tp.signals.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hypothesis */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4, display: 'block' }}>
            {en ? 'Test hypothesis (optional)' : 'Hypothèse de test (optionnel)'}
          </label>
          <textarea
            className="form-input"
            value={hypothesis}
            onChange={e => setHypothesis(e.target.value)}
            placeholder="Ex: Tester un angle plus spécifique au secteur avec une preuve sociale chiffrée"
            rows={2}
            style={{ fontSize: 12, resize: 'vertical', width: '100%' }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>⚠️ {error}</div>
        )}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            paddingTop: 16,
            borderTop: '1px solid var(--border)',
          }}
        >
          <button className="btn btn-ghost" onClick={onClose} disabled={optimizing} style={{ fontSize: 12, padding: '10px 18px' }}>
            {en ? 'Cancel' : 'Annuler'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={!canGenerate || optimizing}
            style={{ fontSize: 12, padding: '10px 18px' }}
          >
            {optimizing ? (en ? 'Generating...' : '✨ Génération...') : (en ? 'Generate variant →' : 'Générer la variante →')}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ─── Sub-components ─── */

function ModalShell({ children, onClose, title, wide }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          maxWidth: wide ? 720 : 480,
          width: '90%',
          maxHeight: '88vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>🔄 {title}</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function VariantDiff({ variant }) {
  const { lang } = useI18n(); const en = lang === 'en';
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>{variant.step}</div>
      {variant.hypothesis && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--accent)',
            background: 'rgba(108, 92, 231, 0.08)',
            padding: '4px 8px',
            borderRadius: 6,
            marginBottom: 10,
            fontStyle: 'italic',
          }}
        >
          💡 {variant.hypothesis}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
            {en ? 'CURRENT (A)' : 'ACTUEL (A)'}
          </div>
          {variant.a.subject && (
            <div style={{ fontSize: 11, fontStyle: 'italic', marginBottom: 4 }}>
              Objet : {variant.a.subject}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              padding: 8,
              background: 'var(--bg-elevated)',
              borderRadius: 6,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(variant.a.body || '') }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>
            {en ? 'NEW VARIANT (B)' : 'NOUVELLE VARIANTE (B)'} 🆕
          </div>
          {variant.b.subject && (
            <div style={{ fontSize: 11, fontStyle: 'italic', marginBottom: 4 }}>
              Objet : {variant.b.subject}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              padding: 8,
              background: 'rgba(0, 214, 143, 0.06)',
              border: '1px solid rgba(0, 214, 143, 0.2)',
              borderRadius: 6,
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(variant.b.body || '') }}
          />
        </div>
      </div>
    </div>
  );
}
