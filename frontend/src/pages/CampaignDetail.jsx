/* ===============================================================================
   BAKAL · Campaign Detail Page (React)
   Single tabbed page for campaign settings, copy, prospects, performance, history.
   =============================================================================== */

import { useApp } from '../context/useApp';
import CampaignDetailLayout from '../components/campaigns/CampaignDetailLayout';

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

  return <CampaignDetailLayout campaign={campaign} onBack={onBack} setCampaigns={setCampaigns} />;
}
