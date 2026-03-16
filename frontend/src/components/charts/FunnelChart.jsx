/* ===============================================================================
   BAKAL — Conversion Funnel (Recharts)
   Horizontal funnel showing: Contacted → Opened → Replied → Interested → RDV
   =============================================================================== */

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
};

const COLORS = [
  'var(--text-muted)',
  'var(--blue)',
  'var(--success)',
  'var(--warning)',
  'var(--purple)',
];

export default function FunnelChart({ stages }) {
  if (!stages || stages.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={stages} layout="vertical" barSize={28}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}
          width={80}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value, name, entry) => {
            const total = stages[0]?.value || 1;
            const pct = ((value / total) * 100).toFixed(1);
            return [`${value} (${pct}%)`];
          }}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
          {stages.map((_, i) => (
            <Cell key={i} fill={COLORS[i] || 'var(--text-muted)'} fillOpacity={1 - i * 0.12} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
