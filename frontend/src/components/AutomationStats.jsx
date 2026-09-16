/* ===============================================================================
   BAKAL · Automation Stats
   Historique consolidé de l'Automatisation : emails de relance déclenchés,
   actions de workflows, réponses obtenues · l'équivalent des KPIs de
   l'Historique de prospection. Source : GET /api/nurture/stats.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';
import { getTriggerTypes } from '../pages/NurturePage';

const CARD = {
  background: 'var(--bg-card, white)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
};

const SECTION_TITLE = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 10,
};

export default function AutomationStats() {
  const t = useT();
  const { lang } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    request('/nurture/stats').then(setData).catch(() => setError(true));
  }, []);

  if (error) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('automationStats.loadError')}</div>;
  }
  if (!data) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>…</div>;
  }

  const workflows = data.workflows || [];
  const replies = workflows.reduce((s, w) => s + (w.replied || 0), 0);
  const activeWf = workflows.reduce((s, w) => s + (w.active || 0), 0);
  const emailsSent = data.emails?.sent || 0;
  const wfSent = data.workflowActions?.sent || 0;

  if (emailsSent + wfSent + activeWf + (data.emails?.pending || 0) === 0) {
    return (
      <div style={{ ...CARD, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
        {t('automationStats.empty')}
      </div>
    );
  }

  const triggerLabels = {};
  getTriggerTypes(lang).forEach((tt) => { triggerLabels[tt.value] = tt.label; });

  const goalLabels = {
    reactivation: t('automationStats.goalReactivation'),
    upsell: t('automationStats.goalUpsell'),
    churn_prevention: t('automationStats.goalChurn'),
  };

  const tiles = [
    {
      value: emailsSent,
      label: t('automationStats.emailsSent'),
      sub: `+${data.emails?.sent_30d || 0} · ${t('automationStats.last30d')}`
        + ((data.emails?.pending || 0) > 0 ? ` · ${data.emails.pending} ${t('automationStats.pending')}` : ''),
    },
    {
      value: wfSent,
      label: t('automationStats.workflowActions'),
      sub: `+${data.workflowActions?.sent_30d || 0} · ${t('automationStats.last30d')}`,
    },
    { value: replies, label: t('automationStats.replies'), color: 'var(--success)', help: t('automationStats.repliesHelp') },
    { value: activeWf, label: t('automationStats.activeWorkflows'), color: 'var(--blue)' },
  ];

  const monthly = data.monthly || [];
  const maxMonth = Math.max(...monthly.map((m) => (m.nurture || 0) + (m.workflow || 0)), 1);
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { month: 'short', year: '2-digit' });
  };

  const cellStyle = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)' };
  const numCell = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div>
      <h2 style={{ fontSize: 17, fontWeight: 650, margin: '0 0 4px' }}>{t('automationStats.title')}</h2>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px' }}>{t('automationStats.subtitle')}</p>

      {/* Tuiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
        {tiles.map((tile) => (
          <div key={tile.label} style={CARD} title={tile.help || undefined}>
            <div style={{ fontSize: 26, fontWeight: 650, color: tile.color || 'var(--text-primary)' }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{tile.label}</div>
            {tile.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{tile.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        {/* Envois par mois */}
        {monthly.length > 0 && (
          <div style={CARD}>
            <div style={SECTION_TITLE}>{t('automationStats.monthly')}</div>
            {monthly.map((m) => {
              const total = (m.nurture || 0) + (m.workflow || 0);
              return (
                <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 58, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{monthLabel(m.month)}</div>
                  <div style={{ flex: 1, display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-elevated, var(--paper-2))' }}>
                    {m.nurture > 0 && <div style={{ width: `${(m.nurture / maxMonth) * 100}%`, background: 'var(--primary, #6E57FA)' }} />}
                    {m.workflow > 0 && <div style={{ width: `${(m.workflow / maxMonth) * 100}%`, background: 'var(--blue, #3B82F6)' }} />}
                  </div>
                  <div style={{ width: 30, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{total}</div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--primary, #6E57FA)', marginRight: 5 }} />{t('automationStats.monthlyNurture')}</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--blue, #3B82F6)', marginRight: 5 }} />{t('automationStats.monthlyWorkflow')}</span>
            </div>
          </div>
        )}

        {/* Par déclencheur */}
        {(data.byTrigger || []).length > 0 && (
          <div style={CARD}>
            <div style={SECTION_TITLE}>{t('automationStats.byTrigger')}</div>
            {data.byTrigger.map((row) => (
              <div key={row.type} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', fontSize: 13 }}>
                <span>{triggerLabels[row.type] || row.type}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.sent}</span>
              </div>
            ))}
          </div>
        )}

        {/* Workflows par objectif */}
        {workflows.length > 0 && (
          <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
            <div style={{ ...SECTION_TITLE, margin: 0, padding: '14px 16px 8px' }}>{t('automationStats.byGoal')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}></th>
                    <th style={{ ...numCell, borderTop: 'none', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('automationStats.colTotal')}</th>
                    <th style={{ ...numCell, borderTop: 'none', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('automationStats.colActive')}</th>
                    <th style={{ ...numCell, borderTop: 'none', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('automationStats.colCompleted')}</th>
                    <th style={{ ...numCell, borderTop: 'none', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{t('automationStats.colReplied')}</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((w) => (
                    <tr key={w.goal}>
                      <td style={{ ...cellStyle, textAlign: 'left' }}>{goalLabels[w.goal] || w.goal}</td>
                      <td style={numCell}>{w.total}</td>
                      <td style={numCell}>{w.active}</td>
                      <td style={numCell}>{w.completed}</td>
                      <td style={{ ...numCell, color: w.replied > 0 ? 'var(--success)' : undefined, fontWeight: w.replied > 0 ? 600 : 400 }}>{w.replied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
