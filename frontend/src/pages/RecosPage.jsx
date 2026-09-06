/* ===============================================================================
   BAKAL — Recommendations Page (React)
   Ported from app/recos.js + HTML mockup.
   Shows AI recommendations with filter, apply/modify/dismiss actions, diff panels.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/useApp';
import api, { sendRecoFeedback } from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';
import { useI18n } from '../i18n';

/* ─── Filter definitions (keyed by internal ID, labels are i18n'd in render) ─── */

const FILTER_KEYS = ['all', 'critical', 'important', 'suggestion', 'applied'];

const FILTER_LABELS = {
  en: { all: 'All', critical: 'Critical', important: 'Important', suggestion: 'Suggestions', applied: 'Applied' },
  fr: { all: 'Toutes', critical: 'Critiques', important: 'Importantes', suggestion: 'Suggestions', applied: 'Appliqu\u00E9es' },
};

/* ─── Component ─── */

export default function RecosPage() {
  const { campaigns, backendAvailable } = useApp();
  const { lang } = useI18n();
  const en = lang === 'en';
  const labels = FILTER_LABELS[en ? 'en' : 'fr'];

  const [recos, setRecos] = useState([]);
  const [insights, setInsights] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [ratedInsights, setRatedInsights] = useState({});

  /* ─── Fetch real diagnostics & memory from backend ─── */

  const fetchRecos = useCallback(async () => {
    if (!backendAvailable) return;
    try {
      const campaignEntries = Object.values(campaigns);
      if (campaignEntries.length === 0) return;

      // Fetch diagnostics for all campaigns + memory patterns in parallel
      const [memoryRes, ...diagResults] = await Promise.all([
        api.getMemory().catch(() => ({ patterns: [] })),
        ...campaignEntries.map(c =>
          api.getDiagnostics(c._backendId || c.id).catch(() => ({ diagnostics: [] }))
        ),
      ]);

      // Build recommendations from diagnostics
      const realRecos = [];
      campaignEntries.forEach((c, i) => {
        const diags = diagResults[i]?.diagnostics || [];
        diags.forEach((d, j) => {
          realRecos.push({
            id: `diag-${c.id}-${j}`,
            priority: d.priority === 'high' ? 'critical' : d.priority === 'medium' ? 'important' : 'suggestion',
            campaign: c.name,
            step: d.step || `Touchpoint ${j + 1}`,
            title: d.title || d.summary || (en ? 'Recommendation' : 'Recommandation'),
            desc: d.text || d.description || '',
            impact: d.impact || '',
            date: d.created_at ? new Date(d.created_at).toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' }) : '',
            before: d.before || '',
            after: d.after || '',
          });
        });
      });

      // Always sync — even if empty (user should see empty state, not stale demo)
      setRecos(realRecos);

      // Build insights from memory patterns
      const patterns = memoryRes.patterns || [];
      setInsights(
        patterns.map(p => ({
          title: p.pattern || p.title || '',
          text: p.data || p.description || '',
          confidence: (p.confidence || '').toLowerCase() === 'haute' ? 'high'
            : (p.confidence || '').toLowerCase() === 'moyenne' ? 'medium' : 'low',
          confidenceLabel: en ? `Confidence: ${p.confidence || 'unknown'}` : `Confiance ${p.confidence || 'inconnue'}`,
        }))
      );

      setDataLoaded(true);
    } catch (err) {
      console.warn('Failed to load recommendations:', err.message);
    }
  }, [backendAvailable, campaigns]);

  useEffect(() => {
    if (!dataLoaded) fetchRecos();
  }, [fetchRecos, dataLoaded]);

  // Derive campaign names for filter buttons
  const campaignNames = useMemo(() => {
    const names = new Set(recos.map(r => r.campaign));
    return [...names];
  }, [recos]);

  // Compute stats
  const stats = useMemo(() => {
    let applied = 0, pending = 0, ignored = 0;
    recos.forEach(r => {
      if (r.status === 'applied') applied++;
      else if (r.status === 'dismissed') ignored++;
      else if (r.priority === 'applied' && r.status !== 'dismissed') applied++;
      else pending++;
    });
    return {
      total: recos.length,
      applied,
      pending,
      ignored,
    };
  }, [recos]);

  // Filter recos
  const filteredRecos = useMemo(() => {
    return recos.filter(r => {
      // Priority filter
      if (activeFilter !== 'all') {
        const targetPriority = activeFilter;
        if (targetPriority === 'applied') {
          if (r.status !== 'applied' && r.priority !== 'applied') return false;
        } else {
          if (r.status === 'applied' || r.status === 'dismissed') return false;
          if (r.priority !== targetPriority) return false;
        }
      }
      // Campaign filter
      if (activeCampaign && r.campaign !== activeCampaign) return false;
      return true;
    });
  }, [recos, activeFilter, activeCampaign]);

  // Count per priority filter
  const filterCounts = useMemo(() => {
    const counts = {};
    FILTER_KEYS.forEach(f => {
      if (f === 'all') {
        counts[f] = recos.length;
      } else if (f === 'applied') {
        counts[f] = recos.filter(r => r.status === 'applied' || r.priority === 'applied').length;
      } else {
        counts[f] = recos.filter(r => r.priority === f && r.status !== 'applied' && r.status !== 'dismissed').length;
      }
    });
    return counts;
  }, [recos]);

  /* ─── Actions ─── */

  const applyReco = useCallback((id) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short' });
    setRecos(prev => prev.map(r => {
      if (r.id !== id) return r;
      return {
        ...r,
        status: 'applied',
        priority: 'applied',
        appliedNote: en
          ? `Applied ${dateStr} · Awaiting data${r.impact ? ' · Expected impact: ' + r.impact : ''}`
          : `Appliqu\u00E9e le ${dateStr} · En attente de donn\u00E9es${r.impact ? ' · Impact attendu : ' + r.impact : ''}`,
      };
    }));
    setEditingId(null);
  }, []);

  const dismissReco = useCallback((id) => {
    setRecos(prev => prev.map(r => {
      if (r.id !== id) return r;
      return { ...r, status: 'dismissed' };
    }));
  }, []);

  const startModify = useCallback((id) => {
    const reco = recos.find(r => r.id === id);
    if (!reco) return;
    setEditingId(id);
    // Strip HTML to get plain text for editing
    const plain = reco.after.replace(/<[^>]*>/g, '');
    setEditText(plain);
  }, [recos]);

  const cancelModify = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const applyModified = useCallback((id) => {
    setRecos(prev => prev.map(r => {
      if (r.id !== id) return r;
      return { ...r, after: editText };
    }));
    applyReco(id);
  }, [editText, applyReco]);

  const rerunAnalysis = useCallback(async () => {
    setAnalysisRunning(true);
    // Yield to allow React to render the loading state before continuing
    await new Promise(r => setTimeout(r, 0));
    if (backendAvailable) {
      try {
        // Run analysis on all active campaigns
        const campaignEntries = Object.values(campaigns).filter(c => c.status === 'active');
        for (const c of campaignEntries) {
          await api.analyzeCampaign(c._backendId || c.id).catch(() => {});
        }
        // Re-fetch updated diagnostics
        setDataLoaded(false);
      } catch {
        /* ignore */
      }
    }
    setAnalysisRunning(false);
  }, [backendAvailable, campaigns]);

  const handleInsightFeedback = useCallback(async (idx, insight, feedback) => {
    setRatedInsights(prev => ({ ...prev, [idx]: feedback }));
    try {
      await sendRecoFeedback(null, insight.title + ': ' + insight.text, feedback);
    } catch {
      /* ignore */
    }
  }, []);

  /* ─── Render helpers ─── */

  function renderBadge(reco) {
    if (reco.status === 'applied' || reco.priority === 'applied') {
      return <span className="reco-priority-badge applied">{en ? 'Applied' : 'Appliqu\u00E9e'}</span>;
    }
    if (reco.status === 'dismissed') {
      return (
        <span
          className="reco-priority-badge"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        >
          {en ? 'Dismissed' : 'Ignor\u00E9e'}
        </span>
      );
    }
    return <span className={`reco-priority-badge ${reco.priority}`}>{
      reco.priority === 'critical' ? (en ? 'Critical' : 'Critique') :
      reco.priority === 'important' ? 'Important' :
      'Suggestion'
    }</span>;
  }

  function renderCard(reco) {
    const isApplied = reco.status === 'applied' || reco.priority === 'applied';
    const isDismissed = reco.status === 'dismissed';
    const isEditing = editingId === reco.id;
    const cardClass = isDismissed
      ? 'reco-card'
      : `reco-card priority-${isApplied ? 'applied' : reco.priority}`;

    return (
      <div
        key={reco.id}
        className={cardClass}
        style={isDismissed ? { opacity: 0.5, borderLeftColor: 'var(--border)' } : undefined}
      >
        {/* Header */}
        <div className="reco-card-header">
          <div className="reco-card-left">
            {renderBadge(reco)}
            <div>
              <div className="reco-card-campaign">{reco.campaign}</div>
              <div className="reco-card-step">{reco.step}</div>
            </div>
          </div>
          <div className="reco-card-meta">
            {reco.impact && <span className="reco-impact-badge">{reco.impact}</span>}
            <span className="reco-card-date">{reco.date}</span>
          </div>
        </div>

        {/* Body */}
        {!isDismissed && (
          <div className="reco-card-body">
            <div className="reco-card-title">{reco.title}</div>
            <div className="reco-card-desc" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.desc) }} />

            {/* Diff panels */}
            {(reco.before || reco.after) && !isApplied && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label before">{en ? 'Current' : 'Actuel'}</div>
                  <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.before) }} />
                </div>
                <div className="reco-diff-panel">
                  <div className={`reco-diff-label ${isEditing ? 'after' : 'after'}`}>
                    {isEditing ? (en ? 'Your version (editable)' : 'Votre version (modifiable)') : (en ? 'Baakalai suggestion' : 'Proposition Baakalai')}
                  </div>
                  {isEditing ? (
                    <textarea
                      className="reco-diff-text"
                      style={{
                        border: '2px solid var(--accent)',
                        borderRadius: '8px',
                        padding: '12px',
                        outline: 'none',
                        minHeight: '60px',
                        width: '100%',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        fontSize: '13px',
                        resize: 'vertical',
                      }}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.after) }} />
                  )}
                </div>
              </div>
            )}

            {/* Applied diff — show only the applied version */}
            {isApplied && reco.after && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label after">{en ? 'Applied version' : 'Version appliqu\u00E9e'}</div>
                  <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.after) }} />
                </div>
              </div>
            )}

            {/* Applied note */}
            {isApplied && reco.appliedNote && (
              <div className="reco-applied-note">
                {reco.appliedNote}
              </div>
            )}

            {/* Actions */}
            {!isApplied && !isDismissed && (
              <div className="reco-card-actions">
                {isEditing ? (
                  <>
                    <button className="reco-btn accept" onClick={() => applyModified(reco.id)}>
                      {en ? 'Apply modified version' : 'Appliquer la version modifi\u00E9e'}
                    </button>
                    <button className="reco-btn dismiss" onClick={cancelModify}>{en ? 'Cancel' : 'Annuler'}</button>
                  </>
                ) : (
                  <>
                    <button className="reco-btn accept" onClick={() => applyReco(reco.id)}>{en ? 'Apply' : 'Appliquer'}</button>
                    <button className="reco-btn modify" onClick={() => startModify(reco.id)}>
                      {en ? 'Modify' : 'Modifier'}{reco.priority === 'critical' ? (en ? ' before applying' : " avant d'appliquer") : ''}
                    </button>
                    <button className="reco-btn dismiss" onClick={() => dismissReco(reco.id)}>{en ? 'Dismiss' : 'Ignorer'}</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ─── Main render ─── */

  return (
    <div id="page-recos">
      {/* Header */}
      <div className="reco-page-header">
        <div>
          <div className="reco-page-title">{en ? 'AI Recommendations' : 'Recommandations IA'}</div>
          <div className="reco-page-subtitle" style={analysisRunning ? { color: 'var(--text-secondary)' } : undefined}>
            {analysisRunning
              ? (en ? 'Baakalai is analyzing your campaigns... Please wait.' : 'Baakalai analyse vos campagnes... Veuillez patienter.')
              : (en ? 'Baakalai analyzes your campaigns and suggests refinements' : 'Baakalai analyse vos campagnes et propose des affinages')
            }
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost">{en ? 'History' : 'Historique'}</button>
          <button className="btn btn-primary" onClick={rerunAnalysis} disabled={analysisRunning}>
            {en ? 'Re-run analysis' : 'Relancer l\'analyse'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="reco-stats">
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
          <div className="reco-stat-label">{en ? 'Total recommendations' : 'Recommandations totales'}</div>
          <div className="reco-stat-trend up">{en ? `${stats.total} total` : `${stats.total} au total`}</div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--success)' }}>{stats.applied}</div>
          <div className="reco-stat-label">{en ? 'Applied' : 'Appliqu\u00E9es'}</div>
          <div className="reco-stat-trend up">{' '}</div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--warning)' }}>{stats.pending}</div>
          <div className="reco-stat-label">{en ? 'Pending' : 'En attente'}</div>
          <div className="reco-stat-trend" style={{ color: 'var(--warning)' }}>
            {stats.pending > 0 ? (en ? `${stats.pending} pending` : `${stats.pending} en attente`) : '\u2014'}
          </div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--text-muted)' }}>{stats.ignored}</div>
          <div className="reco-stat-label">{en ? 'Dismissed' : 'Ignor\u00E9es'}</div>
          <div className="reco-stat-trend" style={{ color: 'var(--text-muted)' }}>{'—'}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="reco-filters">
        {FILTER_KEYS.map(f => (
          <button
            key={f}
            className={`reco-filter${activeFilter === f ? ' active' : ''}`}
            onClick={() => { setActiveFilter(f); setActiveCampaign(null); }}
          >
            {labels[f]} <span className="count">{filterCounts[f]}</span>
          </button>
        ))}
        <span style={{ borderLeft: '1px solid var(--border)', margin: '0 4px' }} />
        {campaignNames.map(name => (
          <button
            key={name}
            className={`reco-filter${activeCampaign === name ? ' active' : ''}`}
            onClick={() => {
              setActiveCampaign(activeCampaign === name ? null : name);
              setActiveFilter('all');
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Recommendation cards */}
      <div className="reco-list">
        {filteredRecos.map(renderCard)}
      </div>

      {/* Cross-campaign insights */}
      <div className="reco-insight-card">
        <div className="reco-insight-title">{en ? 'Cross-campaign patterns detected' : 'Patterns cross-campagne d\u00E9tect\u00E9s'}</div>
        <div className="reco-insight-grid">
          {insights.map((ins, i) => (
            <div key={i} className="reco-insight-item">
              <div className="reco-insight-item-title">{ins.title}</div>
              <div className="reco-insight-item-text">{ins.text}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                <div className={`reco-insight-item-confidence ${ins.confidence}`}>{ins.confidenceLabel}</div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {ratedInsights[i] ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{en ? 'Thanks' : 'Merci'}</span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleInsightFeedback(i, ins, 'useful')}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                        title={en ? 'Useful' : 'Utile'}
                      >{'\uD83D\uDC4D'}</button>
                      <button
                        onClick={() => handleInsightFeedback(i, ins, 'not_useful')}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', padding: '2px 6px', fontSize: '14px', lineHeight: 1 }}
                        title={en ? 'Not useful' : 'Pas utile'}
                      >{'\uD83D\uDC4E'}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
