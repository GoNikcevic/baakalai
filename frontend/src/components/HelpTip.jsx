/* ═══════════════════════════════════════════════════
   HelpTip · small "?" badge with a hover tooltip, for clarifying
   a metric's exact definition inline without cluttering the label.
   ═══════════════════════════════════════════════════ */

export default function HelpTip({ text }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 5, verticalAlign: 'middle', flexShrink: 0 }} className="helptip-wrap">
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: '50%',
          fontSize: 10, fontWeight: 700, cursor: 'help',
          background: 'var(--border)', color: 'var(--text-muted)',
        }}
      >?</span>
      <span className="helptip-bubble">{text}</span>
      <style>{`
        .helptip-wrap .helptip-bubble {
          visibility: hidden; opacity: 0;
          position: absolute; bottom: calc(100% + 8px); left: 50%;
          transform: translateX(-50%); width: 260px;
          padding: 10px 12px; border-radius: 8px;
          background: var(--bg-primary, #fff); color: var(--text-primary, #0a0a0a);
          font-size: 12px; font-weight: 400; line-height: 1.5;
          box-shadow: 0 4px 16px rgba(0,0,0,.12); border: 1px solid var(--border, #e5e5e5);
          pointer-events: none; transition: opacity .15s; z-index: 999;
          white-space: normal; text-align: left;
        }
        .helptip-wrap:hover .helptip-bubble { visibility: visible; opacity: 1; }
      `}</style>
    </span>
  );
}
