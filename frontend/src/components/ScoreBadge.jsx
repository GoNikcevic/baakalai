export default function ScoreBadge({ score, breakdown }) {
  if (score == null) return null;

  const color = score > 70 ? 'var(--success)' : score >= 40 ? 'var(--warning)' : '#ef4444';
  const bg = score > 70 ? 'rgba(0,214,143,0.1)' : score >= 40 ? 'rgba(255,165,0,0.1)' : 'rgba(239,68,68,0.1)';

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }} title={
      breakdown
        ? [
            `Activité: ${breakdown.activity ?? breakdown.engagement ?? 0}/40`,
            `Fit ICP: ${breakdown.fit ?? 0}/30`,
            breakdown.status != null ? `Statut: ${breakdown.status}/30` : null,
          ].filter(Boolean).join(' | ')
        : ''
    }>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 36, height: 24, padding: '0 6px',
        borderRadius: 12, fontSize: 11, fontWeight: 700,
        color, background: bg,
        border: `1px solid ${color}30`,
      }}>
        {score}
      </span>
    </div>
  );
}
