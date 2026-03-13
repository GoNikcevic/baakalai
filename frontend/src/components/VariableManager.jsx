/* ===============================================================================
   BAKAL — Variable Manager (React)
   Rich variable panel with categories, insert functionality, custom creation modal.
   Ported from /app/variables.js — full React hooks implementation.
   =============================================================================== */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { fetchVariables, createVariable, deleteVariable } from '../services/api-client';

/* ─── Variable Registry (initial data) ─── */

const INITIAL_REGISTRY = {
  prospect: [
    { key: 'firstName',   label: 'Prenom',             sync: 'synced',  source: 'lemlist' },
    { key: 'lastName',    label: 'Nom de famille',     sync: 'synced',  source: 'lemlist' },
    { key: 'email',       label: 'Email',              sync: 'synced',  source: 'lemlist' },
    { key: 'phone',       label: 'Telephone',          sync: 'synced',  source: 'lemlist' },
    { key: 'jobTitle',    label: 'Poste / Fonction',   sync: 'synced',  source: 'lemlist' },
    { key: 'linkedinUrl', label: 'Profil LinkedIn',    sync: 'synced',  source: 'lemlist' },
  ],
  company: [
    { key: 'companyName',   label: "Nom de l'entreprise", sync: 'synced',  source: 'lemlist' },
    { key: 'companyDomain', label: 'Domaine / Site web',  sync: 'synced',  source: 'lemlist' },
    { key: 'industry',      label: "Secteur d'activite",  sync: 'synced',  source: 'lemlist' },
    { key: 'companySize',   label: 'Taille (employes)',    sync: 'synced',  source: 'lemlist' },
    { key: 'city',          label: 'Ville',                sync: 'synced',  source: 'lemlist' },
    { key: 'country',       label: 'Pays',                 sync: 'synced',  source: 'lemlist' },
  ],
  enrichment: [
    { key: 'icebreaker',       label: 'Icebreaker personnalise',    sync: 'custom', source: 'ai' },
    { key: 'painPoint',        label: 'Point de douleur identifie', sync: 'custom', source: 'ai' },
    { key: 'lastPost',         label: 'Dernier post LinkedIn',      sync: 'custom', source: 'scraping' },
    { key: 'mutualConnection', label: 'Connexion en commun',        sync: 'custom', source: 'scraping' },
    { key: 'recentNews',       label: 'Actualite recente',          sync: 'custom', source: 'scraping' },
  ],
  custom: [],
};

const VAR_CATEGORIES = {
  prospect:   { label: 'Prospect',       icon: '\u{1F464}' },
  company:    { label: 'Entreprise',     icon: '\u{1F3E2}' },
  enrichment: { label: 'Enrichissement', icon: '\u{1F9E0}' },
  custom:     { label: 'Personnalise',   icon: '\u{2699}\u{FE0F}' },
};

const SYNC_LABELS = {
  synced: 'Synced Lemlist',
  custom: 'Push vers Lemlist',
  local:  'Local uniquement',
};

const SYNC_ICONS = {
  synced: '✓',
  custom: '↑',
  local:  '—',
};

/* ─── Toast sub-component ─── */

function Toast({ message, onDone }) {
  const [visible, setVisible] = useState(true);

  useState(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300);
    }, 2500);
    return () => clearTimeout(timer);
  });

  return (
    <div
      className="var-toast"
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        background: 'var(--success)', color: '#fff', fontSize: 13, fontWeight: 600,
        padding: '10px 24px', borderRadius: 8, boxShadow: 'var(--shadow)', zIndex: 1001,
        transition: 'opacity 0.3s, transform 0.3s',
        opacity: visible ? 1 : 0,
      }}
    >
      {message}
    </div>
  );
}

/* ─── Custom Variable Modal ─── */

function CreateVarModal({ onClose, onCreate, existingKeys }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [defaultVal, setDefaultVal] = useState('');
  const [category, setCategory] = useState('custom');
  const [syncMode, setSyncMode] = useState('push');
  const [error, setError] = useState('');

  const handleCreate = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Le nom est requis.');
      return;
    }
    if (existingKeys.includes(trimmed)) {
      setError('Cette variable existe deja.');
      return;
    }

    const syncMap = { push: 'custom', pull: 'synced', bidirectional: 'synced', local: 'local' };

    onCreate({
      key: trimmed,
      label: desc.trim() || trimmed,
      sync: syncMap[syncMode] || 'local',
      source: syncMode === 'local' ? 'local' : 'lemlist',
      defaultValue: defaultVal.trim() || null,
      syncMode,
      isCustom: true,
    }, category);
  }, [name, desc, defaultVal, category, syncMode, existingKeys, onCreate]);

  const previewTag = name.trim() ? `{{${name.trim()}}}` : '{{maVariable}}';

  return (
    <div
      className="var-modal-overlay show"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="var-modal"
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
          boxShadow: 'var(--shadow)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Creer une variable personnalisee
        </div>

        {/* Preview */}
        <div style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 16px', marginBottom: 16, textAlign: 'center',
        }}>
          <span className="var-item-tag" style={{ fontSize: 14 }}>{previewTag}</span>
        </div>

        {/* Name */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Nom de la variable
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="ex: customField1"
            autoFocus
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: error ? '1px solid var(--danger)' : '1px solid var(--border)',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
          {error ? (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{error}</div>
          ) : (
            <div className="field-hint" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Sera utilisee comme {'{{nom}}'} dans les messages.
            </div>
          )}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Description (optionnel)
          </label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="ex: Champ personnalise pour..."
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Default value */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Valeur par defaut (optionnel)
          </label>
          <input
            type="text"
            value={defaultVal}
            onChange={(e) => setDefaultVal(e.target.value)}
            placeholder="ex: N/A"
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Category + Sync row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Categorie
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {Object.entries(VAR_CATEGORIES).map(([key, cat]) => (
                <option key={key} value={key}>{cat.icon} {cat.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
              Synchronisation
            </label>
            <select
              value={syncMode}
              onChange={(e) => setSyncMode(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <option value="push">Push vers Lemlist</option>
              <option value="pull">Pull depuis Lemlist</option>
              <option value="bidirectional">Bidirectionnel</option>
              <option value="local">Local uniquement</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '8px 14px' }}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '8px 14px' }}
            onClick={handleCreate}
          >
            Creer la variable
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Variable Item ─── */

function VarItem({ variable, isCustom, onInsert, onDelete }) {
  const [flashed, setFlashed] = useState(false);
  const syncClass = variable.sync || 'local';
  const syncIcon = SYNC_ICONS[syncClass] || '—';

  const handleClick = useCallback(() => {
    onInsert(variable.key);
    setFlashed(true);
    setTimeout(() => setFlashed(false), 600);
  }, [variable.key, onInsert]);

  return (
    <div
      className="var-item"
      onClick={handleClick}
      style={{ cursor: 'pointer', position: 'relative' }}
    >
      <span
        className="var-item-tag"
        style={flashed ? { background: 'rgba(0,214,143,0.25)', color: 'var(--success)', transition: 'background 0.2s' } : undefined}
      >
        {`{{${variable.key}}}`}
      </span>
      <span className="var-item-label">{variable.label}</span>
      <span className={`var-item-sync ${syncClass}`} title={SYNC_LABELS[syncClass]}>
        {syncIcon}
      </span>
      {isCustom && (
        <div className="var-item-actions">
          <button
            className="var-item-action-btn"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="Supprimer"
          >
            ✕
          </button>
        </div>
      )}
      <div className="var-item-tooltip">
        Cliquez pour inserer &middot; {SYNC_LABELS[syncClass]}
      </div>
    </div>
  );
}

/* ─── Variable Insert Bar (inline, for integration in editors) ─── */

export function VarInsertBar({ registry, onInsert }) {
  const allVars = useMemo(() => {
    const vars = [];
    Object.values(registry || INITIAL_REGISTRY).forEach(arr => {
      arr.forEach(v => vars.push(v.key));
    });
    return vars;
  }, [registry]);

  return (
    <div className="var-insert-bar">
      {allVars.map(k => (
        <span
          key={k}
          className="var-insert-chip"
          onClick={(e) => { e.stopPropagation(); onInsert(k); }}
          title={`Inserer {{${k}}}`}
        >
          {`{{${k}}}`}
        </span>
      ))}
    </div>
  );
}

/* ═══ Main Component ═══ */

/**
 * VariableManager — collapsible sidebar panel showing all variables by category.
 *
 * Props:
 * - onInsertVariable(key: string): called when user clicks a variable to insert it
 * - initialRegistry?: custom initial registry (defaults to INITIAL_REGISTRY)
 * - defaultOpen?: boolean (defaults to false)
 * - onRegistryChange?(registry): called when registry changes (custom var add/delete)
 */
export default function VariableManager({
  onInsertVariable,
  initialRegistry,
  defaultOpen = false,
  onRegistryChange,
}) {
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  const [registry, setRegistry] = useState(() =>
    initialRegistry ? JSON.parse(JSON.stringify(initialRegistry)) : JSON.parse(JSON.stringify(INITIAL_REGISTRY))
  );
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [backendLoaded, setBackendLoaded] = useState(false);

  /* ─── Load custom variables from backend on mount ─── */
  useEffect(() => {
    if (backendLoaded) return;
    fetchVariables()
      .then((vars) => {
        if (vars.length > 0) {
          setRegistry(prev => {
            const syncMap = { push: 'custom', pull: 'synced', bidirectional: 'synced', local: 'local' };
            const customVars = vars.map(v => ({
              key: v.key,
              label: v.label || v.key,
              sync: syncMap[v.sync_mode] || 'local',
              source: v.sync_mode === 'local' ? 'local' : 'lemlist',
              defaultValue: v.default_value || null,
              syncMode: v.sync_mode,
              isCustom: true,
              _backendId: v.id,
            }));
            const updated = { ...prev, custom: customVars };
            if (onRegistryChange) onRegistryChange(updated);
            return updated;
          });
        }
        setBackendLoaded(true);
      })
      .catch(() => {
        setBackendLoaded(true);
      });
  }, [backendLoaded, onRegistryChange]);

  /* ─── Computed ─── */

  const totalCount = useMemo(() => {
    return Object.values(registry).reduce((sum, arr) => sum + arr.length, 0);
  }, [registry]);

  const allKeys = useMemo(() => {
    return Object.values(registry).flat().map(v => v.key);
  }, [registry]);

  /* ─── Handlers ─── */

  const togglePanel = useCallback(() => {
    setPanelOpen(prev => !prev);
  }, []);

  const handleInsert = useCallback((key) => {
    if (onInsertVariable) {
      onInsertVariable(key);
    } else {
      // Default: show a hint toast
      setToast('Cliquez dans un champ de message pour y inserer la variable.');
    }
  }, [onInsertVariable]);

  const handleCreateVariable = useCallback(async (newVar, targetCategory) => {
    // Persist to backend
    try {
      const saved = await createVariable({
        key: newVar.key,
        label: newVar.label,
        category: targetCategory,
        syncMode: newVar.syncMode,
        defaultValue: newVar.defaultValue,
      });
      newVar._backendId = saved.id;
    } catch (err) {
      if (err.status === 409) {
        setToast('Cette variable existe deja.');
        return;
      }
      // Continue with local-only if backend unavailable
    }

    setRegistry(prev => {
      const cat = targetCategory === 'custom' ? 'custom' : targetCategory;
      const updated = {
        ...prev,
        [cat]: [...(prev[cat] || []), newVar],
      };
      if (onRegistryChange) onRegistryChange(updated);
      return updated;
    });
    setShowModal(false);
    const syncNote = newVar.syncMode !== 'local' ? ' · Sync Lemlist activee' : '';
    setToast(`Variable {{${newVar.key}}} creee${syncNote}`);
  }, [onRegistryChange]);

  const handleDeleteCustomVar = useCallback(async (index) => {
    const deleted = registry.custom[index];
    if (!deleted) return;

    // Delete from backend if it has a backend ID
    if (deleted._backendId) {
      try {
        await deleteVariable(deleted._backendId);
      } catch {
        // Continue with local removal even if backend fails
      }
    }

    setRegistry(prev => {
      const updated = {
        ...prev,
        custom: prev.custom.filter((_, i) => i !== index),
      };
      if (onRegistryChange) onRegistryChange(updated);
      return updated;
    });
    setToast(`Variable {{${deleted.key}}} supprimee`);
  }, [registry.custom, onRegistryChange]);

  /* ─── Render ─── */

  return (
    <>
      {/* Panel toggle header */}
      <div
        id="var-panel-toggle"
        className={`var-panel-toggle${panelOpen ? ' open' : ''}`}
        onClick={togglePanel}
        style={{ cursor: 'pointer' }}
      >
        <span>Variables</span>
        <span id="var-panel-count" className="var-panel-count">{totalCount}</span>
      </div>

      {/* Panel body */}
      {panelOpen && (
        <div id="var-panel-body" className="var-panel-body open">
          {Object.entries(registry).map(([catKey, vars]) => {
            // Skip empty non-custom categories
            if (vars.length === 0 && catKey !== 'custom') return null;
            const cat = VAR_CATEGORIES[catKey];
            if (!cat) return null;

            return (
              <div className="var-group" key={catKey}>
                <div className="var-group-label">{cat.icon} {cat.label}</div>
                <div className="var-list">
                  {vars.map((v, idx) => (
                    <VarItem
                      key={v.key}
                      variable={v}
                      isCustom={catKey === 'custom'}
                      onInsert={handleInsert}
                      onDelete={() => handleDeleteCustomVar(idx)}
                    />
                  ))}
                </div>
                {catKey === 'custom' && (
                  <button className="var-add-btn" onClick={() => setShowModal(true)}>
                    + Creer une variable
                  </button>
                )}
              </div>
            );
          })}

          {/* Show custom section with create button even when empty */}
          {registry.custom.length === 0 && (
            <div className="var-group">
              <div className="var-group-label">
                {VAR_CATEGORIES.custom.icon} {VAR_CATEGORIES.custom.label}
              </div>
              <button className="var-add-btn" onClick={() => setShowModal(true)}>
                + Creer une variable
              </button>
            </div>
          )}
        </div>
      )}

      {/* Create variable modal */}
      {showModal && (
        <CreateVarModal
          onClose={() => setShowModal(false)}
          onCreate={handleCreateVariable}
          existingKeys={allKeys}
        />
      )}

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast}
          onDone={() => setToast(null)}
        />
      )}
    </>
  );
}

/* ─── Export registry for external use ─── */
export { INITIAL_REGISTRY, VAR_CATEGORIES, SYNC_LABELS };
