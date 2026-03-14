/* ═══════════════════════════════════════════════════
   Sequence Step Component
   ═══════════════════════════════════════════════════ */

import { StepStat } from './shared';
import { sanitizeHtml } from '../../services/sanitize';

export default function SequenceStep({ step: s, faded }) {
  const hasStats = s.stats !== null && s.stats !== undefined;

  const typeLabel =
    s.type === 'linkedin'
      ? `${s.label} — ${s.subType}`
      : `${s.label} — ${s.subType}`;

  let statsContent;
  if (!hasStats) {
    statsContent = (
      <>
        <StepStat value="—" label="Pas encore lance" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
      </>
    );
  } else if (s.type === 'linkedin' && s.stats.accept !== undefined) {
    statsContent = (
      <>
        <StepStat
          value={s.stats.accept + '%'}
          label="Acceptation"
          color="var(--success)"
          pct={s.stats.accept}
        />
        <StepStat value="—" label="—" color="var(--text-muted)" />
        <StepStat
          value="0%"
          label="Ignore"
          color="var(--text-muted)"
          pct={0}
          barColor="var(--danger)"
        />
      </>
    );
  } else if (s.type === 'linkedin') {
    statsContent = (
      <>
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color={s.stats.reply >= 8 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.interested || '—'}
          label={s.stats.interested ? 'Interesses' : '—'}
          color="var(--warning)"
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  } else {
    statsContent = (
      <>
        <StepStat
          value={s.stats.open + '%'}
          label="Ouverture"
          color={s.stats.open >= 50 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.open}
        />
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color="var(--blue)"
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  }

  return (
    <div className="sequence-step" style={faded ? { opacity: 0.5 } : undefined}>
      <div className="step-indicator">
        <div className={`step-dot ${s.type}`}>{s.id}</div>
        <div className="step-label">{s.timing}</div>
      </div>
      <div className="step-content">
        {s.subject && (
          <div className="step-subject">Objet : {s.subject}</div>
        )}
        <div className="step-type">{typeLabel}</div>
        <div
          className="step-preview"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.body) }}
        />
      </div>
      {statsContent}
    </div>
  );
}
