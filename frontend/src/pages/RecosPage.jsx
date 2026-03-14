/* ===============================================================================
   BAKAL — Recommendations Page (React)
   Ported from app/recos.js + HTML mockup.
   Shows AI recommendations with filter, apply/modify/dismiss actions, diff panels.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../context/useApp';
import api from '../services/api-client';
import { sanitizeHtml } from '../services/sanitize';

/* ─── Demo recommendation data ─── */

const DEMO_RECOS = [
  {
    id: 'reco-1',
    priority: 'critical',
    campaign: 'DRH PME Lyon',
    step: 'E1 — Email initial · Offre directe',
    title: 'Remplacer le CTA agressif par une question ouverte',
    desc: 'Le CTA "Seriez-vous disponible 15 minutes cette semaine ?" est trop direct pour un premier contact DRH. Vos données cross-campagne montrent que les <strong>questions ouvertes</strong> sur les pain points génèrent 2x plus de réponses que les propositions de call directes sur ce segment.',
    impact: '+2-3pts reply estimé',
    date: 'Il y a 1h',
    before: 'Nous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement. <span class="strikethrough">Seriez-vous disponible 15 minutes cette semaine pour en discuter ?</span>',
    after: 'Nous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement. <span class="highlight">Quel est votre plus gros défi recrutement en ce moment ?</span>',
  },
  {
    id: 'reco-2',
    priority: 'important',
    campaign: 'DAF Île-de-France',
    step: 'E3 — Email relance · J+7',
    title: "Remplacer l'angle \"coût de l'erreur\" par \"gain de temps\"",
    desc: "L'E3 a un taux de réponse de seulement 1.4% (vs 4.2% sur E1). L'angle anxiogène \"coût d'une erreur de saisie\" est mal reçu par les DAF qui y voient une remise en question de leur compétence. Votre mémoire cross-campagne montre que l'angle positif <strong>\"gain de temps\"</strong> performe systématiquement mieux (+2.1pts en moyenne) sur le segment Comptabilité/Finance.",
    impact: '+2.1pts reply estimé',
    date: 'Il y a 3h',
    before: '{{firstName}}, je change d\'approche. Plutôt que de parler d\'automatisation, une question simple : <span class="strikethrough">quel est le coût réel d\'une erreur de saisie dans un bilan chez {{companyName}} ?</span>',
    after: '{{firstName}}, une question différente : <span class="highlight">si vous pouviez récupérer une journée complète par semaine pour du conseil à valeur ajoutée, qu\'en feriez-vous ?</span> C\'est exactement ce que nos clients dans la finance ont obtenu.',
  },
  {
    id: 'reco-3',
    priority: 'important',
    campaign: 'Dirigeants Formation',
    step: 'L2 — Message post-connexion LinkedIn',
    title: 'Passer de preuve sociale vers angle douleur client',
    desc: 'Le taux de réponse LinkedIn (6.8%) est sous l\'objectif de 8%. Le message actuel utilise une preuve sociale vague ("3 organismes de formation") qui manque de spécificité. Les données montrent que les <strong>questions directes sur les pain points</strong> fonctionnent mieux sur LinkedIn car le format conversationnel s\'y prête naturellement.',
    impact: '+1.5pts reply estimé',
    date: 'Il y a 5h',
    before: "Merci d'avoir accepté, {{firstName}} ! <span class=\"strikethrough\">J'ai accompagné 3 organismes de formation comme le vôtre à générer entre 5 et 12 RDV qualifiés par mois.</span> Curieux de savoir comment vous gérez votre développement commercial actuellement ?",
    after: "Merci d'avoir accepté, {{firstName}} ! <span class=\"highlight\">Quel est votre plus gros frein pour trouver de nouveaux clients en ce moment ?</span> Je pose la question car c'est un sujet qui revient souvent chez les dirigeants d'organismes de formation.",
  },
  {
    id: 'reco-4',
    priority: 'suggestion',
    campaign: 'DAF Île-de-France',
    step: 'E4 — Email break-up · J+12',
    title: 'Raccourcir le break-up de 4 phrases à 3',
    desc: "Le break-up actuel fait 4 phrases, l'objectif est 3 max. La phrase \"Juste un dernier mot : si un jour 12h/semaine...\" peut être fusionnée avec la précédente. Impact faible mais aligné avec les bonnes pratiques de break-up email (court = plus de respect perçu = meilleure image de marque).",
    impact: '',
    date: 'Il y a 5h',
    before: "{{firstName}}, je ne veux pas encombrer votre boîte.<br>Si ce n'est pas le bon moment, pas de souci — je ne reviendrai pas.<br><span class=\"strikethrough\">Juste un dernier mot : si un jour 12h/semaine récupérées ça vous intéresse, mon agenda est ouvert.</span><br>Bonne continuation.",
    after: "{{firstName}}, je ne veux pas encombrer votre boîte.<br><span class=\"highlight\">Si ce n'est pas le bon moment, aucun souci — mon agenda reste ouvert si un jour 12h/semaine récupérées vous intéressent.</span><br>Bonne continuation.",
  },
  {
    id: 'reco-5',
    priority: 'applied',
    campaign: 'DAF Île-de-France',
    step: 'E1 — Objet email initial',
    title: "Personnaliser l'objet avec {{firstName}} + question sectorielle",
    desc: "Remplacement de l'objet générique par un objet personnalisé avec le prénom du prospect et une question ciblée sur le secteur. Résultat : <strong>+8 points de taux d'ouverture</strong> (de 60% à 68%).",
    impact: '▲ +8pts ouverture',
    date: '3 fév.',
    before: '',
    after: '',
    appliedNote: 'Appliquée le 3 fév. · Résultat confirmé après 150 prospects · Itération v2 → v3',
  },
];

const INSIGHTS = [
  {
    title: 'Questions ouvertes > CTA directs',
    text: 'Les CTA sous forme de question ("Quel est votre plus gros frein...?") génèrent 2.1x plus de réponses que les propositions de call directes. Observé sur les 3 campagnes actives.',
    confidence: 'high',
    confidenceLabel: 'Confiance haute · 400+ prospects',
  },
  {
    title: 'Angle positif > anxiogène',
    text: '"Gain de temps" et "récupérer X heures" performent +2.1pts mieux que "coût de l\'erreur" et "risque de..." sur les profils finance et RH.',
    confidence: 'medium',
    confidenceLabel: 'Confiance moyenne · 150 prospects',
  },
];

/* ─── Filter definitions ─── */

const PRIORITY_FILTERS = ['Toutes', 'Critiques', 'Importantes', 'Suggestions', 'Appliquées'];

const PRIORITY_MAP = {
  'Critiques': 'critical',
  'Importantes': 'important',
  'Suggestions': 'suggestion',
  'Appliquées': 'applied',
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
        appliedNote: `Appliquée le ${dateStr} · En attente de données${r.impact ? ' · Impact attendu : ' + r.impact : ''}`,
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

  /* ─── Render helpers ─── */

  function renderBadge(reco) {
    if (reco.status === 'applied' || reco.priority === 'applied') {
      return <span className="reco-priority-badge applied">Appliquée</span>;
    }
    if (reco.status === 'dismissed') {
      return (
        <span
          className="reco-priority-badge"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        >
          Ignorée
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
            <div className="reco-card-desc" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.desc) }} />

            {/* Diff panels */}
            {(reco.before || reco.after) && !isApplied && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label before">Actuel</div>
                  <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.before) }} />
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
                    <div className="reco-diff-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(reco.after) }} />
                  )}
                </div>
              </div>
            )}

            {/* Applied diff — show only the applied version */}
            {isApplied && reco.after && (
              <div className="reco-diff">
                <div className="reco-diff-panel">
                  <div className="reco-diff-label after">Version appliquée</div>
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
                      Appliquer la version modifiée
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
              : "Claude analyse vos campagnes et propose des optimisations · Mis à jour il y a 2h"
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
          <div className="reco-stat-label">Appliquées</div>
          <div className="reco-stat-trend up">{'▲'} +4.2pts réponse en moyenne</div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--warning)' }}>{stats.pending}</div>
          <div className="reco-stat-label">En attente</div>
          <div className="reco-stat-trend" style={{ color: 'var(--warning)' }}>
            {stats.pending > 0 ? '1 critique' : '—'}
          </div>
        </div>
        <div className="reco-stat-card">
          <div className="reco-stat-value" style={{ color: 'var(--text-muted)' }}>{stats.ignored}</div>
          <div className="reco-stat-label">Ignorées</div>
          <div className="reco-stat-trend" style={{ color: 'var(--text-muted)' }}>{'—'}</div>
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
        <div className="reco-insight-title">Patterns cross-campagne détectés</div>
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
