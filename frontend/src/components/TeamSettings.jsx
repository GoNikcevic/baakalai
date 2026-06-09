/* ═══════════════════════════════════════════════════
   Team Settings — Create/manage team, invite members, assign roles
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { getUser } from '../services/auth';
import { useT, useI18n } from '../i18n';

function getRoleConfig(lang) {
  const en = lang === 'en';
  return {
    admin: { label: en ? 'Admin' : 'Admin', color: 'var(--purple)', desc: en ? 'Full access + team management' : 'Tout acc\u00E8s + gestion \u00E9quipe' },
    prospection: { label: 'Prospection', color: 'var(--blue)', desc: en ? 'Campaigns, prospects, search' : 'Campagnes, prospects, recherche' },
    activation: { label: 'Activation', color: 'var(--success)', desc: en ? 'Clients, triggers, CRM, emails' : 'Clients, triggers, CRM, emails' },
    viewer: { label: 'Viewer', color: 'var(--text-muted)', desc: en ? 'Read-only' : 'Lecture seule' },
  };
}

export default function TeamSettings() {
  const t = useT();
  const { lang } = useI18n();
  const ROLE_CONFIG = getRoleConfig(lang);
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [copied, setCopied] = useState(false);

  const loadTeam = useCallback(async () => {
    try {
      const data = await request('/teams/me');
      setTeam(data.team);
      setMembers(data.members || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const handleCreate = async () => {
    if (!teamName.trim()) return;
    setCreating(true);
    try {
      const data = await request('/teams', {
        method: 'POST',
        body: JSON.stringify({ name: teamName }),
      });
      setTeam(data.team);
      setMembers(data.members || []);
    } catch (err) {
      alert(err.message);
    }
    setCreating(false);
  };

  const handleCopyInvite = () => {
    const url = `${window.location.origin}/join/${team.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRoleChange = async (userId, role) => {
    try {
      await request(`/teams/${team.id}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      loadTeam();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRemove = async (userId, name) => {
    if (!window.confirm(lang === 'en' ? `Remove ${name} from the team?` : `Retirer ${name} de l'\u00E9quipe ?`)) return;
    try {
      await request(`/teams/${team.id}/members/${userId}`, { method: 'DELETE' });
      loadTeam();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRegenInvite = async () => {
    try {
      const data = await request(`/teams/${team.id}/regenerate-invite`, { method: 'POST' });
      setTeam(prev => ({ ...prev, invite_code: data.inviteCode }));
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return null;

  // No team — show creation form
  if (!team) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">{'\uD83D\uDC65'} {t('team.title')}</div>
        </div>
        <div className="card-body">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {t('team.createDesc')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Nom de l'\u00E9quipe"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              className="form-input"
              style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}
            />
            <button
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '8px 16px' }}
              onClick={handleCreate}
              disabled={creating || !teamName.trim()}
            >
              {creating ? 'Cr\u00E9ation...' : 'Cr\u00E9er'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = members.find(m => m.user_id === team.created_by)?.role === 'admin';
  const currentUser = getUser();
  const currentUserRole = members.find(m => m.user_id === currentUser?.id)?.role;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="card-title">{'\uD83D\uDC65'} {t('team.title')}: {team.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {members.length}/{team.max_members || 5} {t('team.members')}
          </div>
        </div>
      </div>

      <div className="card-body">
        {/* Invite link */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          padding: '10px 14px', borderRadius: 8, background: 'var(--bg-elevated)', marginBottom: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{t('team.inviteLink')}</div>
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
              {window.location.origin}/join/{team.invite_code}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 12px' }}
            onClick={handleCopyInvite}
          >
            {copied ? `\u2705 ${t('team.copied')}` : t('team.copy')}
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 12px', color: 'var(--text-muted)' }}
            onClick={handleRegenInvite}
          >
            {'\uD83D\uDD04'}
          </button>
        </div>

        {/* Members list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map(m => {
            const roleConf = ROLE_CONFIG[m.role] || ROLE_CONFIG.viewer;
            const isCreator = m.user_id === team.created_by;
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {m.name}
                    {isCreator && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>cr{'\u00E9'}ateur</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.email}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.user_id, e.target.value)}
                    disabled={isCreator}
                    title={isCreator ? (lang === 'en' ? 'Creator role cannot be changed' : 'Le rôle du créateur ne peut pas être modifié') : ''}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 6,
                      border: `1px solid ${roleConf.color}`,
                      background: `${roleConf.color}15`, color: roleConf.color,
                      cursor: isCreator ? 'not-allowed' : 'pointer',
                      opacity: isCreator ? 0.7 : 1,
                    }}
                  >
                    {Object.entries(ROLE_CONFIG).map(([key, conf]) => (
                      <option key={key} value={key}>{conf.label}</option>
                    ))}
                  </select>
                  {!isCreator && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '2px 8px', color: 'var(--danger)' }}
                      onClick={() => handleRemove(m.user_id, m.name)}
                    >
                      {'\u2715'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
