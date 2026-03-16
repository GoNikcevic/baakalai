/* ===============================================================================
   BAKAL — Engagement Trends Line Chart (Recharts)
   Multi-line chart for open rate, reply rate, linkedin acceptance over time.
   Used in the Analytics section.
   =============================================================================== */

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
  color: 'var(--text-primary)',
};

export default function EngagementChart({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" />
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
          width={35}
          unit="%"
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value) => [`${value}%`]}
          cursor={{ stroke: 'var(--border)' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
        />
        <Line
          type="monotone"
          dataKey="open"
          name="Ouverture"
          stroke="var(--blue)"
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: 'var(--blue)', strokeWidth: 2, stroke: 'var(--bg-card)' }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="reply"
          name="Reponse"
          stroke="var(--success)"
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: 'var(--success)', strokeWidth: 2, stroke: 'var(--bg-card)' }}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="linkedin"
          name="LinkedIn"
          stroke="var(--purple)"
          strokeWidth={2.5}
          dot={{ r: 3.5, fill: 'var(--purple)', strokeWidth: 2, stroke: 'var(--bg-card)' }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
