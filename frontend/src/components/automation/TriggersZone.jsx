/* ===============================================================================
   BAKAL · Déclencheurs et workflows

   Une ligne par couple : quand ceci, faire cela. Un déclencheur dit quand, un
   workflow dit quoi, et plusieurs déclencheurs peuvent pointer vers le même
   workflow.

   Les états d'échec sont traités ici comme des états de première classe, pas
   comme des exceptions à cacher. Un cimetière d'automatisations muettes est le
   même échec qu'un backlog de signaux jamais traités : il se règle en le
   rendant visible avec une action, pas en l'omettant.

     Actif                     il tourne
     Jamais déclenché          des événements sont passés, aucun n'est entré
     En attente d'un événement armé, mais rien de ce type n'est encore arrivé
     En attente d'une boîte    armé, mais rien ne peut partir
     En pause automatique      le disjoncteur a coupé, relance manuelle
     Brouillon, non armé       rien ne part

   La distinction « jamais déclenché » contre « en attente d'un événement »
   n'est pas cosmétique : la première appelle une correction, la seconde est un
   silence normal. Un seuil en jours les confondrait, et se tromperait sur les
   déclencheurs rares.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import WorkflowEditor, { emptySteps } from './WorkflowEditor';
import AutomateWizard from './AutomateWizard';

function fmtDate(iso, en) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' });
}

/** L'état réel du couple, déduit et non stocké pour les cas contextuels. */
function stateOf(trig, hasMailbox) {
  if (trig.status === 'draft') return 'draft';
  if (trig.status === 'breaker') return 'breaker';
  if (trig.status === 'paused') return 'paused';
  if (!hasMailbox) return 'nobox';
  if (trig.enteredTotal === 0 && trig.skippedCount > 0) return 'silent';
  if (trig.enteredTotal === 0) return 'waiting';
  return 'active';
}

const STATE_COLOR = {
  active: 'var(--success)',
  silent: 'var(--warning)',
  waiting: 'var(--grey-500)',
  nobox: 'var(--warning)',
  breaker: 'var(--danger)',
  paused: 'var(--grey-500)',
  draft: 'var(--grey-400)',
};

export default function TriggersZone({ hasMailbox, onChanged }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';

  const [data, setData] = useState(null);
  const [view, setView] = useState('trig');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newWorkflow, setNewWorkflow] = useState(false);

  const load = useCallback(() => {
    request('/automations').then(setData).catch(() => setData({ triggers: [], workflows: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (trig, status, confirmBreaker) => {
    try {
      await request(`/automations/${trig.id}`, {
        method: 'PATCH',
        body: { status, ...(confirmBreaker ? { confirmBreaker: true } : {}) },
      });
      load();
      if (onChanged) onChanged();
    } catch (err) {
      if (err.code === 'breaker_confirm_required') {
        // Relancer un déclencheur que le disjoncteur a arrêté est une
        // décision : on ne reprend jamais tout seul, parce qu'une reprise
        // automatique rejoue exactement la même avalanche.
        if (window.confirm(t('automation.triggers.breakerConfirm'))) {
          setStatus(trig, status, true);
          return;
        }
        return;
      }
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  const remove = async (trig) => {
    if (!window.confirm(t('automation.triggers.deleteConfirm', { label: t(`signals.type.${trig.eventKey}`) }))) return;
    try {
      await request(`/automations/${trig.id}`, { method: 'DELETE' });
      load();
      if (onChanged) onChanged();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  if (!data) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>{t('common.loading')}</div>;
  }

  if (editing) {
    return (
      <WorkflowEditPanel
        workflowId={editing}
        crmProvider={data.activeCrmProvider}
        onClose={() => { setEditing(null); load(); }}
      />
    );
  }

  if (newWorkflow) {
    return (
      <WorkflowCreatePanel
        crmProvider={data.activeCrmProvider}
        onClose={() => { setNewWorkflow(false); load(); }}
      />
    );
  }

  const triggers = data.triggers || [];
  const workflows = data.workflows || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--paper-2)', borderRadius: 10 }}>
          {[['trig', t('automation.triggers.byTrigger')], ['wf', t('automation.triggers.byWorkflow')]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              style={{
                padding: '5px 14px', border: 'none', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: view === k ? 'var(--bg-card)' : 'transparent',
                color: view === k ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: view === k ? 600 : 400,
              }}
            >{label}</button>
          ))}
        </div>

        {/* La création ne dépend d'aucun signal existant. Un compte neuf n'en a
            aucun : si la promotion d'un type était la seule porte d'entrée, il
            n'y aurait aucun moyen de créer quoi que ce soit tant que la veille
            n'a pas tourné. */}
        <div style={{ display: 'flex', gap: 8 }}>
          {view === 'wf' && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '5px 14px' }}
              onClick={() => setNewWorkflow(true)}
            >
              + {t('automation.triggers.newWorkflow')}
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '5px 14px' }}
            onClick={() => setCreating(true)}
          >
            + {t('automation.triggers.create')}
          </button>
        </div>
      </div>

      {view === 'trig' && triggers.length === 0 && (
        <div className="card">
          <div className="card-body" style={{ padding: '32px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t('automation.triggers.empty.title')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 560, margin: '0 auto 14px' }}>
              {t('automation.triggers.empty.body')}
            </div>
            {/* L'état vide mène à la création, pas vers des signaux qui
                n'existent peut-être pas encore. */}
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 16px' }}
              onClick={() => setCreating(true)}
            >
              + {t('automation.triggers.create')}
            </button>
          </div>
        </div>
      )}

      {view === 'trig' && triggers.map(trig => {
        const state = stateOf(trig, hasMailbox);
        return (
          <div key={trig.id} className="card" style={{ marginBottom: 8 }}>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 180, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {t('automation.triggers.signalLabel', { type: t(`signals.type.${trig.eventKey}`) })}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {t('automation.triggers.signalSub', { type: t(`signals.type.${trig.eventKey}`) })}
                  </div>
                </div>

                <div style={{ minWidth: 150 }}>
                  <button
                    onClick={() => setEditing(trig.workflowId)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: 'var(--primary)', textAlign: 'left' }}
                  >
                    {trig.workflowName}
                  </button>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {t('automation.triggers.stepCount', { count: trig.workflowStepCount })}
                  </div>
                </div>

                <div style={{ minWidth: 150, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATE_COLOR[state], flexShrink: 0 }} />
                  {t(`automation.triggers.state.${state}`)}
                </div>

                <div style={{ minWidth: 80, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ color: trig.entered30d ? 'var(--text-primary)' : 'var(--grey-400)' }}>
                    {trig.entered30d}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{t('automation.triggers.entered30d')}</div>
                </div>

                <div style={{ minWidth: 110, fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {trig.lastFiredAt ? fmtDate(trig.lastFiredAt, en) : t('automation.triggers.never')}
                </div>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {trig.status !== 'draft' && trig.status !== 'breaker' && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={() => setStatus(trig, trig.status === 'paused' ? 'active' : 'paused')}
                    >
                      {trig.status === 'paused' ? t('automation.triggers.resume') : t('automation.triggers.pause')}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)' }}
                    onClick={() => remove(trig)}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>

              {/* L'explication, quand il y en a une à donner. */}
              {state === 'silent' && (
                <Alert tone="warning">
                  {t('automation.triggers.alert.silent', {
                    count: trig.skippedCount,
                    reason: t(`automation.skip.${trig.topSkipReason || 'no_known_contact'}`),
                  })}
                </Alert>
              )}
              {state === 'waiting' && (
                <Alert tone="neutral">
                  {t('automation.triggers.alert.waiting', { type: t(`signals.type.${trig.eventKey}`) })}
                </Alert>
              )}
              {state === 'nobox' && (
                <Alert tone="warning">{t('automation.triggers.alert.nobox')}</Alert>
              )}
              {state === 'breaker' && (
                <Alert tone="danger">
                  {t('automation.triggers.alert.breaker', {
                    threshold: data.breakerPerHour,
                    reason: trig.pausedReason || '',
                  })}
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '3px 12px', marginLeft: 10 }}
                    onClick={() => setStatus(trig, 'active')}
                  >
                    {t('automation.triggers.restart')}
                  </button>
                </Alert>
              )}
              {state === 'draft' && (
                <Alert tone="neutral">{t('automation.triggers.alert.draft')}</Alert>
              )}
            </div>
          </div>
        );
      })}

      {view === 'wf' && workflows.length === 0 && (
        <div className="card">
          <div className="card-body" style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {t('automation.triggers.noWorkflow')}
          </div>
        </div>
      )}

      {view === 'wf' && workflows.map(w => {
        const users = (w.triggers || []).filter(x => x.status !== 'draft');
        return (
          <div key={w.id} className="card" style={{ marginBottom: 8 }}>
            <div className="card-body" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</div>
                <div style={{
                  fontSize: 11.5, marginTop: 2,
                  // Un workflow sans déclencheur ne s'exécute jamais. Le dire,
                  // plutôt que de laisser croire à un parcours qui dort.
                  color: users.length ? 'var(--text-muted)' : 'var(--warning)',
                }}>
                  {users.length
                    ? t('automation.triggers.usedBy', {
                      count: users.length,
                      list: users.map(u => t(`signals.type.${u.label}`)).join(', '),
                    })
                    : t('automation.triggers.orphan')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('automation.triggers.stepCount', { count: w.stepCount })}
                </span>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '3px 12px' }}
                  onClick={() => setEditing(w.id)}
                >
                  {t('common.edit')}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <CreateGate
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => { setCreating(false); load(); if (onChanged) onChanged(); }}
      />
    </div>
  );
}

function CreateGate({ open, onClose, onDone }) {
  if (!open) return null;
  return <AutomateWizard mode="catalog" onClose={onClose} onDone={onDone} />;
}

function Alert({ tone, children }) {
  const bg = {
    warning: 'var(--warning-soft)',
    danger: 'var(--danger-soft)',
    neutral: 'var(--paper-2)',
  }[tone];
  return (
    <div style={{
      marginTop: 10, padding: '8px 12px', borderRadius: 'var(--r-lg)',
      background: bg, fontSize: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    }}>
      {children}
    </div>
  );
}

/* ═══════════════════ Création d'un workflow seul ═══════════════════ */

/**
 * Un workflow sans déclencheur ne s'exécutera pas, et la vue « par workflow »
 * le dit en toutes lettres. Préparer le parcours avant de décider ce qui le
 * lance reste un ordre de travail légitime : la page ne doit pas obliger à
 * attendre qu'un signal existe pour pouvoir construire quelque chose.
 */
function WorkflowCreatePanel({ crmProvider, onClose }) {
  const t = useT();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(emptySteps);
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0
    && steps.some(s => s.type === 'email')
    && steps.filter(s => s.type === 'email').every(s => String(s.consigne || '').trim());

  const save = async () => {
    setBusy(true);
    try {
      await request('/automations/workflows', {
        method: 'POST',
        body: {
          name: name.trim(),
          steps: steps.map(s => (s.type === 'wait'
            ? { type: 'wait', days: s.days }
            : { type: 'email', consigne: s.consigne })),
        },
      });
      showToast({
        type: 'success',
        title: t('automation.editor.created'),
        message: t('automation.editor.createdBody'),
      });
      onClose();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onClose}>
          {'< '}{t('automation.editor.back')}
        </button>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '6px 16px', opacity: valid ? 1 : 0.45 }}
          disabled={!valid || busy}
          onClick={save}
        >
          {t('common.save')}
        </button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t('automation.editor.createHint')}
      </div>

      <WorkflowEditor
        name={name}
        onNameChange={setName}
        steps={steps}
        onStepsChange={setSteps}
        triggerSentence={t('automation.editor.noTrigger')}
        context={{ contact: true, company: true, signal: false, deal: false, owner: false }}
        crmProvider={crmProvider}
      />
    </div>
  );
}

/* ═══════════════════ Édition d'un workflow existant ═══════════════════ */

function WorkflowEditPanel({ workflowId, crmProvider, onClose }) {
  const t = useT();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request(`/automations/workflows/${workflowId}`)
      .then(d => setState({
        name: d.workflow.name,
        steps: d.steps.map((s, i) => ({ ...s, id: `x${i}` })),
        trigger: d.triggers[0] || null,
      }))
      .catch(() => setState(null));
  }, [workflowId]);

  if (!state) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;

  const save = async () => {
    setBusy(true);
    try {
      await request(`/automations/workflows/${workflowId}`, {
        method: 'PUT',
        body: {
          name: state.name,
          steps: state.steps.map(s => (s.type === 'wait'
            ? { type: 'wait', days: s.days }
            : { type: 'email', consigne: s.consigne })),
        },
      });
      showToast({ type: 'success', title: t('automation.editor.saved'), message: t('automation.editor.savedBody') });
      onClose();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBusy(false);
  };

  const sentence = state.trigger
    ? t('automation.wizard.sentenceOne', { type: t(`signals.type.${state.trigger.eventKey}`) })
    : t('automation.editor.noTrigger');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={onClose}>
          {'< '}{t('automation.editor.back')}
        </button>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px' }} disabled={busy} onClick={save}>
          {t('common.save')}
        </button>
      </div>

      {/* Réécrire le modèle ne touche à aucun parcours en vol : les contacts
          déjà inscrits travaillent sur la copie reçue à leur entrée. */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t('automation.editor.editHint')}
      </div>

      <WorkflowEditor
        name={state.name}
        onNameChange={(name) => setState(s => ({ ...s, name }))}
        steps={state.steps}
        onStepsChange={(steps) => setState(s => ({ ...s, steps }))}
        triggerSentence={sentence}
        context={state.trigger?.context || { contact: true, company: true, signal: true, deal: false, owner: false }}
        crmProvider={crmProvider}
      />
    </div>
  );
}
