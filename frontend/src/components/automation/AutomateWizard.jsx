/* ===============================================================================
   BAKAL · Créer une automatisation

   Deux portes d'entrée, une seule mécanique.

   - Depuis Signaux : un type est déjà choisi, la sélection EST la définition du
     déclencheur, l'utilisateur n'a rien à rédiger.
   - Depuis Déclencheurs : on part du catalogue d'événements. Indispensable,
     parce qu'un compte neuf n'a aucun signal : si la promotion était la seule
     porte, il n'y aurait littéralement aucun moyen de créer quoi que ce soit
     tant que la veille n'a pas tourné.

   Un déclencheur sur un type de signal ne demande AUCUN signal existant : il
   s'arme pour l'avenir. Le stock en attente n'est qu'une option de rattrapage.

   Le mot « Automatiser » annonce ce qui arrive. L'ancien bouton disait
   « Traiter », c'est-à-dire du travail à faire à la main, et c'est exactement
   ce qui a produit 320 signaux à zéro traité.

   Le récapitulatif sépare toujours DEUX conséquences, et ne les fusionne
   jamais en silence : armer pour l'avenir, et inscrire les N déjà là. Le
   rattrapage est décoché par défaut, mais il doit exister, sinon un backlog de
   320 reste à 320 pour toujours puisqu'un déclencheur événementiel ne se
   déclenche qu'à l'insertion.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';
import Icon from '../Icon';
import WorkflowEditor, { emptySteps } from './WorkflowEditor';
import { triggerSentence as sentenceOf } from './triggerLabels';

const SIGNAL_CONTEXT = { contact: true, company: true, signal: true, deal: false, owner: false };
// Un événement CRM porte un deal : le montant, l'étape et le propriétaire
// deviennent disponibles dans les étapes, là où un signal ne les a pas.
const CRM_CONTEXT = { contact: true, company: true, signal: false, deal: true, owner: true };

// `deal_stage_changed` est branché. Les deux autres ne le sont pas, et pas par
// manque de temps : ils se déclencheraient sur chaque ligne d'un import CRM,
// donc un premier import inscrirait la base entière.
const CRM_EVENTS = ['deal_stage_changed', 'deal_created', 'contact_created'];
const WIRED_CRM_EVENTS = ['deal_stage_changed'];
const EMAIL_EVENTS = ['reply_received', 'no_reply_days'];

export default function AutomateWizard({ signalTypes, preselected, mode, onClose, onDone }) {
  const t = useT();
  const fromCatalog = mode === 'catalog';

  const [step, setStep] = useState(fromCatalog ? 0 : 1);
  const [meta, setMeta] = useState(null);
  const [typesData, setTypesData] = useState(null);
  const [typesError, setTypesError] = useState(false);
  const [picked, setPicked] = useState(signalTypes || []);
  const [crmSel, setCrmSel] = useState(null);   // { eventKey, toStages: [] }
  const [stageData, setStageData] = useState(null);
  const [pick, setPick] = useState(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(emptySteps);
  const [backfill, setBackfill] = useState({});
  const [reenroll, setReenroll] = useState('period');
  const [busy, setBusy] = useState(false);

  // Un appel qui échoue ne doit JAMAIS se traduire par une liste vide et
  // muette : c'est exactement ce qui rend un écran indiagnosticable, on ne
  // peut plus distinguer « il n'y a rien » de « ça n'a pas chargé ».
  const loadTypes = useCallback(() => {
    setTypesError(false);
    request('/signals/types')
      .then(setTypesData)
      .catch(() => { setTypesData({ families: [] }); setTypesError(true); });
  }, []);

  useEffect(() => {
    request('/automations')
      .then(setMeta)
      .catch(() => setMeta({ workflows: [], hasMailbox: false }));
    loadTypes();
    request('/automations/stages')
      .then(setStageData)
      .catch(() => setStageData({ stages: [], provider: null, latency: 'none' }));
  }, [loadTypes]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const types = signalTypes && signalTypes.length ? signalTypes : picked;
  const typeLabels = types.map(ty => t(`signals.type.${ty}`));

  // Un type déjà automatisé ne peut pas l'être une seconde fois : l'index
  // unique côté base le refuse, autant le dire avant.
  const counts = {};
  const automated = {};
  (typesData?.families || []).forEach(f => f.types.forEach(ty => {
    counts[ty.signalType] = ty.newCount;
    if (ty.automated) automated[ty.signalType] = ty.automated;
  }));

  const hasCrm = !!(crmSel && crmSel.toStages.length > 0);
  const triggerSentence = hasCrm && types.length === 0
    ? sentenceOf(t, { eventSource: 'crm_event', eventKey: crmSel.eventKey, conditions: { toStages: crmSel.toStages } })
    : (types.length > 1
      ? t('automation.wizard.sentenceMulti', { types: typeLabels.join(', ') })
      : t('automation.wizard.sentenceOne', { type: typeLabels[0] || '' }));

  const toggleType = (ty) => setPicked(p => (p.includes(ty) ? p.filter(x => x !== ty) : [...p, ty]));

  const arm = async (asDraft) => {
    setBusy(true);
    try {
      const backfillIds = {};
      if (!asDraft) {
        for (const ty of types) {
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
        signalTypes: types,
        crmEvents: hasCrm
          ? [{ eventKey: crmSel.eventKey, conditions: { toStages: crmSel.toStages } }]
          : [],
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

      const result = await request('/automations', { method: 'POST', body: JSON.stringify(body) });
      const enrolled = Object.values(result.backfill || {}).reduce((a, r) => a + (r.enrolled || 0), 0);

      showToast({
        type: 'success',
        title: asDraft ? t('automation.wizard.draftSaved') : t('automation.wizard.armed'),
        message: asDraft
          ? t('automation.wizard.draftSavedBody')
          : t('automation.wizard.armedBody', {
            types: typeLabels.length ? typeLabels.join(', ') : triggerSentence,
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

  const stepList = fromCatalog
    ? [t('automation.wizard.step0'), t('automation.wizard.step1'), t('automation.wizard.step3')]
    : [t('automation.wizard.step1'), t('automation.wizard.step2'), t('automation.wizard.step3')];
  const stepIndex = fromCatalog ? step : step - 1;

  const stepsValid = steps.some(s => s.type === 'email')
    && steps.filter(s => s.type === 'email').every(s => String(s.consigne || '').trim())
    && name.trim().length > 0;

  const EventButton = ({ label, sub, off, selected, onClick }) => (
    <button
      disabled={!!off}
      title={off || ''}
      onClick={onClick}
      style={{
        textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--r-lg)',
        border: `1px solid ${selected ? 'var(--text-primary)' : 'var(--border)'}`,
        background: selected ? 'var(--bg-elevated)' : 'var(--bg-card)',
        color: 'var(--text-primary)',
        cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1, width: '100%',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: selected ? 600 : 500 }}>{label}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{off || sub}</div>
    </button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(820px, 94vw)', maxHeight: '88vh', overflowY: 'auto', zIndex: 101,
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <header style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 650 }}>
              {types.length > 1
                ? t('automation.wizard.titleMulti', { count: types.length })
                : (types.length === 1
                  ? t('automation.wizard.titleOne', { type: typeLabels[0] })
                  : t('automation.wizard.titleCatalog'))}
            </span>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {stepList.map((label, i) => (
              <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span style={{
                  height: 2, borderRadius: 2,
                  background: i <= stepIndex ? 'var(--text-primary)' : 'var(--border)',
                }} />
                <span style={{
                  fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: i === stepIndex ? 'var(--text-primary)' : 'var(--text-muted)',
                }}>{i + 1} · {label}</span>
              </span>
            ))}
          </div>
        </header>

        <div style={{ padding: 20 }}>
          {/* ÉTAPE 0 · l'événement. Le choix, rien d'autre : les conditions
              d'entrée ne doivent pas être un formulaire posé avant que
              l'utilisateur ait écrit son premier email. */}
          {step === 0 && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div style={{ fontSize: 13.5 }}>{t('automation.wizard.pickEvent')}</div>

              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t('automation.wizard.family.veille')}
                </div>
                {typesData === null && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
                )}
                {typesError && (
                  <div style={{ fontSize: 12.5, color: 'var(--warning)', display: 'flex', gap: 10, alignItems: 'center' }}>
                    {t('automation.wizard.typesError')}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={loadTypes}
                    >
                      {t('automation.wizard.retry')}
                    </button>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {(typesData?.families?.find(f => f.key === 'veille')?.types || []).map(ty => (
                    <EventButton
                      key={ty.signalType}
                      label={t(`signals.type.${ty.signalType}`)}
                      // Le compte est une information, pas une condition : un
                      // type à zéro s'arme très bien, il attend simplement.
                      sub={ty.newCount > 0
                        ? t('automation.wizard.pendingCount', { count: ty.newCount })
                        : t('automation.wizard.noPending')}
                      off={automated[ty.signalType]
                        ? t('automation.wizard.alreadyAutomated', { workflow: automated[ty.signalType].workflowName })
                        : null}
                      selected={picked.includes(ty.signalType)}
                      onClick={() => toggleType(ty.signalType)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t('automation.wizard.family.crm')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('automation.wizard.familyCrmEmpty')}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t('automation.wizard.family.crmEvent')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {CRM_EVENTS.map(k => (
                    <EventButton
                      key={k}
                      label={t(`automation.wizard.event.${k}`)}
                      sub={k === 'deal_stage_changed' ? t(`automation.wizard.latency.${stageData?.latency || 'none'}`) : ''}
                      off={WIRED_CRM_EVENTS.includes(k) ? null : t('automation.wizard.notWiredImport')}
                      selected={crmSel?.eventKey === k}
                      onClick={() => setCrmSel(crmSel?.eventKey === k ? null : { eventKey: k, toStages: [] })}
                    />
                  ))}
                </div>

                {/* L'étape cible n'est pas un raffinement : sans elle, le
                    déclencheur partirait à chaque mouvement du pipeline, dans
                    les deux sens, y compris sur une correction de saisie. */}
                {crmSel?.eventKey === 'deal_stage_changed' && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 'var(--r-lg)',
                    border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                  }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
                      {t('automation.wizard.pickStage')}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {t('automation.wizard.pickStageHint')}
                    </div>
                    {stageData === null && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
                    )}
                    {stageData && stageData.stages.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--warning)' }}>
                        {t('automation.wizard.noStages')}
                      </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(stageData?.stages || []).map(st => {
                        const on = crmSel.toStages.includes(st.stage);
                        return (
                          <button
                            key={st.stage}
                            onClick={() => setCrmSel(c => ({
                              ...c,
                              toStages: on
                                ? c.toStages.filter(x => x !== st.stage)
                                : [...c.toStages, st.stage],
                            }))}
                            style={{
                              fontSize: 12, padding: '4px 12px', borderRadius: 'var(--r-full)',
                              border: `1px solid ${on ? 'var(--text-primary)' : 'var(--border)'}`,
                              background: on ? 'var(--bg-card)' : 'transparent',
                              color: 'var(--text-primary)', cursor: 'pointer',
                              fontWeight: on ? 600 : 400,
                            }}
                          >
                            {st.stage}
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {st.deals}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {t('automation.wizard.family.emailEvent')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                  {EMAIL_EVENTS.map(k => (
                    <EventButton
                      key={k}
                      label={t(`automation.wizard.event.${k}`)}
                      off={t('automation.wizard.notWiredEvent')}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

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
                    border: `1px ${pick === 'new' ? 'solid' : 'dashed'} ${pick === 'new' ? 'var(--text-primary)' : 'var(--border-strong)'}`,
                    background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer',
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
                        border: `1px solid ${pick === w.id ? 'var(--text-primary)' : 'var(--border)'}`,
                        background: 'var(--bg-card)', color: 'var(--text-primary)',
                        cursor: empty ? 'not-allowed' : 'pointer', opacity: empty ? 0.5 : 1,
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
              context={hasCrm && types.length === 0 ? CRM_CONTEXT : SIGNAL_CONTEXT}
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
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                padding: '12px 14px', background: 'var(--bg-elevated)',
              }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  {t('automation.wizard.fromNowTitle')}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {hasCrm && types.length === 0
                    ? t('automation.wizard.fromNowStage')
                    : (types.length > 1
                      ? t('automation.wizard.fromNowMulti', { count: types.length })
                      : t('automation.wizard.fromNowOne', { type: typeLabels[0] }))}
                </div>
              </div>

              {types.map(ty => {
                const pending = preselected?.[ty]?.length ?? counts[ty] ?? 0;
                const fromPanel = !!preselected?.[ty]?.length;
                return (
                  <div key={ty} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
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
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
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
                  background: 'var(--warning-soft)', border: '1px solid var(--warning)',
                  color: 'var(--text-primary)',
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
            onClick={() => {
              const first = fromCatalog ? 0 : 1;
              if (step === first) return onClose();
              // Retour depuis l'activation : on saute l'éditeur si le workflow
              // choisi était un existant, il n'a jamais été affiché.
              if (step === 3 && pick !== 'new') return setStep(1);
              setStep(step - 1);
            }}
          >
            {step === (fromCatalog ? 0 : 1) ? t('common.cancel') : t('common.back')}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step === 0 && (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 16px', opacity: (picked.length || hasCrm) ? 1 : 0.45 }}
                disabled={picked.length === 0 && !hasCrm}
                onClick={() => setStep(1)}
              >
                {t('common.continue')}
              </button>
            )}
            {step === 1 && (
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: '6px 16px', opacity: pick ? 1 : 0.45 }}
                disabled={!pick}
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
                  {types.length > 1
                    ? t('automation.wizard.armN', { count: types.length })
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
