/* ═══════════════════════════════════════════════════
   Shared Sub-Components for Campaign Detail
   ═══════════════════════════════════════════════════ */

import { sanitizeHtml } from '../../services/sanitize';

/* ── Step Stat ── */
export function StepStat({ value, label, color, pct, barColor }) {
  return (
    <div className="step-stat">
      <div className="step-stat-value" style={{ color }}>
        {value}
      </div>
      <div className="step-stat-label">{label}</div>
      {pct !== undefined && (
        <div className="step-stat-bar">
          <div
            className="step-stat-fill"
            style={{ width: `${pct}%`, background: barColor || color }}
          ></div>
        </div>
      )}
    </div>
  );
}

/* ── Diagnostic Block ── */
export function DiagBlock({ color, title, text }) {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: '8px',
        padding: '14px',
        borderLeft: `3px solid var(--${color})`,
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: `var(--${color})`,
          marginBottom: '4px',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }}
      />
    </div>
  );
}

/* ── Info Row ── */
export function InfoRow({ label, content }) {
  return (
    <div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '14px' }}>{content}</div>
    </div>
  );
}

/* ── Check Item ── */
export function CheckItem({ item: ch }) {
  const bg = ch.highlight
    ? 'var(--warning-bg)'
    : 'var(--bg-elevated)';
  const border = ch.highlight
    ? '1px solid rgba(255,170,0,0.2)'
    : 'none';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        background: bg,
        border,
        borderRadius: '8px',
      }}
    >
      <span
        style={{ color: `var(--${ch.statusColor})`, fontSize: '18px' }}
      >
        {ch.icon}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '14px',
            fontWeight: 500,
            ...(ch.statusColor === 'text-muted'
              ? { color: 'var(--text-muted)' }
              : {}),
          }}
        >
          {ch.title}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {ch.desc}
        </div>
      </div>
      <span
        style={{
          fontSize: '12px',
          color: `var(--${ch.statusColor})`,
          fontWeight: 600,
        }}
      >
        {ch.status}
      </span>
    </div>
  );
}
