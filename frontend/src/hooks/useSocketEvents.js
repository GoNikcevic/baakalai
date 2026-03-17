/* ===============================================================================
   BAKAL — useSocketEvents Hook
   Listens to Socket.io events and updates app state + shows notifications.
   Use in Layout or any top-level component to wire real-time updates.
   =============================================================================== */

import { useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useApp } from '../context/useApp';
import { useNotifications } from '../context/NotificationContext';

export function useSocketEvents() {
  const { socket } = useSocket();
  const { setCampaigns } = useApp();
  const { showToast } = useNotifications();

  useEffect(() => {
    if (!socket) return;

    // ── Campaign created or updated ──
    const onCampaignUpdated = (campaign) => {
      setCampaigns((prev) => {
        const updated = { ...prev };
        updated[campaign.id] = { ...updated[campaign.id], ...campaign };
        return updated;
      });
      showToast({
        type: 'info',
        title: 'Campagne mise à jour',
        message: campaign.name,
        duration: 4000,
      });
    };

    // ── Stats refreshed ──
    const onStatsRefreshed = (data) => {
      showToast({
        type: 'success',
        title: 'Stats synchronisées',
        message: `Campagne mise à jour avec les dernières stats`,
        duration: 4000,
      });
    };

    // ── Notification from server (generic) ──
    const onNotification = ({ type, title, message }) => {
      showToast({ type: type || 'info', title, message, duration: 5000 });
    };

    socket.on('campaign:updated', onCampaignUpdated);
    socket.on('stats:refreshed', onStatsRefreshed);
    socket.on('notification', onNotification);

    return () => {
      socket.off('campaign:updated', onCampaignUpdated);
      socket.off('stats:refreshed', onStatsRefreshed);
      socket.off('notification', onNotification);
    };
  }, [socket, setCampaigns, showToast]);
}
