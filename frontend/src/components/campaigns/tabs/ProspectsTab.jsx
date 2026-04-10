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

          {/* Bulk reveal button */}
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
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {p.name}
                    {p.email
                      ? <span style={{ color: 'var(--success, #16a34a)', fontSize: 10, marginLeft: 6 }}>✓ {p.email}</span>
                      : <span style={{ color: 'var(--warning)', fontSize: 10, marginLeft: 6 }}>(sans email)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.title} · {p.company} {p.company_size && `· ${p.company_size}`}
                  </div>
                </div>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
