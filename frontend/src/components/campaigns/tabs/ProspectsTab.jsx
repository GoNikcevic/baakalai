import { useEffect, useState, useRef } from 'react';
import api from '../../../services/api-client';
import ProspectGenerator from '../ProspectGenerator';

export default function ProspectsTab({ campaign: c }) {
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);

  // Bulk reveal state
  const [revealing, setRevealing] = useState(false);
  const [revealProgress, setRevealProgress] = useState({ done: 0, total: 0 });
  const [revealError, setRevealError] = useState(null);
  const pollRef = useRef(null);

  const reload = async () => {
    setLoading(true);
    try {
      const backendId = c._backendId || c.id;
      const data = await api.listCampaignProspects(backendId);
      setProspects(data.prospects || []);
    } catch (err) {
      console.warn('Failed to load prospects:', err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, [c._backendId, c.id]);

  // Cleanup polling on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const prospectsWithoutEmail = prospects.filter(p => !p.email);

  const handleDeleteProspect = async (prospectId) => {
    const backendId = c._backendId || c.id;
    try {
      await api.request(`/campaigns/${backendId}/prospects/${prospectId}`, { method: 'DELETE' });
      setProspects(prev => prev.filter(p => p.id !== prospectId));
    } catch (err) {
      console.warn('Delete failed:', err.message);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(`Supprimer les ${prospects.length} prospects de cette campagne ?`)) return;
    const backendId = c._backendId || c.id;
    try {
      await api.request(`/campaigns/${backendId}/prospects`, { method: 'DELETE' });
      setProspects([]);
    } catch (err) {
      console.warn('Bulk delete failed:', err.message);
    }
  };

  const handleBulkReveal = async () => {
    if (revealing || prospectsWithoutEmail.length === 0) return;
    setRevealing(true);
    setRevealError(null);

    // Prepare leads for the reveal API: split name into firstName/lastName
    const leads = prospectsWithoutEmail.map(p => {
      const parts = (p.name || '').split(' ');
      return {
        id: p.id,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        company: p.company || '',
        companyName: p.company || '',
        linkedinUrl: p.linkedin_url || null,
      };
    });

    try {
      const data = await api.revealEmails('lemlist', leads);
      if (!data.jobId || data.dispatched === 0) {
        setRevealError(
          `Impossible de révéler : ${data.errors || leads.length} contacts ne respectent pas les critères Lemlist (LinkedIn URL OU nom + entreprise requis).`
        );
        setRevealing(false);
        return;
      }

      setRevealProgress({ done: 0, total: leads.length });

      // Poll for results
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.pollRevealEmails(data.jobId);
          setRevealProgress({ done: status.done, total: status.total });

          // Update local prospects with revealed emails
          if (status.results && status.results.length > 0) {
            setProspects(prev => prev.map(p => {
              const r = status.results.find(r => r.id === p.id);
              if (!r || !r.email) return p;
              return { ...p, email: r.email };
            }));

            // Persist revealed emails to DB
            for (const r of status.results) {
              if (r.email && r.id) {
                api.request(`/dashboard/opportunities/${r.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ email: r.email }),
                }).catch(() => {}); // best-effort, non-blocking
              }
            }
          }

          if (status.status === 'done') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setRevealing(false);
            reload(); // Refresh the full list
          }
        } catch (err) {
          console.warn('Reveal poll error:', err.message);
        }
      }, 3000);
    } catch (err) {
      setRevealError(err.message || 'Révélation échouée');
      setRevealing(false);
    }
  };

  return (
    <div>
      <ProspectGenerator campaign={c} onProspectsAdded={reload} />

      {/* Listed prospects */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
        }}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            📋 Prospects liés à la campagne ({prospects.length})
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {prospects.length > 0 && !loading && (
            <button
              className="btn btn-ghost"
              onClick={handleDeleteAll}
              style={{ fontSize: 11, padding: '6px 10px', color: 'var(--text-muted)' }}
            >
              🗑 Tout supprimer
            </button>
          )}
          {prospectsWithoutEmail.length > 0 && !loading && (
            <button
              className="btn btn-primary"
              onClick={handleBulkReveal}
              disabled={revealing}
              style={{ fontSize: 12, padding: '8px 14px' }}
            >
              {revealing
                ? `⏳ Révélation ${revealProgress.done}/${revealProgress.total}...`
                : `🔓 Révéler ${prospectsWithoutEmail.length} email${prospectsWithoutEmail.length > 1 ? 's' : ''} (${prospectsWithoutEmail.length} crédits)`}
            </button>
          )}
          </div>
        </div>

        {revealError && (
          <div style={{
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--danger, #dc2626)',
            marginBottom: 12,
          }}>
            ⚠️ {revealError}
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chargement...</div>
        ) : prospects.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0' }}>
            Aucun prospect pour le moment. Génère-en avec le panel ci-dessus ou ajoute-en depuis le chat.
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {prospects.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {p.name}
                    {p.linkedin_url && (
                      <a
                        href={p.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Voir le profil LinkedIn"
                        style={{ color: 'var(--blue, #0077b5)', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        LinkedIn
                      </a>
                    )}
                    {p.email
                      ? <span style={{ color: 'var(--success, #16a34a)', fontSize: 10 }}>✓ {p.email}</span>
                      : <span style={{ color: 'var(--warning)', fontSize: 10 }}>(sans email)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.title && <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span>}
                    {p.title && p.company && ' · '}
                    {p.company}
                    {p.company_size && ` · ${p.company_size}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {p.status && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '3px 8px',
                        borderRadius: 10,
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {p.status}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProspect(p.id); }}
                    title="Supprimer ce prospect"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      fontSize: 14,
                      padding: '2px 6px',
                      borderRadius: 4,
                      opacity: 0.5,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
