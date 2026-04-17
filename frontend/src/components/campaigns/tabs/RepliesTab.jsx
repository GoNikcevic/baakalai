/* ═══════════════════════════════════════════════════
   Replies Tab — Shows prospect replies synced from Lemlist
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useRef } from 'react';
import api from '../../../services/api-client';
import { useT } from '../../../i18n';

export default function RepliesTab({ campaign }) {
  const t = useT();
  const [activities, setActivities] = useState([]);
  const [replyCount, setReplyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [filter, setFilter] = useState('emailsReplied');
  const autoSynced = useRef(false);

  const backendId = campaign._backendId || campaign.id;

  const loadActivities = async () => {
    setLoading(true);
    try {
      const data = await api.request(`/stats/activities/${backendId}?type=${filter}&limit=100`);
      setActivities(data.activities || []);
      setReplyCount(data.replyCount || 0);
    } catch (err) {
      console.error('Failed to load activities:', err);
    }
    setLoading(false);
  };

  // Auto-sync from Lemlist on first mount, then load activities
  useEffect(() => {
    if (!autoSynced.current) {
      autoSynced.current = true;
      setSyncing(true);
      api.request('/stats/sync-activities', { method: 'POST' })
        .then((result) => {
          if (result.synced > 0) {
            setSyncResult({ type: 'success', synced: result.synced });
          }
        })
        .catch(() => {}) // silent on auto-sync failure
        .finally(() => {
          setSyncing(false);
          loadActivities();
        });
    } else {
      loadActivities();
    }
  }, [backendId, filter]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.request('/stats/sync-activities', { method: 'POST' });
      setSyncResult({ type: 'success', synced: result.synced });
      await loadActivities();
    } catch (err) {
      setSyncResult({ type: 'error', message: err.message });
    }
    setSyncing(false);
  };

  const typeLabels = {
    emailsReplied: t('replies.replied'),
    emailsOpened: t('replies.opened'),
    emailsClicked: t('replies.clicked'),
    emailsBounced: t('replies.bounced'),
  };

  const typeColors = {
    emailsReplied: 'var(--success)',
    emailsOpened: 'var(--accent)',
    emailsClicked: 'var(--blue)',
    emailsBounced: 'var(--danger)',
  };

  return (
    <div>
      {/* Header with sync button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('replies.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {replyCount} {t('replies.repliesTotal')}
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '8px 16px' }}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? t('replies.syncing') : t('replies.syncFromLemlist')}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div
          style={{
            background: syncResult.type === 'error' ? 'var(--danger-bg)' : 'rgba(0, 214, 143, 0.1)',
            border: `1px solid ${syncResult.type === 'error' ? 'rgba(255,107,107,0.3)' : 'rgba(0, 214, 143, 0.3)'}`,
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 12,
            color: syncResult.type === 'error' ? 'var(--danger)' : 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            {syncResult.type === 'error'
              ? `${t('replies.syncFailed')}: ${syncResult.message}`
              : t('replies.syncSuccess', { count: syncResult.synced })}
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '4px 8px' }}
            onClick={() => setSyncResult(null)}
          >
            {'\u2715'}
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {Object.entries(typeLabels).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '6px 14px',
              border: `1px solid ${filter === key ? typeColors[key] : 'var(--border)'}`,
              background: filter === key ? `${typeColors[key]}15` : 'transparent',
              borderRadius: 8,
              fontSize: 12,
              color: filter === key ? typeColors[key] : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: filter === key ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Activities list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          {t('common.loading')}
        </div>
      ) : activities.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 40,
          color: 'var(--text-muted)',
          fontSize: 13,
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>
            {filter === 'emailsReplied' ? '\uD83D\uDCEC' : '\uD83D\uDCCA'}
          </div>
          <div>{t('replies.noActivities')}</div>
          <div style={{ fontSize: 11, marginTop: 8 }}>
            {t('replies.noActivitiesHint')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activities.map((a) => (
            <ActivityCard key={a.id} activity={a} typeColors={typeColors} typeLabels={typeLabels} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityCard({ activity: a, typeColors, typeLabels, t }) {
  const name = [a.lead_first_name, a.lead_last_name].filter(Boolean).join(' ') || a.lead_email || t('replies.unknownProspect');
  const happenedAt = a.happened_at ? new Date(a.happened_at) : null;
  const color = typeColors[a.type] || 'var(--text-muted)';

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {name}
          </span>
          {a.company_name && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              @ {a.company_name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {a.lead_email}
          {a.sequence_step != null && (
            <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
              {'\u00B7'} Step {a.sequence_step + 1}
            </span>
          )}
        </div>
      </div>

      {/* Type badge */}
      <span
        style={{
          fontSize: 11,
          padding: '3px 10px',
          borderRadius: 6,
          background: `${color}15`,
          color: color,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {typeLabels[a.type] || a.type}
      </span>

      {/* Timestamp */}
      {happenedAt && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {happenedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          {' '}
          {happenedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
