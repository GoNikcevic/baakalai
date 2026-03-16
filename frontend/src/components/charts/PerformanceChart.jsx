/* ===============================================================================
   BAKAL — Performance Bar Chart (Recharts)
   Weekly email/linkedin volume bars for the dashboard overview.
   =============================================================================== */

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
};

export default function PerformanceChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0' }}>
        Les graphiques apparaitront avec les donnees de campagne.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} barGap={2} barSize={18}>
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
          width={30}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'var(--accent-glow)' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
        />
        <Bar dataKey="email" name="Email" fill="var(--blue)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="linkedin" name="LinkedIn" fill="var(--purple)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
