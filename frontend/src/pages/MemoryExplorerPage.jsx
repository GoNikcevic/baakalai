/* ===============================================================================
   BAKAL — Memory Explorer Page
   Dedicated view for browsing cross-campaign memory patterns learned by the AI.
   =============================================================================== */

import { useState, useEffect, useMemo } from 'react';
import api from '../services/api-client';

/* ─── Demo data (fallback when backend unavailable) ─── */

const DEMO_PATTERNS = [
  { id: '1', pattern: "Les objets avec {{firstName}} g\u00e9n\u00e8rent +15% d'ouverture", category: 'Objets', confidence: 'Haute', sectors: ['Tech', 'Finance'], targets: ['DAF', 'DRH'], date_discovered: '2026-02-15', data: { sample_size: 450, avg_improvement: 15.2 } },
  { id: '2', pattern: 'Questions ouvertes > CTA directs pour premiers contacts', category: 'Corps', confidence: 'Haute', sectors: ['Formation', 'Conseil'], targets: ['Dirigeant'], date_discovered: '2026-01-20', data: { sample_size: 300, avg_improvement: 8.5 } },
  { id: '3', pattern: 'LinkedIn connexion notes < 200 chars performent mieux', category: 'LinkedIn', confidence: 'Moyenne', sectors: ['Tech'], targets: ['CTO', 'VP Engineering'], date_discovered: '2026-03-01', data: { sample_size: 120 } },
  { id: '4', pattern: 'Relance J+3 > J+5 pour secteur finance', category: 'Timing', confidence: 'Faible', sectors: ['Finance'], targets: ['DAF'], date_discovered: '2026-03-10', data: { sample_size: 45 } },
];

/* ─── Constants ─── */

const CATEGORIES = ['Toutes', 'Objets', 'Corps', 'Timing', 'LinkedIn', 'Secteur', 'Cible'];
const CONFIDENCES = ['Toutes', 'Haute', 'Moyenne', 'Faible'];

const CATEGORY_COLORS = {
  Objets: 'var(--blue)',
  Corps: 'var(--success)',
  Timing: 'var(--orange)',
  LinkedIn: 'var(--purple)',
  Secteur: 'var(--danger)',
  Cible: 'var(--warning)',
};

const CATEGORY_BG = {
  Objets: 'var(--blue-bg)',
  Corps: 'var(--success-bg)',
  Timing: 'var(--warning-bg)',
  LinkedIn: 'rgba(167, 139, 250, 0.1)',
  Secteur: 'var(--danger-bg)',
  Cible: 'rgba(251, 191, 36, 0.15)',
};

const CONFIDENCE_COLORS = {
  Haute: 'var(--success)',
  Moyenne: 'var(--orange)',
  Faible: 'var(--text-muted)',
};

/* ─── Component ─── */

export default function MemoryExplorerPage() {
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('Toutes');
  const [confidenceFilter, setConfidenceFilter] = useState('Toutes');
  const [searchText, setSearchText] = useState('');
  const [expandedData, setExpandedData] = useState({});

  /* ─── Fetch patterns ─── */

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.getMemory();
        if (!cancelled) {
          const fetched = res.patterns || [];
          setPatterns(fetched.length > 0 ? fetched : DEMO_PATTERNS);
        }
      } catch {
        if (!cancelled) {
          setPatterns(DEMO_PATTERNS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  /* ─── Filtered patterns ─── */

  const filtered = useMemo(() => {
    return patterns.filter(p => {
      if (categoryFilter !== 'Toutes' && p.category !== categoryFilter) return false;
      if (confidenceFilter !== 'Toutes' && p.confidence !== confidenceFilter) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (!p.pattern.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [patterns, categoryFilter, confidenceFilter, searchText]);

  /* ─── Stats ─── */

  const stats = useMemo(() => {
    const hauteCount = patterns.filter(p => p.confidence === 'Haute').length;
    const categories = new Set(patterns.map(p => p.category));
    const sectors = new Set(patterns.flatMap(p => p.sectors || []));
    return {
      total: patterns.length,
      haute: hauteCount,
      categories: categories.size,
      sectors: sectors.size,
    };
  }, [patterns]);

  /* ─── Toggle data expand ─── */

  function toggleData(id) {
    setExpandedData(prev => ({ ...prev, [id]: !prev[id] }));
  }

  /* ─── Format date ─── */

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="memory-page">
        <div className="memory-page-header">
          <div className="memory-page-title">Mémoire IA</div>
          <div className="memory-page-subtitle">Chargement...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-page">
      {/* Header */}
      <div className="memory-page-header">
        <div className="memory-page-title">Mémoire IA</div>
        <div className="memory-page-subtitle">
          Patterns cross-campagne appris par l'IA
        </div>
      </div>

      {/* Stats row */}
      <div className="memory-stats">
        <div className="memory-stat-card">
          <div className="memory-stat-value" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
          <div className="memory-stat-label">Patterns totaux</div>
        </div>
        <div className="memory-stat-card">
          <div className="memory-stat-value" style={{ color: 'var(--success)' }}>{stats.haute}</div>
          <div className="memory-stat-label">Haute confiance</div>
        </div>
        <div className="memory-stat-card">
          <div className="memory-stat-value" style={{ color: 'var(--blue)' }}>{stats.categories}</div>
          <div className="memory-stat-label">Catégories uniques</div>
        </div>
        <div className="memory-stat-card">
          <div className="memory-stat-value" style={{ color: 'var(--purple)' }}>{stats.sectors}</div>
          <div className="memory-stat-label">Secteurs couverts</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="memory-filters">
        {/* Category filters */}
        <div className="memory-filter-group">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`memory-filter-btn${categoryFilter === cat ? ' active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
              style={
                categoryFilter === cat && cat !== 'Toutes'
                  ? { borderColor: CATEGORY_COLORS[cat], color: CATEGORY_COLORS[cat] }
                  : undefined
              }
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Confidence filter */}
        <div className="memory-filter-group">
          <span className="memory-filter-label">Confiance :</span>
          {CONFIDENCES.map(conf => (
            <button
              key={conf}
              className={`memory-filter-btn${confidenceFilter === conf ? ' active' : ''}`}
              onClick={() => setConfidenceFilter(conf)}
            >
              {conf !== 'Toutes' && (
                <span
                  className="memory-confidence-dot"
                  style={{ background: CONFIDENCE_COLORS[conf] }}
                />
              )}
              {conf}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="memory-search-wrapper">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="memory-search-input"
            placeholder="Rechercher un pattern..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
      </div>

      {/* Pattern grid */}
      {filtered.length === 0 ? (
        <div className="memory-empty">
          <div className="memory-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
              <line x1="9" y1="21" x2="15" y2="21" />
              <line x1="10" y1="24" x2="14" y2="24" />
            </svg>
          </div>
          <div className="memory-empty-title">Aucun pattern trouvé</div>
          <div className="memory-empty-text">
            {patterns.length === 0
              ? "L'IA n'a pas encore détecté de patterns. Lancez des campagnes pour alimenter la mémoire."
              : 'Aucun résultat ne correspond aux filtres sélectionnés.'
            }
          </div>
        </div>
      ) : (
        <div className="memory-grid">
          {filtered.map(p => (
            <div key={p.id} className="memory-card">
              {/* Card header */}
              <div className="memory-card-header">
                <span
                  className="memory-badge"
                  style={{
                    color: CATEGORY_COLORS[p.category] || 'var(--text-secondary)',
                    background: CATEGORY_BG[p.category] || 'var(--bg-elevated)',
                  }}
                >
                  {p.category}
                </span>
                <span className="memory-confidence">
                  <span
                    className="memory-confidence-dot"
                    style={{ background: CONFIDENCE_COLORS[p.confidence] || 'var(--text-muted)' }}
                  />
                  {p.confidence}
                </span>
              </div>

              {/* Pattern text */}
              <div className="memory-card-pattern">{p.pattern}</div>

              {/* Sectors tags */}
              {p.sectors && p.sectors.length > 0 && (
                <div className="memory-tags">
                  <span className="memory-tags-label">Secteurs</span>
                  {p.sectors.map(s => (
                    <span key={s} className="memory-tag">{s}</span>
                  ))}
                </div>
              )}

              {/* Targets tags */}
              {p.targets && p.targets.length > 0 && (
                <div className="memory-tags">
                  <span className="memory-tags-label">Cibles</span>
                  {p.targets.map(t => (
                    <span key={t} className="memory-tag target">{t}</span>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="memory-card-footer">
                <span className="memory-card-date">
                  {formatDate(p.date_discovered)}
                </span>
                {p.data && Object.keys(p.data).length > 0 && (
                  <button
                    className="memory-data-toggle"
                    onClick={() => toggleData(p.id)}
                  >
                    {expandedData[p.id] ? 'Masquer' : 'Détails'}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{
                        transform: expandedData[p.id] ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Expanded data */}
              {expandedData[p.id] && p.data && (
                <div className="memory-card-data">
                  <pre>{JSON.stringify(p.data, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
