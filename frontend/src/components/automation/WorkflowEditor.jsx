/* ===============================================================================
   BAKAL · Éditeur de workflow · une liste d'étapes, pas un graphe

   Le modèle d'édition est celui de Lemlist, pas celui de n8n : une succession
   d'étapes empilées verticalement avec un « + » entre deux. Pas de canvas
   libre, pas de noeuds à relier. Conséquence technique décisive, et c'est
   pour ça que le choix a été fait : une liste ordonnée colle au backend plat
   existant, donc aucun DAG, aucune coordonnée à persister, aucun moteur de
   layout.

   Le DÉCLENCHEUR est l'étape 0, épinglée en haut. Ce n'est pas décoratif : il
   définit le contexte d'exécution. Un déclencheur « signal » fournit une
   société et un contact mais pas de deal, donc {montant_deal} est barré et
   l'étape « changer le stage d'un deal » ne peut pas s'appliquer. Sans cette
   règle visible, on écrit un email avec une variable que le déclencheur ne
   fournira jamais.

   L'attente est une carte ici et un `timing` en base : le moteur n'a aucun
   nouveau type d'étape à connaître.
   =============================================================================== */

import { useState } from 'react';
import { useT } from '../../i18n';
import Icon from '../Icon';

let uid = 1;
const nextId = () => `s${uid++}`;

export const emptySteps = () => [{ id: nextId(), type: 'email', consigne: '' }];

/** Ce que le catalogue propose, et surtout pourquoi une entrée est grisée. */
function catalogFor(t, crmProvider) {
  const crmLabel = crmProvider
    ? t(`automation.crm.${crmProvider}`, {})
    : null;
  // Le motif de grisage doit nommer la vraie raison. Une phrase générale du
  // type « aucun CRM ne l'accepte » serait fausse : HubSpot écrit des stages
  // en production aujourd'hui, Pipedrive en a la primitive. Ce qui manque,
  // c'est le branchement depuis une étape de workflow.
  const notWiredCrm = crmLabel
    ? t('automation.editor.catalog.notWiredCrm', { crm: crmLabel })
    : t('automation.editor.catalog.notWiredNoCrm');

  return [
    { type: 'email', labelKey: 'email', subKey: 'emailSub' },
    { type: 'wait', labelKey: 'wait', subKey: 'waitSub' },
    { labelKey: 'autopilot', subKey: 'autopilotSub', off: t('automation.editor.catalog.notWiredAutopilot') },
    { labelKey: 'note', subKey: 'noteSub', off: notWiredCrm },
    { labelKey: 'notify', subKey: 'notifySub', off: t('automation.editor.catalog.notWiredNotify') },
    { labelKey: 'dealStage', subKey: 'dealStageSub', off: notWiredCrm },
    { labelKey: 'task', subKey: 'taskSub', off: notWiredCrm },
    { labelKey: 'owner', subKey: 'ownerSub', off: notWiredCrm },
  ];
}

export default function WorkflowEditor({
  name, onNameChange,
  steps, onStepsChange,
  triggerSentence, context,
  crmProvider,
}) {
  const t = useT();
  const [insertAt, setInsertAt] = useState(null);

  const waitDays = steps.filter(s => s.type === 'wait').reduce((a, s) => a + (parseInt(s.days, 10) || 0), 0);
  const emailCount = steps.filter(s => s.type === 'email').length;

  const patch = (id, next) => onStepsChange(steps.map(s => (s.id === id ? { ...s, ...next } : s)));
  const remove = (id) => onStepsChange(steps.filter(s => s.id !== id));
  const insert = (type, at) => {
    const s = type === 'wait'
      ? { id: nextId(), type: 'wait', days: 3 }
      : { id: nextId(), type: 'email', consigne: '' };
    const copy = steps.slice();
    copy.splice(at === 'end' ? copy.length : at, 0, s);
    onStepsChange(copy);
    setInsertAt(null);
  };

  const catalog = catalogFor(t, crmProvider);

  const Catalog = ({ at }) => (
    <div className="card" style={{ margin: '6px 0', borderColor: 'var(--border-strong, #d6d3d1)' }}>
      <div className="card-body" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t('automation.editor.addStep')}</span>
          <button
            onClick={() => setInsertAt(null)}
            aria-label={t('common.close')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-500)' }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {catalog.map((c, i) => (
            <button
              key={i}
              disabled={!!c.off}
              title={c.off || ''}
              onClick={() => !c.off && insert(c.type, at)}
              style={{
                textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--r-lg)',
                border: '1px solid var(--border)', background: 'var(--paper)',
                cursor: c.off ? 'not-allowed' : 'pointer', opacity: c.off ? 0.55 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t(`automation.editor.catalog.${c.labelKey}`)}</span>
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: c.off ? 'var(--grey-500)' : 'var(--success, #16a34a)' }}>
                  {c.off ? t('automation.editor.catalog.greyed') : t('automation.editor.catalog.available')}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                {c.off || t(`automation.editor.catalog.${c.subKey}`)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 240px', gap: 20, alignItems: 'start' }}>
      <div>
        <input
          value={name}
          onChange={e => onNameChange(e.target.value)}
          aria-label={t('automation.editor.workflowName')}
          placeholder={t('automation.editor.workflowNamePh')}
          style={{
            width: '100%', fontSize: 15, fontWeight: 600, padding: '8px 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            background: 'var(--paper)', marginBottom: 4,
          }}
        />
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
          {t('automation.editor.meta', { steps: emailCount, days: waitDays })}
        </div>

        {/* Étape 0 · le déclencheur, épinglé */}
        <div style={{
          border: '1px solid var(--border-strong, #d6d3d1)', borderRadius: 'var(--r-lg)',
          padding: '10px 14px', background: 'var(--paper-2)', marginBottom: 4,
        }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--grey-500)' }}>
            {t('automation.editor.step0')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{triggerSentence}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('automation.editor.provides', {
              provides: [
                t('automation.editor.var.company'),
                t('automation.editor.var.contact'),
                context?.signal ? t('automation.editor.var.signal') : null,
              ].filter(Boolean).join(', '),
            })}
            {!context?.deal && ` ${t('automation.editor.providesNotDeal')}`}
          </div>
        </div>

        {steps.map((s, i) => (
          <div key={s.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <span style={{ width: 1, height: 12, background: 'var(--border-strong, #d6d3d1)', marginLeft: 14 }} />
              <button
                onClick={() => setInsertAt(insertAt === i ? null : i)}
                aria-label={t('automation.editor.addStepHere')}
                style={{
                  width: 20, height: 20, lineHeight: '18px', borderRadius: '50%',
                  border: '1px solid var(--border-strong, #d6d3d1)', background: 'var(--paper)',
                  cursor: 'pointer', fontSize: 13, color: 'var(--grey-700)', padding: 0,
                }}
              >+</button>
            </div>
            {insertAt === i && <Catalog at={i} />}

            <div className="card">
              <div className="card-body" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 600, width: 18, height: 18, lineHeight: '18px',
                    textAlign: 'center', borderRadius: '50%', background: 'var(--paper-2)',
                  }}>{i + 1}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
                    {s.type === 'wait'
                      ? t('automation.editor.waitTitle', { days: s.days || 0 })
                      : t('automation.editor.catalog.email')}
                  </span>
                  <button
                    onClick={() => remove(s.id)}
                    aria-label={t('automation.editor.removeStep')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-500)' }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>

                {s.type === 'email' && (
                  <>
                    <textarea
                      value={s.consigne}
                      onChange={e => patch(s.id, { consigne: e.target.value })}
                      rows={2}
                      placeholder={t('automation.editor.consignePh')}
                      style={{
                        width: '100%', fontSize: 12.5, padding: '8px 10px', resize: 'vertical',
                        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                        background: 'var(--paper)',
                      }}
                    />
                    {/* Une consigne, pas un email rédigé : elle vaut pour tous
                        les contacts que le déclencheur fera entrer. */}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {t('automation.editor.consigneHint')}
                    </div>
                    {!String(s.consigne || '').trim() && (
                      <div style={{ fontSize: 11, color: 'var(--warning, #d97706)', marginTop: 4 }}>
                        {t('automation.editor.consigneMissing')}
                      </div>
                    )}
                  </>
                )}

                {s.type === 'wait' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                    {t('automation.editor.waitFor')}
                    <input
                      type="number"
                      min="1"
                      value={s.days}
                      onChange={e => patch(s.id, { days: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      style={{
                        width: 64, fontSize: 12.5, padding: '4px 8px',
                        border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                      }}
                    />
                    {t('automation.editor.waitDays')}
                  </label>
                )}
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}>
          <span style={{ width: 1, height: 12, background: 'var(--border-strong, #d6d3d1)', marginLeft: 14 }} />
        </div>
        {insertAt === 'end' && <Catalog at="end" />}
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '5px 14px' }}
          onClick={() => setInsertAt(insertAt === 'end' ? null : 'end')}
        >
          + {t('automation.editor.addStep')}
        </button>
      </div>

      {/* Sorties et variables · ce qui fait sortir un contact, et ce dont les
          étapes disposent. Les deux dépendent du déclencheur. */}
      <aside style={{ display: 'grid', gap: 12 }}>
        <div className="card">
          <div className="card-body" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t('automation.editor.exits')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 8px' }}>
              {t('automation.editor.exitsHint')}
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              {['reply', 'meeting', 'unsub', 'bounce', 'maxDuration', 'otherWorkflow'].map(k => (
                <div key={k} style={{ display: 'flex', gap: 7, alignItems: 'baseline', fontSize: 11.5 }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                    background: 'var(--ink, #1c1917)', marginTop: 5,
                  }} />
                  <span>{t(`automation.editor.exit.${k}`)}</span>
                </div>
              ))}
              {/* Un stage cible ne peut pas être une sortie quand le
                  déclencheur ne fournit pas de deal : le dire plutôt que de
                  proposer une sortie qui ne tombera jamais. */}
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', fontSize: 11.5, opacity: 0.5 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--grey-400, #a8a29e)', marginTop: 5,
                }} />
                <span style={{ textDecoration: 'line-through' }}>{t('automation.editor.exit.dealStage')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('automation.editor.variables')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                { k: 'prenom', on: true },
                { k: 'societe', on: true },
                { k: 'poste', on: true },
                { k: 'signal', on: !!context?.signal },
                { k: 'montantDeal', on: !!context?.deal },
                { k: 'owner', on: !!context?.owner },
              ].map(v => (
                <span
                  key={v.k}
                  title={v.on ? '' : t('automation.editor.varUnavailable')}
                  style={{
                    fontSize: 10.5, padding: '2px 8px', borderRadius: 'var(--r-full)',
                    border: '1px solid var(--border)',
                    background: v.on ? 'var(--paper)' : 'var(--paper-2)',
                    color: v.on ? 'var(--text-primary)' : 'var(--grey-500)',
                    textDecoration: v.on ? 'none' : 'line-through',
                  }}
                >
                  {t(`automation.editor.var.${v.k}`)}
                </span>
              ))}
            </div>
            {!context?.deal && (
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6 }}>
                {t('automation.editor.varBarredHint')}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
