/* ===============================================================================
   BAKAL — NotificationBell Component
   Bell icon with unread badge + dropdown of recent notifications.
   Listens to real-time socket events and polls on mount.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';
import { useT } from '../i18n';
import { request } from '../services/api-client';

/* ─── Type → icon mapping ─── */
const TYPE_ICONS = {
  campaign_launched: '🚀',
  batch_complete: '📦',
  ab_winner: '🏆',
  anomaly: '⚠️',
  reveal_done: '📧',
  icp_ready: '🎯',
  welcome: '👋',
};

/* ─── Time-ago helper ─── */
function timeAgo(dateStr, t) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('notifications.justNow');
  if (mins < 60) return t('notifications.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('notifications.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('notifications.daysAgo', { count: days });
}

export default function NotificationBell() {
  const t = useT();
  const { socket } = useSocket();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  /* ─── Fetch unread count ─── */
  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await request('/notifications/unread-count');
      setUnreadCount(data.count);
    } catch {
      // silent — non-critical
    }
  }, []);

  /* ─── Fetch notifications list ─── */
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/notifications?limit=20');
      setNotifications(data.notifications || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  /* ─── Poll on mount ─── */
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  /* ─── Socket real-time listener ─── */
  useEffect(() => {
    if (!socket) return;
    const onNewNotification = (notif) => {
      setNotifications((prev) => [notif, ...prev].slice(0, 20));
      setUnreadCount((prev) => prev + 1);
    };
    socket.on('notification:new', onNewNotification);
    return () => {
      socket.off('notification:new', onNewNotification);
    };
  }, [socket]);

  /* ─── Click outside to close ─── */
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* ─── Toggle dropdown ─── */
  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  /* ─── Mark one as read ─── */
  const handleMarkRead = async (id) => {
    try {
      await request(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silent
    }
  };

  /* ─── Mark all as read ─── */
  const handleMarkAllRead = async () => {
    try {
      await request('/notifications/read-all', { method: 'PATCH' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  };

  return (
    <div className="notification-bell" ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className="notification-bell-btn"
        title={t('notifications.title')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          padding: '6px',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="notification-badge"
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              background: 'var(--danger, #ef4444)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: '50%',
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            width: 340,
            maxHeight: 420,
            overflowY: 'auto',
            background: 'var(--bg-card, #1e1e2e)',
            border: '1px solid var(--border, #333)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            zIndex: 1000,
            padding: 0,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border, #333)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {t('notifications.title')}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--blue, #3b82f6)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          {/* List */}
          {loading && notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {t('common.loading')}
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {t('notifications.empty')}
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read && handleMarkRead(n.id)}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '10px 16px',
                  cursor: n.read ? 'default' : 'pointer',
                  background: n.read ? 'transparent' : 'var(--bg-elevated, rgba(59,130,246,0.06))',
                  borderBottom: '1px solid var(--border, #222)',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!n.read) e.currentTarget.style.background = 'var(--bg-hover, rgba(59,130,246,0.1))';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = n.read
                    ? 'transparent'
                    : 'var(--bg-elevated, rgba(59,130,246,0.06))';
                }}
              >
                {/* Icon */}
                <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>
                  {TYPE_ICONS[n.type] || '🔔'}
                </span>
                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: n.read ? 400 : 600,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {n.title}
                  </div>
                  {n.body && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        lineHeight: 1.3,
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, opacity: 0.7 }}>
                    {timeAgo(n.created_at, t)}
                  </div>
                </div>
                {/* Unread dot */}
                {!n.read && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--blue, #3b82f6)',
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
