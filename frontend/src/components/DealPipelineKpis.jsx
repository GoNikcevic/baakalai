/* ═══════════════════════════════════════════════════
   Deal Pipeline KPIs — total deals CRM, pipeline ouvert, deals à relancer.
   Partagé entre le Dashboard (onglet Deals) et Analytics (onglet Pipeline)
   pour garantir que les deux vues affichent exactement les mêmes chiffres,
   depuis /crm/reactivation-stats. Rend null tant que le CRM n'a rien donné.
   ═══════════════════════════════════════════════════ */

import { useI18n } from '../i18n';
import Icon from './Icon';
import HelpTip from './HelpTip';

export default function DealPipelineKpis({ stats }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  if (!stats) return null;
  const { pipeline = {}, reactivated = {} } = stats;
  if (!pipeline.openDeals && !reactivated.count) return null;

  const money = (n) => {
    if (!n) return '0 €';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M €`;
    if (n >= 1000) return `${Math.round(n / 1000)}k €`;
    return `${Math.round(n)} €`;
  };

  const cards = [
    {
      icon: 'database',
      label: en ? 'Total CRM deals' : 'Total deals CRM',
      help: en
        ? 'Only deals currently qualified as such — once a deal is won (it becomes a client) or lost, it no longer counts here.'
        : 'Uniquement les deals actuellement qualifiés comme tels — une fois gagné (le deal devient client) ou perdu, il ne compte plus ici.',
      value: String(pipeline.openDeals || 0),
    },
    {
      icon: 'briefcase',
      label: en ? 'Open pipeline' : 'Pipeline ouvert',
      help: en
        ? 'The deal count includes deals with no value set — they count toward the number but not toward the total amount.'
        : 'Le nombre de deals inclut ceux sans valeur renseignée — ils comptent dans le total de deals mais pas dans le montant.',
      value: money(pipeline.totalValue),
    },
    {
      icon: 'moon',
      label: en ? 'Deals to follow up' : 'Deals à relancer',
      help: en
        ? `Deals with no activity for ${pipeline.stagnantThresholdDays || 14}+ days, or whose planned follow-up date has passed — even if they've had recent activity.`
        : `Deals sans activité depuis ${pipeline.stagnantThresholdDays || 14}j ou plus, ou dont la date de relance planifiée est dépassée — même s'ils ont eu de l'activité récente.`,
      value: String(pipeline.stagnantDeals || 0),
    },
  ];

  return (
    <div className="crm-kpi-row" style={{ marginBottom: 16 }}>
      {cards.map((k, i) => (
        <div className="crm-kpi-card" key={i}>
          <div className="crm-kpi-value">{k.value}</div>
          <div className="crm-kpi-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name={k.icon} size={12} />
            <span>{k.label}</span>
            {k.help && <HelpTip text={k.help} />}
          </div>
        </div>
      ))}
    </div>
  );
}
