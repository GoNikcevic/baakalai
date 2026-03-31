/* ═══════════════════════════════════════════════════
   VersionDiff — Version history with diff & rollback
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api-client';
import { getVersions } from '../../services/api-client';

const RESULT_META = {
  testing:  { label: 'En cours',  color: 'var(--blue)',    bg: 'var(--blue-bg)' },
  improved: { label: 'Ameliore',  color: 'var(--success)', bg: 'var(--success-bg)' },
  degraded: { label: 'Degrade',   color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  neutral:  { label: 'Neutre',    color: 'var(--text-muted)', bg: 'var(--accent-glow)' },
};

export default function VersionDiff({ campaignId, sequence }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [rollingBack, setRollingBack] = useState(null);
  const [rollbackMsg, setRollbackMsg] = useState(null);

  const fetchVersions = useCallback(() => {
    if (!campaignId) return;
    setLoading(true);
    getVersions(campaignId)
      .then((res) => {
        const items = res.versions || [];
        items.sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
        setVersions(items);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => { fetchVersions(); }, [fetchVersions]);

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /** Find current touchpoint from sequence by step ID */
  const findStep = (stepId) => {
    return (sequence || []).find((s) => s.id === stepId || s.step === stepId);
  };

  /** Parse rollback_data safely */
  const parseRollback = (raw) => {
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  };

  const handleRollback = async (versionId) => {
    if (!window.confirm('Restaurer cette version ? Les messages actuels seront remplaces par les originaux.')) return;
    setRollingBack(versionId);
    setRollbackMsg(null);
    try {
      await api.request('/ai/rollback/' + versionId, { method: 'POST' });
      setRollbackMsg({ type: 'success', text: 'Version restauree avec succes.' });
      fetchVersions();
    } catch (err) {
      setRollbackMsg({ type: 'error', text: 'Erreur : ' + err.message });
    } finally {
      setRollingBack(null);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-header"><div className="card-title">Historique des modifications</div></div>
        <div className="card-body" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px' }}>
          Chargement...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="card-header"><div className="card-title">Historique des modifications</div></div>
        <div className="card-body" style={{ textAlign: 'center', color: 'var(--danger)', fontSize: '13px', padding: '24px' }}>
          Erreur : {error}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">Historique des modifications</div></div>
      <div className="card-body">
        {rollbackMsg && (
          <div style={{
            padding: '10px 14px',
            marginBottom: '12px',
            borderRadius: '8px',
            fontSize: '13px',
            background: rollbackMsg.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: rollbackMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          }}>
            {rollbackMsg.text}
          </div>
        )}

        {versions.length === 0 && (
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
            Aucune modification enregistree.
          </div>
        )}

        <div className="version-list">
          {versions.map((v) => {
            const isOpen = expanded[v.id];
            const meta = RESULT_META[v.result] || RESULT_META.neutral;
            const rollbackData = parseRollback(v.rollback_data);
            const canRollback = rollbackData && v.result !== 'improved';

            return (
              <div className="version-item" key={v.id}>
                <div className="version-header" onClick={() => toggleExpand(v.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <span className="version-number">v{v.version}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {formatDate(v.date)}
                    </span>
                    <span className="version-badge" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{isOpen ? '▾' : '▸'}</span>
                </div>

                {isOpen && (
                  <div className="version-detail">
                    {/* Modified steps */}
                    {(v.messages_modified || []).length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                          Etapes modifiees
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {v.messages_modified.map((stepId, i) => (
                            <span className="diag-step-badge" key={i}>{stepId}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hypotheses */}
                    {v.hypotheses && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                          Hypothese testee
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                          {v.hypotheses}
                        </div>
                      </div>
                    )}

                    {/* Diff view */}
                    {rollbackData && (v.messages_modified || []).length > 0 && (
                      <div className="version-diff">
                        {v.messages_modified.map((stepId) => {
                          const original = Array.isArray(rollbackData)
                            ? rollbackData.find((r) => r.id === stepId || r.step === stepId)
                            : rollbackData[stepId];
                          const current = findStep(stepId);
                          if (!original && !current) return null;

                          return (
                            <div key={stepId} style={{ marginBottom: '16px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
                                {stepId}
                              </div>
                              <div className="version-diff-grid">
                                <div className="version-diff-panel version-diff-before">
                                  <div className="version-diff-label">Avant</div>
                                  {original?.subject && (
                                    <div className="version-diff-field">
                                      <span className="version-diff-field-label">Objet :</span> {original.subject}
                                    </div>
                                  )}
                                  <div className="version-diff-body">
                                    {original?.body || '(vide)'}
                                  </div>
                                </div>
                                <div className="version-diff-panel version-diff-after">
                                  <div className="version-diff-label">Apres</div>
                                  {current?.subject && (
                                    <div className="version-diff-field">
                                      <span className="version-diff-field-label">Objet :</span> {current.subject}
                                    </div>
                                  )}
                                  <div className="version-diff-body">
                                    {current?.body || '(vide)'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Rollback button */}
                    {canRollback && (
                      <button
                        className="version-rollback-btn"
                        onClick={(e) => { e.stopPropagation(); handleRollback(v.id); }}
                        disabled={rollingBack === v.id}
                      >
                        {rollingBack === v.id ? 'Restauration...' : 'Restaurer cette version'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
