/* ===============================================================================
   BAKAL — Campaign Detail Page (React)
   Thin orchestrator that delegates to ActiveCampaignDetail / PrepCampaignDetail.
   =============================================================================== */

import { useApp } from '../context/useApp';
import ActiveCampaignDetail from '../components/campaigns/ActiveCampaignDetail';
import PrepCampaignDetail from '../components/campaigns/PrepCampaignDetail';

export default function CampaignDetail({ campaignId, onBack }) {
  const { campaigns, setCampaigns } = useApp();
  const campaign = campaigns[campaignId];

  if (!campaign) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p>Campagne introuvable.</p>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Retour aux campagnes
        </button>
      </div>
    );
  }

  if (campaign.status === 'prep') {
    return <PrepCampaignDetail campaign={campaign} onBack={onBack} setCampaigns={setCampaigns} />;
  }

  return <ActiveCampaignDetail campaign={campaign} onBack={onBack} setCampaigns={setCampaigns} />;
}
