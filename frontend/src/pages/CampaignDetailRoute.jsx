import { useParams, useNavigate } from 'react-router-dom';
import CampaignDetail from './CampaignDetail';

export default function CampaignDetailRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <CampaignDetail campaignId={id} onBack={() => navigate('/campaigns', { state: { openHistory: true } })} />;
}
