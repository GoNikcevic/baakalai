/* ===============================================================================
   BAKAL · Historique · les sorties, avec leur motif

   Le motif de sortie est l'unité de cet onglet. Sans motif typé et stocké,
   l'Historique serait une liste de « terminé » qui n'apprend rien, et les
   statistiques par workflow n'auraient rien à afficher.

   « Rendez-vous demandé » et jamais « RDV pris » : c'est une lecture de la
   réponse par un classifieur d'intention, pas un fait. La nuance est portée
   dans le libellé, pas cachée.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { useT, useI18n } from '../../i18n';

const REASON_TONE = {
  replied: 'var(--primary)',
  meeting_requested: 'var(--success)',
  deal_stage_reached: 'var(--success)',
  deal_updated: 'var(--success)',
  completed_no_reply: 'var(--grey-500)',
  max_duration: 'var(--warning)',
  manual: 'var(--grey-500)',
  unsubscribed: 'var(--danger)',
  bounced: 'var(--danger)',
  handed_off: 'var(--primary)',
};

export default function HistoryZone({ hasRuns }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [exits, setExits] = useState(null);

  useEffect(() => {
    request('/automations/history?days=90').then(d => setExits(d.exits || [])).catch(() => setExits([]));
  }, []);

  if (!exits) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>{t('common.loading')}</div>;
  }

  if (exits.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t('automation.history.empty.title')}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto' }}>
            {hasRuns ? t('automation.history.empty.bodyRunning') : t('automation.history.empty.body')}
          </div>
        </div>
      </div>
    );
  }

  const fmt = (iso) => (iso
    ? new Date(iso).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: '2-digit' })
    : '');

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--paper-2)', textAlign: 'left' }}>
            {['contact', 'workflow', 'trigger', 'in', 'out', 'reason'].map(k => (
              <th key={k} style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11 }}>
                {t(`automation.history.col.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exits.map(e => (
            <tr key={e.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: 500 }}>{e.contactName || t('automation.runs.unknownContact')}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{e.contactCompany}</div>
              </td>
              <td style={{ padding: '10px 12px' }}>{e.workflowName}</td>
              <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--grey-700)' }}>
                {e.triggerLabel ? t(`signals.type.${e.triggerLabel}`) : ''}
              </td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>{fmt(e.enteredAt)}</td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>{fmt(e.exitedAt)}</td>
              <td style={{ padding: '10px 12px', fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: REASON_TONE[e.reason] || 'var(--grey-500)',
                  }} />
                  {e.reason ? t(`automation.history.reason.${e.reason}`) : t('automation.history.reason.unknown')}
                </span>
                {e.reason === 'meeting_requested' && (
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('automation.history.inferenceHint')}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
