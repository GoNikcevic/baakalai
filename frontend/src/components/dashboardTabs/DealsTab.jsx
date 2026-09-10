/* ═══════════════════════════════════════════════════
   Dashboard — Deals tab
   Strictly deal/pipeline data: open pipeline, dormant deals,
   revenue recovered, follow-ups sent, reactivation hero metric.
   No churn/upsell/emailing content here.
   ═══════════════════════════════════════════════════ */

import { useI18n } from '../../i18n';
import ReactivationCard from '../ReactivationCard';

export default function DealsTab({ crmStats }) {
  return (
    <div>
      <RevenueKpis stats={crmStats} />
      <ReactivationCard stats={crmStats} />
    </div>
  );
}

/* ── KPIs revenue — la langue du produit ──
   Pipeline ouvert, deals dormants, revenu récupéré, relances : le
   « 1 deal récupéré = l'outil est payé » en chiffres. Rend null tant
   que le CRM n'a rien donné. */
function RevenueKpis({ stats }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  if (!stats) return null;
  const { pipeline = {}, reactivated = {}, emails = {} } = stats;
  if (!pipeline.openDeals && !reactivated.count) return null;

  const money = (n) => {
    if (!n) return '0 €';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
    if (n >= 1000) return `${Math.round(n / 1000)}k €`;
    return `${Math.round(n)} €`;
  };

  const cards = [
    {
      label: en ? '\u{1F4BC} Open pipeline' : '\u{1F4BC} Pipeline ouvert',
      value: money(pipeline.totalValue),
      trend: en ? `${pipeline.openDeals} open deals` : `${pipeline.openDeals} deals ouverts`,
    },
    {
      label: en
        ? `\u{1F4A4} Dormant deals (${pipeline.stagnantThresholdDays || 14}d+)`
        : `\u{1F4A4} Deals dormants (${pipeline.stagnantThresholdDays || 14}j+)`,
      value: String(pipeline.stagnantDeals || 0),
      trend: en ? `${money(pipeline.potentialRevenue)} to revive` : `${money(pipeline.potentialRevenue)} à réveiller`,
    },
    {
      label: en ? '\u{1F4B0} Revenue recovered' : '\u{1F4B0} Revenu récupéré',
      value: money(reactivated.revenue),
      trend: en
        ? `${reactivated.count} deal${reactivated.count > 1 ? 's' : ''} reactivated`
        : `${reactivated.count} deal${reactivated.count > 1 ? 's' : ''} réactivé${reactivated.count > 1 ? 's' : ''}`,
    },
    {
      label: en ? '\u{1F4E8} Follow-ups sent' : '\u{1F4E8} Relances envoyées',
      value: String(emails.sent || 0),
      trend: en ? `${emails.replyRate || 0}% replies` : `${emails.replyRate || 0}% de réponses`,
    },
  ];

  return (
    <div className="kpi-grid" style={{ marginBottom: 16 }}>
      {cards.map((k, i) => (
        <div className="kpi-card" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-trend">{k.trend}</div>
        </div>
      ))}
    </div>
  );
}
