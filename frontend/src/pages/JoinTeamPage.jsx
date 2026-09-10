import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import Icon from '../components/Icon';

const ROLES = [
  { value: 'prospection', label: 'Prospection', desc: 'Campagnes, prospects, recherche' },
  { value: 'activation', label: 'Activation', desc: 'Clients, triggers, CRM, emails' },
  { value: 'viewer', label: 'Viewer', desc: 'Lecture seule' },
];

export default function JoinTeamPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [role, setRole] = useState('prospection');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    try {
      const data = await request(`/teams/join/${code}`, {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      if (data.joined) {
        navigate('/settings');
      }
    } catch (err) {
      setError(err.message);
    }
    setJoining(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 32, maxWidth: 420, width: '100%',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
            <Icon name="users" size={32} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Rejoindre une {'\u00E9'}quipe</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Choisissez votre r{'\u00F4'}le dans l'{'\u00E9'}quipe
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {ROLES.map(r => (
            <label key={r.value} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              border: `1.5px solid ${role === r.value ? 'var(--accent)' : 'var(--border)'}`,
              background: role === r.value ? 'rgba(99,102,241,0.06)' : 'transparent',
            }}>
              <input
                type="radio" name="role" value={r.value}
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 14, padding: '10px' }}
          onClick={handleJoin}
          disabled={joining}
        >
          {joining ? 'Connexion...' : 'Rejoindre'}
        </button>
      </div>
    </div>
  );
}
