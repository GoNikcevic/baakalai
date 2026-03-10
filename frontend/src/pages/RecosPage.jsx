/* ===============================================================================
   BAKAL — Recommendations Page (React)
   Ported from app/recos.js + HTML mockup.
   Shows AI recommendations with filter, apply/modify/dismiss actions, diff panels.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/useApp';
import api from '../services/api-client';

/* ─── Demo recommendation data ─── */

const DEMO_RECOS = [
  {
    id: 'reco-1',
    priority: 'critical',
    campaign: 'DRH PME Lyon',
    step: 'E1 — Email initial \u00b7 Offre directe',
    title: 'Remplacer le CTA agressif par une question ouverte',
    desc: 'Le CTA "Seriez-vous disponible 15 minutes cette semaine ?" est trop direct pour un premier contact DRH. Vos donn\u00e9es cross-campagne montrent que les <strong>questions ouvertes</strong> sur les pain points g\u00e9n\u00e8rent 2x plus de r\u00e9ponses que les propositions de call directes sur ce segment.',
    impact: '+2-3pts reply estim\u00e9',
    date: 'Il y a 1h',
    before: 'Nous aidons des DRH de PME comme {{companyName}} \u00e0 r\u00e9duire de 40% leur temps de recrutement. <span class="strikethrough">Seriez-vous disponible 15 minutes cette semaine pour en discuter ?</span>',
    after: 'Nous aidons des DRH de PME comme {{companyName}} \u00e0 r\u00e9duire de 40% leur temps de recrutement. <span class="highlight">Quel est votre plus gros d\u00e9fi recrutement en ce moment ?</span>',
  },
  {
    id: 'reco-2',
    priority: 'important',
    campaign: 'DAF \u00cele-de-France',
    step: 'E3 — Email relance \u00b7 J+7',
    title: "Remplacer l'angle \"co\u00fbt de l'erreur\" par \"gain de temps\"",
    desc: "L'E3 a un taux de r\u00e9ponse de seulement 1.4% (vs 4.2% sur E1). L'angle anxiog\u00e8ne \"co\u00fbt d'une erreur de saisie\" est mal re\u00e7u par les DAF qui y voient une remise en question de leur comp\u00e9tence. Votre m\u00e9moire cross-campagne montre que l'angle positif <strong>\"gain de temps\"</strong> performe syst\u00e9matiquement mieux (+2.1pts en moyenne) sur le segment Comptabilit\u00e9/Finance.",
    impact: '+2.1pts reply estim\u00e9',
    date: 'Il y a 3h',
    before: '{{firstName}}, je change d\'approche. Plut\u00f4t que de parler d\'automatisation, une question simple : <span class="strikethrough">quel est le co\u00fbt r\u00e9el d\'une erreur de saisie dans un bilan chez {{companyName}} ?</span>',
    after: '{{firstName}}, une question diff\u00e9rente : <span class="highlight">si vous pouviez r\u00e9cup\u00e9rer une journ\u00e9e compl\u00e8te par semaine pour du conseil \u00e0 valeur ajout\u00e9e, qu\'en feriez-vous ?</span> C\'est exactement ce que nos clients dans la finance ont obtenu.',
  },
  {
    id: 'reco-3',
    priority: 'important',
    campaign: 'Dirigeants Formation',
    step: 'L2 — Message post-connexion LinkedIn',
    title: 'Passer de preuve sociale vers angle douleur client',
    desc: 'Le taux de r\u00e9ponse LinkedIn (6.8%) est sous l\'objectif de 8%. Le message actuel utilise une preuve sociale vague ("3 organismes de formation") qui manque de sp\u00e9cificit\u00e9. Les donn\u00e9es montrent que les <strong>questions directes sur les pain points</strong> fonctionnent mieux sur LinkedIn car le format conversationnel s\'y pr\u00eate naturellement.',
    impact: '+1.5pts reply estim\u00e9',
    date: 'Il y a 5h',
    before: "Merci d'avoir accept\u00e9, {{firstName}} ! <span class=\"strikethrough\">J'ai accompagn\u00e9 3 organismes de formation comme le v\u00f4tre \u00e0 g\u00e9n\u00e9rer entre 5 et 12 RDV qualifi\u00e9s par mois.</span> Curieux de savoir comment vous g\u00e9rez votre d\u00e9veloppement commercial actuellement ?",
    after: "Merci d'avoir accept\u00e9, {{firstName}} ! <span class=\"highlight\">Quel est votre plus gros frein pour trouver de nouveaux clients en ce moment ?</span> Je pose la question car c'est un sujet qui revient souvent chez les dirigeants d'organismes de formation.",
  },
  {
    id: 'reco-4',
    priority: 'suggestion',
    campaign: 'DAF \u00cele-de-France',
    step: 'E4 — Email break-up \u00b7 J+12',
    title: 'Raccourcir le break-up de 4 phrases \u00e0 3',
    desc: "Le break-up actuel fait 4 phrases, l'objectif est 3 max. La phrase \"Juste un dernier mot : si un jour 12h/semaine...\" peut \u00eatre fusionn\u00e9e avec la pr\u00e9c\u00e9dente. Impact faible mais align\u00e9 avec les bonnes pratiques de break-up email (court = plus de respect per\u00e7u = meilleure image de marque).",
    impact: '',
    date: 'Il y a 5h',
    before: "{{firstName}}, je ne veux pas encombrer votre bo\u00eete.<br>Si ce n'est pas le bon moment, pas de souci \u2014 je ne reviendrai pas.<br><span class=\"strikethrough\">Juste un dernier mot : si un jour 12h/semaine r\u00e9cup\u00e9r\u00e9es \u00e7a vous int\u00e9resse, mon agenda est ouvert.</span><br>Bonne continuation.",
    after: "{{firstName}}, je ne veux pas encombrer votre bo\u00eete.<br><span class=\"highlight\">Si ce n'est pas le bon moment, aucun souci \u2014 mon agenda reste ouvert si un jour 12h/semaine r\u00e9cup\u00e9r\u00e9es vous int\u00e9ressent.</span><br>Bonne continuation.",
  },
  {
    id: 'reco-5',
    priority: 'applied',
    campaign: 'DAF \u00cele-de-France',
    step: 'E1 — Objet email initial',
    title: "Personnaliser l'objet avec {{firstName}} + question sectorielle",
    desc: "Remplacement de l'objet g\u00e9n\u00e9rique par un objet personnalis\u00e9 avec le pr\u00e9nom du prospect et une question cibl\u00e9e sur le secteur. R\u00e9sultat : <strong>+8 points de taux d'ouverture</strong> (de 60% \u00e0 68%).",
    impact: '\u25b2 +8pts ouverture',
    date: '3 f\u00e9v.',
    before: '',
    after: '',
    appliedNote: 'Appliqu\u00e9e le 3 f\u00e9v. \u00b7 R\u00e9sultat confirm\u00e9 apr\u00e8s 150 prospects \u00b7 It\u00e9ration v2 \u2192 v3',
  },
];

const INSIGHTS = [
  {
    title: 'Questions ouvertes > CTA directs',
    text: 'Les CTA sous forme de question ("Quel est votre plus gros frein...?") g\u00e9n\u00e8rent 2.1x plus de r\u00e9ponses que les propositions de call directes. Observ\u00e9 sur les 3 campagnes actives.',
    confidence: 'high',
    confidenceLabel: 'Confiance haute \u00b7 400+ prospects',
  },
  {
    title: 'Angle positif > anxiog\u00e8ne',
    text: '"Gain de temps" et "r\u00e9cup\u00e9rer X heures" performent +2.1pts mieux que "co\u00fbt de l\'erreur" et "risque de..." sur les profils finance et RH.',
    confidence: 'medium',
    confidenceLabel: 'Confiance moyenne \u00b7 150 prospects',
  },
];

/* ─── Filter definitions ─── */

const PRIORITY_FILTERS = ['Toutes', 'Critiques', 'Importantes', 'Suggestions', 'Appliqu\u00e9es'];

const PRIORITY_MAP = {
  'Critiques': 'critical',
  'Importantes': 'important',
  'Suggestions': 'suggestion',
  'Appliqu\u00e9es': 'applied',
};

/* ─── Component ─── */

export default function RecosPage() {
  const { campaigns, backendAvailable } = useApp();

  // Local state
  const [recos, setRecos] = useState(DEMO_RECOS);
  const [insights, setInsights] = useState(INSIGHTS);
  const [activeFilter, setActiveFilter] = useState('Toutes');
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

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
            title: d.title || d.summary || 'Recommandation',
            desc: d.text || d.description || '',
            impact: d.impact || '',
            date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '',
            before: d.before || '',
            after: d.after || '',
          });
        });
      });

      if (realRecos.length > 0) {
        setRecos(realRecos);
      }

      // Build insights from memory patterns
      const patterns = memoryRes.patterns || [];
      if (patterns.length > 0) {
        setInsights(patterns.map(p => ({
          title: p.pattern || p.title || '',
          text: p.data || p.description || '',
          confidence: (p.confidence || '').toLowerCase() === 'haute' ? 'high'
            : (p.confidence || '').toLowerCase() === 'moyenne' ? 'medium' : 'low',
          confidenceLabel: `Confiance ${p.confidence || 'inconnue'}`,
        })));
      }

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
      if (activeFilter !== 'Toutes') {
        const targetPriority = PRIORITY_MAP[activeFilter];
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
    PRIORITY_FILTERS.forEach(f => {
      if (f === 'Toutes') {
        counts[f] = recos.length;
      } else {
        const targetPriority = PRIORITY_MAP[f];
        if (targetPriority === 'applied') {
          counts[f] = recos.filter(r => r.status === 'applied' || r.priority === 'applied').length;
        } else {
          counts[f] = recos.filter(r => r.priority === targetPriority && r.status !== 'applied' && r.status !== 'dismissed').length;
        }
      }
    });
    return counts;
  }, [recos]);

  /* ─── Actions ─── */

  const applyReco = useCallback((id) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    setRecos(prev => prev.map(r => {
      if (r.id !== id) return r;
      return {
        ...r,
        status: 'applied',
        priority: 'applied',
        appliedNote: `Appliqu\u00e9e le ${dateStr} \u00b7 En attente de donn\u00e9es${r.impact ? ' \u00b7 Impact attendu : ' + r.impact : ''}`,
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

  /* ─── Render helpers ─── */

  function renderBadge(reco) {
    if (reco.status === 'applied' || reco.priority === 'applied') {
      return <span className="reco-priority-badge applied">Appliqu\u00e9e</span>;
    }
    if (reco.status === 'dismissed') {
      return (
        <span
          className="reco-priority-badge"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        >
          Ignor\u00e9e
        </span>
      );
    }
    return <span className={`reco-priority-badge ${reco.priority}`}>{
      reco.priority === 'critical' ? 'Critique' :
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
            <div className="reco-card-desc" dangerouslySetInnerHTML={{ __html: reco.desc }} />

            {/* Diff panels */}
            {(reco.before || reco.after) && !isApplied && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label before">Actuel</div>
                  <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: reco.before }} />
                </div>
                <div className="reco-diff-panel">
                  <div className={`reco-diff-label ${isEditing ? 'after' : 'after'}`}>
                    {isEditing ? 'Votre version (modifiable)' : 'Proposition Claude'}
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
                    <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: reco.after }} />
                  )}
                </div>
              </div>
            )}

            {/* Applied diff — show only the applied version */}
            {isApplied && reco.after && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label after">Version appliqu\u00e9e</div>
                  <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: reco.after }} />
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
                      Appliquer la version modifi\u00e9e
                    </button>
                    <button className="reco-btn dismiss" onClick={cancelModify}>Annuler</button>
                  </>
                ) : (
                  <>
                    <button className="reco-btn accept" onClick={() => applyReco(reco.id)}>Appliquer</button>
                    <button className="reco-btn modify" onClick={() => startModify(reco.id)}>
                      Modifier{reco.priority === 'critical' ? " avant d'appliquer" : ''}
                    </button>
                    <button className="reco-btn dismiss" onClick={() => dismissReco(reco.id)}>Ignorer</button>
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
          <div className="reco-page-title">Recommandations IA</div>
          <div className="reco-page-subtitle" style={analysisRunning ? { color: 'var(--text-secondary)' } : undefined}>
            {analysisRunning
              ? 'Claude analyse vos campagnes... Veuillez patienter.'
              : "Claude analyse vos campagnes et propose des optimisations \u00b7 Mis \u00e0 jour il y a 2h"
            }
          </div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost">Historique</button>
          <button className="btn btn-primary" onClick={rerunAnalysis} disabled={analysisRunning}>
            Relancer l'analyse
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="reco-stats">
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--text-primary)' }}>{stats.total}</div>
          <div className="reco-stat-label">Recommandations totales</div>
          <div className="reco-stat-trend up">4 nouvelles cette semaine</div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--success)' }}>{stats.applied}</div>
          <div className="reco-stat-label">Appliqu\u00e9es</div>
          <div className="reco-stat-trend up">{'\u25b2'} +4.2pts r\u00e9ponse en moyenne</div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--warning)' }}>{stats.pending}</div>
          <div className="reco-stat-label">En attente</div>
          <div className="reco-stat-trend" style={{ color: 'var(--warning)' }}>
            {stats.pending > 0 ? '1 critique' : '\u2014'}
          </div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--text-muted)' }}>{stats.ignored}</div>
          <div className="reco-stat-label">Ignor\u00e9es</div>
          <div className="reco-stat-trend" style={{ color: 'var(--text-muted)' }}>{'\u2014'}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="reco-filters">
        {PRIORITY_FILTERS.map(f => (
          <button
            key={f}
            className={`reco-filter${activeFilter === f ? ' active' : ''}`}
            onClick={() => { setActiveFilter(f); setActiveCampaign(null); }}
          >
            {f} <span className="count">{filterCounts[f]}</span>
          </button>
        ))}
        <span style={{ borderLeft: '1px solid var(--border)', margin: '0 4px' }} />
        {campaignNames.map(name => (
          <button
            key={name}
            className={`reco-filter${activeCampaign === name ? ' active' : ''}`}
            onClick={() => {
              setActiveCampaign(activeCampaign === name ? null : name);
              setActiveFilter('Toutes');
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
        <div className="reco-insight-title">Patterns cross-campagne d\u00e9tect\u00e9s</div>
        <div className="reco-insight-grid">
          {insights.map((ins, i) => (
            <div key={i} className="reco-insight-item">
              <div className="reco-insight-item-title">{ins.title}</div>
              <div className="reco-insight-item-text">{ins.text}</div>
              <div className={`reco-insight-item-confidence ${ins.confidence}`}>{ins.confidenceLabel}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
