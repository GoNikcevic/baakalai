/* ===============================================================================
   BAKAL · Réglages · ce qui n'est pas encore passé dans le modèle Déclencheur

   Cet écran n'est plus une destination, c'est une salle d'attente. Il ne garde
   que ce qui tourne tout seul sans être encore exprimable comme un couple
   « déclencheur -> workflow » : les anciennes règles de relance
   (`nurture_triggers`), les workflows de relance proposés par l'agent, et les
   réglages de la veille.

   Deux blocs en sont sortis, chacun pour une raison précise.

   - **L'autopilot** : décision du 22/09, il devient une ÉTAPE de workflow
     (« répondre automatiquement, N tours »), pas un réglage global de cette
     page. Le moteur (`lib/conversation-autopilot`) reste en place, et le
     réglage vit désormais dans Paramètres, groupe Emailing, à côté des autres
     réglages d'envoi. Le jour où l'étape est branchée, c'est elle qui portera
     le comportement.

   - **Les campagnes équipe** : ce sont des campagnes de prospection envoyées
     depuis la boîte de chaque commercial. Rien d'événementiel là-dedans, donc
     rien à faire sur la page Automatisation. Elles vivent dans Prospection,
     onglet Équipe.
   =============================================================================== */

import TriggersSection from './TriggersSection';
import ActiveWorkflows from './ActiveWorkflows';
import SignalsPage from '../../pages/SignalsPage';

const BLOCK = { marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' };

export default function RulesSection() {
  return (
    <div>
      <TriggersSection />

      <div style={BLOCK}>
        <ActiveWorkflows />
      </div>

      <div style={BLOCK}>
        <SignalsPage view="config" />
      </div>
    </div>
  );
}
