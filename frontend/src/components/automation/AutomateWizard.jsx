/* ===============================================================================
   BAKAL · « Automatiser » · promouvoir un type de signal en déclencheur

   Le mot annonce ce qui arrive. L'ancien bouton disait « Traiter », c'est-à-dire
   du travail à faire à la main, et c'est exactement ce qui a produit 320
   signaux à zéro traité.

   Trois écrans, pas six. Le déclencheur est déjà connu : la sélection de types
   EST sa définition, l'utilisateur n'a rien à rédiger.

     1 · Workflow      nouveau ou existant
     2 · Étapes        seulement si nouveau
     3 · Activation    le récapitulatif, et c'est là que ça s'arme

   Le récapitulatif sépare toujours DEUX conséquences, et ne les fusionne
   jamais en silence :

     - à partir de maintenant, chaque nouveau signal inscrira le contact
     - les N déjà là, qu'un déclencheur événementiel ne verra JAMAIS puisqu'il
       se déclenche à l'insertion

   Le rattrapage est décoché par défaut : la première automatisation de
   quelqu'un ne doit pas commencer par des dizaines d'emails partis d'un coup
   vers ses vrais clients. Mais il doit exister, sinon un backlog de 320 reste
   à 320 pour toujours, même une fois la feature parfaite.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';
import Icon from '../Icon';
import WorkflowEditor, { emptySteps } from './WorkflowEditor';

const SIGNAL_CONTEXT = { contact: true, company: true, signal: true, deal: false, owner: false };

export default function AutomateWizard({ signalTypes, preselected, onClose, onDone }) {
  const t = useT();

  const [step, setStep] = useState(1);
  const [meta, setMeta] = useState(null);            // workflows + hasMailbox + crm
  const [pick, setPick] = useState(null);            // 'new' | workflowId
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(emptySteps);
  const [counts, setCounts] = useState({});          // par type : signaux en attente
  const [backfill, setBackfill] = useState({});      // par type : coché ?
  const [reenroll, setReenroll] = useState('period');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request('/automations')
      .then(d => setMeta(d))
      .catch(() => setMeta({ workflows: [], hasMailbox: false }));
    request('/signals/types')
      .then(d => {
        const map = {};
        (d.families || []).forEach(f => f.types.forEach(ty => { map[ty.signalType] = ty.newCount; }));
        setCounts(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const typeLabels = signalTypes.map(ty => t(`signals.type.${ty}`));
  const triggerSentence = signalTypes.length > 1
    ? t('automation.wizard.sentenceMulti', { types: typeLabels.join(', ') })
    : t('automation.wizard.sentenceOne', { type: typeLabels[0] });

  const arm = async (asDraft) => {
    setBusy(true);
    try {
      // Le rattrapage ne porte que sur ce qui a été explicitement demandé,
      // type par type. Sans sélection venue du panneau, on prend le stock en
      // attente, mais seulement si la case est cochée.
      const backfillIds = {};
      if (!asDraft) {
        for (const ty of signalTypes) {
          if (!backfill[ty]) continue;
          if (preselected && preselected[ty]?.length) {
            backfillIds[ty] = preselected[ty];
          } else {
            const r = await request(`/signals/types/${encodeURIComponent(ty)}/ids`);
            backfillIds[ty] = r.ids || [];
          }
        }
      }

      const body = {
        signalTypes,
        arm: !asDraft,
        backfill: backfillIds,
        reenrollPolicy: reenroll,
      };
      if (pick === 'new') {
        body.workflowName = name.trim();
        body.steps = steps.map(s => (s.type === 'wait'
          ? { type: 'wait', days: s.days }
          : { type: 'email', consigne: s.consigne }));
      } else {
        body.workflowId = pick;
      }

      const result = await request('/automations', { method: 'POST', body });

      const enrolled = Object.values(result.backfill || {})
        .reduce((a, r) => a + (r.enrolled || 0), 0);
      showToast({
        type: 'success',
        title: asDraft ? t('automation.wizard.draftSaved') : t('automation.wizard.armed'),
        message: asDraft
          ? t('automation.wizard.draftSavedBody')
          : t('automation.wizard.armedBody', {
            types: typeLabels.join(', '),
            workflow: result.workflow.name,
            queued: enrolled,
          }),
      });
      onDone(result);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBusy(false);
  };

  const stepNames = [t('automation.wizard.step1'), t('automation.wizard.step2'), t('automation.wizard.step3')];
  const canContinue1 = !!pick;
  const stepsValid = steps.some(s => s.type === 'email')
    && steps.filter(s => s.type === 'email').every(s => String(s.consigne || '').trim())
    && name.trim().length > 0;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(820px, 94vw)', maxHeight: '88vh', overflowY: 'auto', zIndex: 101,
          background: 'var(--bg-card, #fff)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)', boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        }}
      >
        <header style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 650 }}>
              {signalTypes.length > 1
                ? t('automation.wizard.titleMulti', { count: signalTypes.length })
                : t('automation.wizard.titleOne', { type: typeLabels[0] })}
            </span>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-500)' }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {stepNames.map((label, i) => (
              <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span style={{
                  height: 2, borderRadius: 2,
                  background: i + 1 <= step ? 'var(--ink, #1c1917)' : 'var(--border)',
                }} />
                <span style={{
                  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: i + 1 === step ? 'var(--text-primary)' : 'var(--grey-500)',
                }}>{i + 1} · {label}</span>
              </span>
            ))}
          </div>
        </header>

        <div style={{ padding: 20 }}>
          {/* ÉTAPE 1 · quel workflow */}
          {step === 1 && (
            <>
              <div style={{ fontSize: 13.5, marginBottom: 12 }}>
                {t('automation.wizard.question', { sentence: triggerSentence })}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  onClick={() => setPick('new')}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--r-lg)',
                    border: `1px ${pick === 'new' ? 'solid' : 'dashed'} ${pick === 'new' ? 'var(--ink, #1c1917)' : 'var(--border-strong, #d6d3d1)'}`,
                    background: 'var(--paper)', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>+ {t('automation.wizard.newWorkflow')}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('automation.wizard.newWorkflowHint')}
                  </div>
                </button>

                {(meta?.workflows || []).map(w => {
                  const empty = w.stepCount === 0;
                  return (
                    <button
                      key={w.id}
                      disabled={empty}
                      title={empty ? t('automation.wizard.workflowEmpty') : ''}
                      onClick={() => setPick(w.id)}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--r-lg)',
                        border: `1px solid ${pick === w.id ? 'var(--ink, #1c1917)' : 'var(--border)'}`,
                        background: 'var(--paper)', cursor: empty ? 'not-allowed' : 'pointer',
                        opacity: empty ? 0.5 : 1,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {empty
                          ? t('automation.wizard.workflowEmpty')
                          : t('automation.wizard.workflowMeta', { steps: w.stepCount })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ÉTAPE 2 · les étapes du nouveau workflow */}
          {step === 2 && (
            <WorkflowEditor
              name={name}
              onNameChange={setName}
              steps={steps}
              onStepsChange={setSteps}
              triggerSentence={triggerSentence}
              context={SIGNAL_CONTEXT}
              crmProvider={meta?.activeCrmProvider}
            />
          )}

          {/* ÉTAPE 3 · le récapitulatif */}
          {step === 3 && (
            <div style={{ display: 'grid', gap: 14 }}>
              <p style={{ fontSize: 14, margin: 0 }}>
                {t('automation.wizard.recap', {
                  sentence: triggerSentence,
                  workflow: pick === 'new' ? name.trim() : (meta?.workflows.find(w => w.id === pick)?.name || ''),
                })}
              </p>

              <div style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px',
                background: 'var(--paper-2)',
              }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--grey-500)' }}>
                  {t('automation.wizard.fromNowTitle')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {signalTypes.length > 1
                    ? t('automation.wizard.fromNowMulti', { count: signalTypes.length })
                    : t('automation.wizard.fromNowOne', { type: typeLabels[0] })}
                </div>
              </div>

              {signalTypes.map(ty => {
                const pending = preselected?.[ty]?.length ?? counts[ty] ?? 0;
                const fromPanel = !!preselected?.[ty]?.length;
                return (
                  <div
                    key={ty}
                    style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}
                  >
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--grey-500)' }}>
                      {t('automation.wizard.pendingTitle', { count: counts[ty] ?? 0, type: t(`signals.type.${ty}`) })}
                    </div>
                    {pending > 0 ? (
                      <>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6, fontSize: 13, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!backfill[ty]}
                            onChange={() => setBackfill(b => ({ ...b, [ty]: !b[ty] }))}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            {fromPanel
                              ? t('automation.wizard.backfillSelected', { count: pending })
                              : t('automation.wizard.backfillPending', { count: pending })}
                          </span>
                        </label>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4, marginLeft: 22 }}>
                          {t('automation.wizard.backfillHint')}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>
                        {t('automation.wizard.backfillNone')}
                      </div>
                    )}
                  </div>
                );
              })}

              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--grey-500)', marginBottom: 6 }}>
                  {t('automation.wizard.reenrollTitle')}
                </div>
                {[
                  ['never', t('automation.wizard.reenrollNever')],
                  ['period', t('automation.wizard.reenrollPeriod')],
                  ['always', t('automation.wizard.reenrollAlways')],
                ].map(([k, label]) => (
                  <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
                    <input type="radio" name="reenroll" checked={reenroll === k} onChange={() => setReenroll(k)} />
                    {label}
                  </label>
                ))}
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('automation.wizard.reenrollHint')}
                </div>
              </div>

              {meta && !meta.hasMailbox && (
                <div style={{
                  fontSize: 12.5, padding: '10px 12px', borderRadius: 'var(--r-lg)',
                  background: 'var(--warning-soft, #fef3c7)', border: '1px solid var(--warning, #d97706)',
                }}>
                  {t('automation.wizard.noMailbox')}
                </div>
              )}
            </div>
          )}
        </div>

        <footer style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
          >
            {step === 1 ? t('common.cancel') : t('common.back')}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step === 1 && (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 16px', opacity: canContinue1 ? 1 : 0.45 }}
                disabled={!canContinue1}
                onClick={() => setStep(pick === 'new' ? 2 : 3)}
              >
                {t('common.continue')}
              </button>
            )}
            {step === 2 && (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 16px', opacity: stepsValid ? 1 : 0.45 }}
                disabled={!stepsValid}
                onClick={() => setStep(3)}
              >
                {t('automation.wizard.toActivation')}
              </button>
            )}
            {step === 3 && (
              <>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  disabled={busy}
                  onClick={() => arm(true)}
                >
                  {t('automation.wizard.keepDraft')}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 16px' }}
                  disabled={busy}
                  onClick={() => arm(false)}
                >
                  {signalTypes.length > 1
                    ? t('automation.wizard.armN', { count: signalTypes.length })
                    : t('automation.wizard.armOne')}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </>
  );
}
