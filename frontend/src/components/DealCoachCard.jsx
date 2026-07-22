/* ===============================================================================
   BAKAL — Deal Coach Card
   Shows AI-suggested next actions for stagnant deals on the Dashboard.
   Each suggestion has an action button (Send email, Open LinkedIn, etc.).
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';

const URGENCY_STYLES = {
  high: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  medium: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  low: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.15)', color: '#22c55e' },
};

const ACTION_CONFIG = {
  email: { icon: '\uD83D\uDCE7', labelFr: 'Envoyer un email', labelEn: 'Send email' },
  call: { icon: '\uD83D\uDCDE', labelFr: 'Planifier un appel', labelEn: 'Schedule call' },
  linkedin: { icon: '\uD83D\uDC64', labelFr: 'Ouvrir LinkedIn', labelEn: 'Open LinkedIn' },
  content: { icon: '\uD83D\uDCCE', labelFr: 'Partager du contenu', labelEn: 'Share content' },
  intro: { icon: '\uD83E\uDD1D', labelFr: 'Demander une intro', labelEn: 'Request intro' },
  offer: { icon: '\uD83C\uDF81', labelFr: 'Envoyer une offre', labelEn: 'Send offer' },
};

export default function DealCoachCard() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = parseInt(localStorage.getItem('bakal_dealcoach_dismissed') || '0', 10);
      return ts > 0 && (Date.now() - ts) < 24 * 60 * 60 * 1000; // expires after 24h
    } catch { return false; }
  });

  const loadSuggestions = useCallback(async (forceRefresh = false) => {
    // Cache for 30 min to avoid re-running the agent on every dashboard visit
    const userId = (localStorage.getItem('baakal_token') || '').slice(-8);
    const CACHE_KEY = `bakal_dealcoach_cache_${userId}`;
    const CACHE_TTL = 30 * 60 * 1000;
    if (!forceRefresh) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setSuggestions(cached.data);
          setLoading(false);
          return;
        }
      } catch { /* ignore */ }
    }
    try {
      const data = await request('/strategic/run/deal_coach', { method: 'POST' });
      const items = data.suggestions || [];
      setSuggestions(items);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: items }));
    } catch {
      setSuggestions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!dismissed) loadSuggestions(false);
    else setLoading(false);
  }, [dismissed, loadSuggestions]);

  const handleRefresh = useCallback(async () => {
    setRunning(true);
    await loadSuggestions(true);
    setRunning(false);
  }, [loadSuggestions]);

  const handleSendEmail = useCallback((suggestion) => {
    const msg = en
      ? `Send a follow-up email to ${suggestion.contactName} (${suggestion.company || ''}). Context: ${suggestion.reason}. Suggestion: ${suggestion.suggestion}`
      : `Envoie un email de relance \u00e0 ${suggestion.contactName} (${suggestion.company || ''}). Contexte: ${suggestion.reason}. Suggestion: ${suggestion.suggestion}`;
    navigate('/chat', { state: { prefillMessage: msg } });
  }, [en, navigate]);

  if (dismissed || loading) return null;
  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(245,158,11,0.05) 0%, rgba(239,68,68,0.05) 100%)',
      border: '1px solid rgba(245,158,11,0.12)',
      borderRadius: 12,
      padding: '18px 22px',
      marginBottom: 20,
      animation: 'fadeInUp 0.4s ease-out',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {'\uD83C\uDFAF'} {en ? 'Deals to follow up' : 'Deals \u00e0 relancer'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {en ? `${suggestions.length} stagnant deal(s) detected` : `${suggestions.length} deal(s) stagnant(s) d\u00e9tect\u00e9(s)`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={handleRefresh}
            disabled={running}
          >
            {running ? '...' : (en ? 'Refresh' : 'Actualiser')}
          </button>
          <button
            onClick={() => { setDismissed(true); localStorage.setItem('bakal_dealcoach_dismissed', String(Date.now())); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, color: 'var(--text-muted)', padding: 4,
            }}
            title="Dismiss"
          >
            {'\u2715'}
          </button>
        </div>
      </div>

      {/* Suggestions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suggestions.slice(0, 5).map((s, i) => {
          const urgency = URGENCY_STYLES[s.urgency] || URGENCY_STYLES.medium;
          const actionCfg = ACTION_CONFIG[s.action] || ACTION_CONFIG.email;
          const urgencyLabel = s.urgency === 'high' ? (en ? 'Urgent' : 'Urgent')
            : s.urgency === 'low' ? (en ? 'Low' : 'Faible')
            : (en ? 'Medium' : 'Moyen');

          return (
            <div key={i} style={{
              padding: '12px 14px', borderRadius: 10,
              background: urgency.bg, border: `1px solid ${urgency.border}`,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{actionCfg.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {s.contactName}
                  </span>
                  {s.company && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      @ {s.company}
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px',
                    borderRadius: 4, color: urgency.color, background: `${urgency.color}10`,
                  }}>
                    {urgencyLabel}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 3 }}>
                  {s.reason}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', fontStyle: 'italic' }}>
                  {s.suggestion}
                </div>
              </div>

              {/* Action button */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {s.action === 'linkedin' ? (
                  <a
                    href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(s.contactName + (s.company ? ' ' + s.company : ''))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap', textDecoration: 'none' }}
                  >
                    {en ? actionCfg.labelEn : actionCfg.labelFr}
                  </a>
                ) : (
                  <button
                    className={s.action === 'email' || s.action === 'content' || s.action === 'offer' ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
                    onClick={() => handleSendEmail(s)}
                  >
                    {en ? actionCfg.labelEn : actionCfg.labelFr}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
