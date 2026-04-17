/* ═══════════════════════════════════════════════════
   Replies Tab — Shows prospect replies synced from Lemlist
   Auto-syncs on mount, no manual button needed.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useRef } from 'react';
import api from '../../../services/api-client';
import { useT } from '../../../i18n';

export default function RepliesTab({ campaign }) {
  const t = useT();
  const [activities, setActivities] = useState([]);
  const [replyCount, setReplyCount] = useState(0);
  const [loading, setLoading] = useState(true);
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
      api.request('/stats/sync-activities', { method: 'POST' })
        .catch(() => {})
        .finally(() => loadActivities());
    } else {
      loadActivities();
    }
  }, [backendId, filter]);

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
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
          {t('replies.title')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {replyCount} {t('replies.repliesTotal')}
        </div>
      </div>

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
  const hasContent = a.content && a.content.trim().length > 0;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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

        {/* Source + Type badges */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {a.source && a.source !== 'lemlist' && (
            <span
              style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 6,
                background: 'var(--bg-elevated)',
                color: 'var(--text-muted)',
                fontWeight: 600,
                textTransform: 'capitalize',
              }}
            >
              {a.source}
            </span>
          )}
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
        </div>

        {/* Timestamp */}
        {happenedAt && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {happenedAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            {' '}
            {happenedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Reply content preview */}
      {hasContent && (
        <div
          style={{
            marginTop: 10,
            marginLeft: 24,
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            borderLeft: `3px solid ${color}`,
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflow: 'hidden',
          }}
        >
          {a.content.length > 300 ? a.content.slice(0, 300) + '...' : a.content}
        </div>
      )}
    </div>
  );
}
