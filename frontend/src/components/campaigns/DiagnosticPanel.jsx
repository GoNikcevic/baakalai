/* ═══════════════════════════════════════════════════
   DiagnosticPanel — Detailed diagnostic viewer
   Fetches and displays AI diagnostics for a campaign
   ═══════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { getDiagnostics } from '../../services/api-client';

export default function DiagnosticPanel({ campaignId, sequence }) {
  const [diagnostics, setDiagnostics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    getDiagnostics(campaignId)
      .then((res) => {
        const items = res.diagnostics || [];
        // Sort newest first
        items.sort((a, b) => new Date(b.date_analyse || b.created_at) - new Date(a.date_analyse || a.created_at));
        setDiagnostics(items);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  /** Map a step ID like "E1" to its label from the sequence */
  const stepLabel = (stepId) => {
    const step = (sequence || []).find((s) => s.id === stepId || s.step === stepId);
    return step ? (step.label || step.id || stepId) : stepId;
  };

  const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /** Render diagnostic text with basic formatting (line breaks, bold markers) */
  const renderText = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      // Bold lines starting with **...**
      const boldMatch = line.match(/^\*\*(.+?)\*\*(.*)$/);
      if (boldMatch) {
        return (
          <div key={i} style={{ marginBottom: '4px' }}>
            <strong>{boldMatch[1]}</strong>{boldMatch[2]}
          </div>
        );
      }
      // Bullet points
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <div key={i} style={{ paddingLeft: '12px', marginBottom: '2px' }}>
            {line}
          </div>
        );
      }
      return line.trim() ? <div key={i} style={{ marginBottom: '4px' }}>{line}</div> : <br key={i} />;
    });
  };

  if (loading) {
    return (
      <div className="diag-panel">
        <div className="diag-panel-header">Diagnostic par etape -- Claude</div>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          Chargement des diagnostics...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diag-panel">
        <div className="diag-panel-header">Diagnostic par etape -- Claude</div>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--danger)', fontSize: '13px' }}>
          Erreur : {error}
        </div>
      </div>
    );
  }

  if (diagnostics.length === 0) {
    return (
      <div className="diag-panel">
        <div className="diag-panel-header">Diagnostic par etape -- Claude</div>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          Aucun diagnostic disponible pour cette campagne.
        </div>
      </div>
    );
  }

  return (
    <div className="diag-panel">
      <div className="diag-panel-header">Diagnostic par etape -- Claude</div>
      <div className="diag-timeline">
        {diagnostics.map((d) => {
          const isOpen = expanded[d.id];
          const priorities = d.priorities || [];
          return (
            <div className="diag-item" key={d.id}>
              <div className="diag-item-header" onClick={() => toggleExpand(d.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                  <span className="diag-date">{formatDate(d.date_analyse)}</span>
                  {priorities.length > 0 && (
                    <div className="diag-priorities">
                      {priorities.map((p, i) => (
                        <span className="diag-step-badge" key={i} title={stepLabel(p)}>
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                  {d.nb_to_optimize > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--warning)', marginLeft: '4px' }}>
                      {d.nb_to_optimize} a optimiser
                    </span>
                  )}
                </div>
                <span className="diag-toggle">{isOpen ? '▾' : '▸'}</span>
              </div>
              {isOpen && (
                <div className="diag-item-body">
                  {renderText(d.diagnostic)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
