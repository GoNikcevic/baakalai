/* ===============================================================================
   BAKAL · « Automatisations » · tout ce qui tourne tout seul

   Les règles de relance, les workflows en cours, le répondeur automatique, la
   surveillance des signaux et les campagnes équipe. Un seul écran pour ce qui
   se règle une fois, séparé de la file qu'on traite tous les jours.
   =============================================================================== */

import { getUser } from '../../services/auth';
import AutopilotSettings from '../AutopilotSettings';
import TriggersSection from './TriggersSection';
import ActiveWorkflows from './ActiveWorkflows';
import TeamCampaigns from './TeamCampaigns';
import SignalsPage from '../../pages/SignalsPage';
import { useT } from '../../i18n';

const BLOCK = { marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' };

export default function RulesSection() {
  const t = useT();
  const user = getUser();
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';

  return (
    <div>
      <TriggersSection />

      <div style={BLOCK}>
        <ActiveWorkflows />
      </div>

      {/* AutopilotSettings porte déjà son propre titre et son explication. */}
      <div style={BLOCK}>
        <AutopilotSettings scope="crm" />
      </div>

      <div style={BLOCK}>
        <SignalsPage view="config" />
      </div>

      {isAdmin && (
        <div style={BLOCK}>
          <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 10 }}>{t('activation.teamCampaigns')}</div>
          <TeamCampaigns />
        </div>
      )}
    </div>
  );
}
