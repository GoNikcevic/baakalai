/* ===============================================================================
   BAKAL · En cours · qui est actuellement engagé dans un parcours

   L'état vide est le cas normal, pas le cas dégradé : 0 email envoyé en
   production, une seule boîte mail connectée sur tout le parc. Il dit la
   vérité et donne la prochaine action, sans tableau de démonstration.

   Deux états vides différents, parce qu'ils appellent deux gestes différents :
   personne n'a armé de déclencheur, ou un déclencheur tourne et n'a encore
   trouvé personne.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';
import { triggerLabel } from './triggerLabels';
import Icon from '../Icon';

export default function RunsZone({ activeTriggers, onGoSignals, onGoTriggers }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    request('/automations/runs').then(d => setRuns(d.runs || [])).catch(() => setRuns([]));
  }, []);

  if (!runs) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>{t('common.loading')}</div>;
  }

  if (runs.length === 0) {
    const armed = activeTriggers > 0;
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {armed ? t('automation.runs.emptyArmed.title') : t('automation.runs.empty.title')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 560, margin: '0 auto 14px' }}>
            {armed ? t('automation.runs.emptyArmed.body') : t('automation.runs.empty.body')}
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 16px' }}
            onClick={armed ? onGoTriggers : onGoSignals}
          >
            {armed ? t('automation.runs.emptyArmed.cta') : t('automation.runs.empty.cta')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--paper-2)', textAlign: 'left' }}>
            {['contact', 'workflow', 'trigger', 'step', 'since'].map(k => (
              <th key={k} style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11 }}>
                {t(`automation.runs.col.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: 500 }}>{r.contactName || t('automation.runs.unknownContact')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.contactCompany}</div>
              </td>
              <td style={{ padding: '10px 12px' }}>{r.workflowName}</td>
              <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--grey-700)' }}>
                {triggerLabel(t, r.trigger)}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>
                {t('automation.runs.step', { done: r.doneSteps, total: r.totalSteps })}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--grey-700)' }}>
                {r.since
                  ? new Date(r.since).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' })
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
