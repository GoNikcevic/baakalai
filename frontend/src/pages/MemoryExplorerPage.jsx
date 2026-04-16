import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api-client';
import { useT } from '../i18n';

const DEMO_PATTERNS = [
  { id: '1', pattern: "Les objets avec {{firstName}} g\u00e9n\u00e8rent +15% d'ouverture", category: 'Objets', confidence: 'Haute', sectors: ['Tech', 'Finance'], targets: ['DAF', 'DRH'], date_discovered: '2026-02-15', data: { sample_size: 450, avg_improvement: 15.2 } },
  { id: '2', pattern: 'Questions ouvertes > CTA directs pour premiers contacts', category: 'Corps', confidence: 'Haute', sectors: ['Formation', 'Conseil'], targets: ['Dirigeant'], date_discovered: '2026-01-20', data: { sample_size: 300, avg_improvement: 8.5 } },
  { id: '3', pattern: 'LinkedIn connexion notes < 200 chars performent mieux', category: 'LinkedIn', confidence: 'Moyenne', sectors: ['Tech'], targets: ['CTO', 'VP Engineering'], date_discovered: '2026-03-01', data: { sample_size: 120 } },
  { id: '4', pattern: 'Relance J+3 > J+5 pour secteur finance', category: 'Timing', confidence: 'Faible', sectors: ['Finance'], targets: ['DAF'], date_discovered: '2026-03-10', data: { sample_size: 45 } },
];

const CATEGORY_COLORS = { Objets: '#3b82f6', Corps: '#16a34a', Timing: '#f59e0b', LinkedIn: '#8b5cf6', Secteur: '#ef4444', Cible: '#eab308' };
const CONFIDENCE_COLORS = { Haute: '#16a34a', Moyenne: '#f59e0b', Faible: '#9ca3af' };

export default function MemoryExplorerPage() {
  const t = useT();
  const navigate = useNavigate();
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [expandedData, setExpandedData] = useState({});
  const [showTimeline, setShowTimeline] = useState(false);

  const CATEGORIES = useMemo(() => [
    { key: 'all', label: t('memory.all') },
    { key: 'Objets', label: t('memory.subjects') },
    { key: 'Corps', label: t('memory.body') },
    { key: 'Timing', label: t('memory.timing') },
    { key: 'LinkedIn', label: t('memory.linkedin') },
    { key: 'Secteur', label: t('memory.sector') },
    { key: 'Cible', label: t('memory.target') },
  ], [t]);

  const CONFIDENCES = useMemo(() => [
    { key: 'all', label: t('memory.all') },
    { key: 'Haute', label: t('memory.high') },
    { key: 'Moyenne', label: t('memory.medium') },
    { key: 'Faible', label: t('memory.low') },
  ], [t]);

  useEffect(() => {
    let cancelled = false;
    const demoMode = localStorage.getItem('bakal_demo_mode') === 'true';
    async function load() {
      if (demoMode) {
        if (!cancelled) { setPatterns(DEMO_PATTERNS); setLoading(false); }
        return;
      }
      try {
        const res = await api.getMemory();
        if (!cancelled) setPatterns(res.patterns || []);
      } catch { if (!cancelled) setPatterns([]); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    return patterns.filter(p => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (confidenceFilter !== 'all' && p.confidence !== confidenceFilter) return false;
      if (searchText && !p.pattern.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    });
  }, [patterns, categoryFilter, confidenceFilter, searchText]);

  const stats = useMemo(() => ({
    total: patterns.length,
    haute: patterns.filter(p => p.confidence === 'Haute').length,
    categories: new Set(patterns.map(p => p.category)).size,
    sectors: new Set(patterns.flatMap(p => p.sectors || [])).size,
  }), [patterns]);

  const timelineData = useMemo(() => {
    const months = {};
    for (const p of patterns) {
      if (!p.date_discovered) continue;
      const month = p.date_discovered.slice(0, 7);
      if (!months[month]) months[month] = { month, count: 0, categories: {} };
      months[month].count++;
      months[month].categories[p.category] = (months[month].categories[p.category] || 0) + 1;
    }
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [patterns]);

  const maxMonthCount = Math.max(...timelineData.map(d => d.count), 1);

  function toggleData(id) { setExpandedData(prev => ({ ...prev, [id]: !prev[id] })); }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try { return new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return dateStr; }
  }

  const handleApply = useCallback((pattern) => {
    const msg = t('memory.applyMsg') + pattern.pattern;
    navigate('/chat', { state: { prefillMessage: msg } });
  }, [navigate, t]);

  const [undoPattern, setUndoPattern] = useState(null);
  const undoTimerRef = useRef(null);

  const handleDelete = useCallback((patternId) => {
    // Soft delete: remove from UI immediately, show undo toast for 5s
    const pattern = patterns.find(p => p.id === patternId);
    setPatterns(prev => prev.filter(p => p.id !== patternId));
    setUndoPattern(pattern);

    // Clear any existing timer
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);

    // After 5s, actually delete from DB
    undoTimerRef.current = setTimeout(async () => {
      try {
        await api.request(`/ai/memory/${patternId}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Delete pattern failed:', err.message);
      }
      setUndoPattern(null);
      undoTimerRef.current = null;
    }, 5000);
  }, [patterns]);

  const handleUndo = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    if (undoPattern) {
      setPatterns(prev => [...prev, undoPattern].sort((a, b) =>
        (b.date_discovered || '').localeCompare(a.date_discovered || '')));
      setUndoPattern(null);
    }
  }, [undoPattern]);

  const handleExport = useCallback(() => {
    const headers = ['pattern', 'category', 'confidence', 'sectors', 'date_discovered', 'sample_size'];
    const rows = filtered.map(p => [
      '"' + (p.pattern || '').replace(/"/g, '""') + '"',
      p.category, p.confidence,
      (p.sectors || []).join('; '),
      p.date_discovered || '',
      p.data?.sample_size || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'baakalai-memory-patterns.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  if (loading) {
    return (
      <div className="memory-page">
        <div className="memory-page-header">
          <div className="memory-page-title">{t('memory.title')}</div>
          <div className="memory-page-subtitle">{t('memory.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-page">
      <div className="memory-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="memory-page-title">{t('memory.title')}</div>
          <div className="memory-page-subtitle">{t('memory.subtitle')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setShowTimeline(v => !v)} style={{ fontSize: 12, padding: '6px 12px' }}>
            {showTimeline ? t('memory.all') : t('memory.timeline')}
          </button>
          <button className="btn btn-ghost" onClick={handleExport} style={{ fontSize: 12, padding: '6px 12px' }}>
            {t('memory.exportCsv')}
          </button>
        </div>
      </div>

      <div className="memory-stats">
        {[
          { value: stats.total, label: t('memory.totalPatterns'), color: 'var(--text-primary)' },
          { value: stats.haute, label: t('memory.highConfidence'), color: '#16a34a' },
          { value: stats.categories, label: t('memory.uniqueCategories'), color: '#3b82f6' },
          { value: stats.sectors, label: t('memory.sectorsCovered'), color: '#8b5cf6' },
        ].map((s, i) => (
          <div className="memory-stat-card" key={i}>
            <div className="memory-stat-value" style={{ color: s.color }}>{s.value}</div>
            <div className="memory-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {showTimeline && timelineData.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{t('memory.timeline')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {timelineData.map(d => (
              <div key={d.month} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 60, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{d.month}</div>
                <div style={{ flex: 1, display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden' }}>
                  {Object.entries(d.categories).map(([cat, count]) => (
                    <div key={cat} style={{ width: `${(count / maxMonthCount) * 100}%`, background: CATEGORY_COLORS[cat] || '#888', minWidth: 4 }} title={`${cat}: ${count}`} />
                  ))}
                </div>
                <div style={{ width: 30, fontSize: 11, color: 'var(--text-muted)' }}>{d.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="memory-filters">
        <div className="memory-filter-group">
          {CATEGORIES.map(cat => (
            <button key={cat.key} className={`memory-filter-btn${categoryFilter === cat.key ? ' active' : ''}`}
              onClick={() => setCategoryFilter(cat.key)}
              style={categoryFilter === cat.key && cat.key !== 'all' ? { borderColor: CATEGORY_COLORS[cat.key], color: CATEGORY_COLORS[cat.key] } : undefined}>
              {cat.label}
            </button>
          ))}
        </div>
        <div className="memory-filter-group">
          {CONFIDENCES.map(c => (
            <button key={c.key} className={`memory-filter-btn${confidenceFilter === c.key ? ' active' : ''}`}
              onClick={() => setConfidenceFilter(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <input type="text" className="memory-search-input" placeholder={t('memory.searchPlaceholder')}
          value={searchText} onChange={e => setSearchText(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>{t('memory.noPatterns')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(p => (
            <div key={p.id} style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '20px 24px',
              transition: 'border-color 0.15s',
              position: 'relative',
            }}>
              {/* Delete button */}
              <button
                onClick={() => handleDelete(p.id)}
                title={t('common.close') || 'Supprimer'}
                style={{
                  position: 'absolute', top: 10, right: 12,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 22, lineHeight: 1,
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, opacity: 0.35, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = 'var(--danger, #dc2626)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                {'\u00D7'}
              </button>

              {/* Pattern text */}
              <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: 14 }}>
                {p.pattern}
              </div>

              {/* Badges row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: (CATEGORY_COLORS[p.category] || '#888') + '18',
                  color: CATEGORY_COLORS[p.category] || '#888',
                  border: `1px solid ${(CATEGORY_COLORS[p.category] || '#888')}30`,
                }}>{p.category}</span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: (CONFIDENCE_COLORS[p.confidence] || '#888') + '15',
                  color: CONFIDENCE_COLORS[p.confidence] || '#888',
                }}>{p.confidence}</span>
                {p.sectors?.map(s => (
                  <span key={s} style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 20,
                    background: 'var(--bg-elevated, rgba(255,255,255,0.06))',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}>{s}</span>
                ))}
              </div>

              {/* Footer: date + actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {p.date_discovered && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('memory.discoveredOn')} {formatDate(p.date_discovered)}
                  </span>
                )}
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '6px 14px', borderRadius: 8 }}
                    onClick={() => handleApply(p)}
                  >
                    {t('memory.applyPattern')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
                    onClick={() => toggleData(p.id)}
                  >
                    {expandedData[p.id] ? '\u25B2' : '\u25BC'}
                  </button>
                </div>
              </div>

              {/* Expanded data */}
              {expandedData[p.id] && p.data && (
                <div style={{
                  marginTop: 14, padding: 14,
                  background: 'var(--bg-elevated, rgba(255,255,255,0.03))',
                  borderRadius: 8,
                  fontSize: 12, color: 'var(--text-muted)',
                  borderTop: '1px solid var(--border)',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('memory.rawData')}</div>
                  {p.data.sample_size && <div>{t('memory.sampleSize')}: <strong>{p.data.sample_size}</strong></div>}
                  {p.data.avg_improvement && <div>{t('memory.improvement')}: <strong style={{ color: '#16a34a' }}>+{p.data.avg_improvement}%</strong></div>}
                  <pre style={{ margin: '8px 0 0', fontSize: 10, opacity: 0.6, whiteSpace: 'pre-wrap' }}>{JSON.stringify(p.data, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Undo toast */}
      {undoPattern && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#18181b', color: '#fff', padding: '12px 20px',
          borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 8px 30px rgba(0,0,0,0.3)', zIndex: 9999,
          animation: 'fadeInUp 0.25s ease',
        }}>
          <span>{t('memory.patternDeleted') || 'Pattern supprimé'}</span>
          <button
            onClick={handleUndo}
            style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}
          >
            {t('common.cancel') || 'Annuler'}
          </button>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, height: 3, borderRadius: '0 0 10px 10px',
            background: 'var(--blue, #2AB7CA)',
            animation: 'shrinkBar 5s linear forwards',
          }} />
        </div>
      )}

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(12px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes shrinkBar { from { width: 100%; } to { width: 0%; } }
      `}</style>
    </div>
  );
}
