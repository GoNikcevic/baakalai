/* ===============================================================================
   BAKAL — Campaigns List Page (React)
   Lists all campaigns with filter, sort, project grouping, and row navigation.
   Migrated from renderCampaignsList / renderCampaignRow in campaigns-data.js
   and filterCampaignsList / sortCampaignsList in pages.js.
   =============================================================================== */

import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

const FILTERS = [
  { key: '', label: 'Toutes' },
  { key: 'active', label: 'Active' },
  { key: 'prep', label: 'En preparation' },
];

export default function CampaignsList({ onNavigateCampaign }) {
  const { campaigns, projects } = useApp();

  const [filter, setFilter] = useState('');
  const [sortByReply, setSortByReply] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState({});

  const campaignsList = useMemo(() => Object.values(campaigns), [campaigns]);
  const projectsList = useMemo(() => Object.values(projects), [projects]);
  const isEmpty = campaignsList.length === 0;

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    let list = campaignsList;
    if (filter === 'active') {
      list = list.filter((c) => c.status === 'active');
    } else if (filter === 'prep') {
      list = list.filter((c) => c.status === 'prep');
    }
    return list;
  }, [campaignsList, filter]);

  /* ── Sorting ── */
  const sorted = useMemo(() => {
    if (!sortByReply) return filtered;
    return [...filtered].sort((a, b) => {
      const ra = a.kpis?.replyRate ?? 0;
      const rb = b.kpis?.replyRate ?? 0;
      return sortAsc ? ra - rb : rb - ra;
    });
  }, [filtered, sortByReply, sortAsc]);

  const handleSortToggle = () => {
    if (!sortByReply) {
      setSortByReply(true);
      setSortAsc(false);
    } else {
      setSortAsc((prev) => !prev);
    }
  };

  const toggleProjectCollapse = (projectId) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  const handleRowClick = (campaignId) => {
    if (onNavigateCampaign) {
      onNavigateCampaign(campaignId);
    }
  };

  /* ── Empty state ── */
  if (isEmpty) {
    return (
      <div id="campaigns-list-view">
        <div className="empty-state">
          <div className="empty-state-icon">🎯</div>
          <div className="empty-state-title">Aucune campagne creee</div>
          <div className="empty-state-desc">
            Creez votre premiere campagne de prospection. Choisissez votre cible,
            votre canal et votre angle — Claude s'occupe du reste.
          </div>
          <button className="btn btn-primary">
            Creer ma premiere campagne
          </button>
        </div>
      </div>
    );
  }

  const countText = `${campaignsList.length} campagne${campaignsList.length > 1 ? 's' : ''} \u00B7 ${projectsList.length} projet${projectsList.length > 1 ? 's' : ''}`;

  /* ── Group campaigns by project ── */
  const campaignsByProject = useMemo(() => {
    const grouped = {};
    projectsList.forEach((p) => {
      grouped[p.id] = sorted.filter((c) => c.projectId === p.id);
    });
    grouped._orphans = sorted.filter((c) => !c.projectId);
    return grouped;
  }, [sorted, projectsList]);

  return (
    <div id="campaigns-list-view">
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          {countText}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '11px', padding: '6px 12px' }}
            onClick={handleSortToggle}
          >
            {sortByReply
              ? `Tri par reponse ${sortAsc ? '↑' : '↓'}`
              : 'Trier par reponse'}
          </button>
        </div>
      </div>

      {/* Filter buttons */}
      <div
        className="filter-panel"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          Filtrer :
        </span>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`btn btn-ghost${filter === f.key ? ' active' : ''}`}
            style={{ fontSize: '11px', padding: '6px 12px' }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Campaign list */}
      <div className="campaigns-list">
        {projectsList.length > 0 ? (
          <>
            {projectsList.map((project) => {
              const projectCampaigns = campaignsByProject[project.id] || [];
              const activeCount = projectCampaigns.filter(
                (c) => c.status === 'active'
              ).length;
              const totalCount = projectCampaigns.length;
              const filesCount = (project.files || []).length;
              const isCollapsed = collapsedProjects[project.id];

              return (
                <div className="project-group" key={project.id}>
                  <div
                    className="project-header"
                    onClick={() => toggleProjectCollapse(project.id)}
                  >
                    <div className="project-header-left">
                      <span className="project-chevron">
                        {isCollapsed ? '\u25B8' : '\u25BE'}
                      </span>
                      <span
                        className="project-color-dot"
                        style={{ background: project.color }}
                      ></span>
                      <div>
                        <div className="project-header-name">{project.name}</div>
                        <div className="project-header-meta">
                          {project.description}
                        </div>
                      </div>
                    </div>
                    <div className="project-header-right">
                      {filesCount > 0 && (
                        <span className="project-badge project-badge-files">
                          {filesCount} fichier{filesCount > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="project-badge">
                        {totalCount} campagne{totalCount > 1 ? 's' : ''}
                      </span>
                      {activeCount > 0 && (
                        <span className="project-badge project-badge-active">
                          {activeCount} active{activeCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  {!isCollapsed && (
                    <div className="project-campaigns">
                      {projectCampaigns.length > 0 ? (
                        projectCampaigns.map((c) => (
                          <CampaignRow
                            key={c.id}
                            campaign={c}
                            onClick={() => handleRowClick(c.id)}
                          />
                        ))
                      ) : (
                        <div className="project-empty">
                          Aucune campagne dans ce projet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Orphan campaigns (no project) */}
            {(campaignsByProject._orphans || []).length > 0 && (
              <div className="project-group">
                <div
                  className="project-header"
                  onClick={() => toggleProjectCollapse('_orphans')}
                >
                  <div className="project-header-left">
                    <span className="project-chevron">
                      {collapsedProjects._orphans ? '\u25B8' : '\u25BE'}
                    </span>
                    <span
                      className="project-color-dot"
                      style={{ background: 'var(--text-muted)' }}
                    ></span>
                    <div>
                      <div className="project-header-name">Sans projet</div>
                      <div className="project-header-meta">
                        Campagnes non assignees a un projet
                      </div>
                    </div>
                  </div>
                  <div className="project-header-right">
                    <span className="project-badge">
                      {campaignsByProject._orphans.length} campagne
                      {campaignsByProject._orphans.length > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {!collapsedProjects._orphans && (
                  <div className="project-campaigns">
                    {campaignsByProject._orphans.map((c) => (
                      <CampaignRow
                        key={c.id}
                        campaign={c}
                        onClick={() => handleRowClick(c.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* No projects -- flat list */
          sorted.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              onClick={() => handleRowClick(c.id)}
            />
          ))
        )}

        {/* Filtered-to-zero state */}
        {sorted.length === 0 && !isEmpty && (
          <div
            style={{
              textAlign: 'center',
              padding: '48px 0',
              color: 'var(--text-muted)',
              fontSize: '14px',
            }}
          >
            Aucune campagne ne correspond au filtre selectionne.
          </div>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   Campaign Row
   ═══════════════════════════════════════════════════ */

function CampaignRow({ campaign: c, onClick }) {
  const isPrep = c.status === 'prep';
  const isLinkedin = c.channel === 'linkedin';

  const statusBadge =
    c.status === 'active' ? (
      <span className="status-badge status-active">
        <span className="pulse-dot" style={{ width: 6, height: 6 }}></span>{' '}
        Active
      </span>
    ) : (
      <span className="status-badge status-prep">⏳ Preparation</span>
    );

  let stat1Value, stat1Label, stat2Value, stat2Label;
  if (isPrep) {
    stat1Value = '—';
    stat1Label = '—';
    stat2Value = '—';
    stat2Label = '—';
  } else if (isLinkedin) {
    stat1Value = '—';
    stat1Label = 'N/A LinkedIn';
    stat2Value = (c.kpis?.replyRate ?? 0) + '%';
    stat2Label = 'Reponse';
  } else {
    stat1Value = (c.kpis?.openRate ?? 0) + '%';
    stat1Label = 'Ouverture';
    stat2Value = (c.kpis?.replyRate ?? 0) + '%';
    stat2Label = 'Reponse';
  }

  const stat1Color =
    stat1Value !== '—' && parseFloat(stat1Value) >= 50
      ? 'var(--success)'
      : stat1Value === '—'
        ? 'var(--text-muted)'
        : 'var(--warning)';

  const stat2Color =
    stat2Value !== '—' && parseFloat(stat2Value) >= 8
      ? 'var(--blue)'
      : stat2Value === '—'
        ? 'var(--text-muted)'
        : 'var(--warning)';

  const dateLabel = isPrep ? 'Creee' : 'Lancee';

  const audienceCount =
    c.volume?.sent > 0
      ? c.volume.sent
      : c.volume?.planned > 0
        ? c.volume.planned
        : c.kpis?.contacts > 0
          ? c.kpis.contacts
          : 0;

  return (
    <div className="campaign-row" onClick={onClick}>
      <div>
        <div className="campaign-row-name">
          {c.name}
          {audienceCount > 0 && (
            <span className="campaign-audience">
              {audienceCount} prospects
            </span>
          )}
        </div>
        <div className="campaign-row-meta">
          {c.sectorShort} &middot; {c.size} &middot; {c.angle} &middot;{' '}
          {dateLabel} {c.startDate}
        </div>
      </div>
      <div className="campaign-row-channel">
        <span style={{ color: c.channelColor }}>{c.channelLabel}</span>
      </div>
      <div className="campaign-row-stat">{statusBadge}</div>
      <div className="campaign-row-stat">
        <div className="campaign-row-stat-value" style={{ color: stat1Color }}>
          {stat1Value}
        </div>
        <div className="campaign-row-stat-label">{stat1Label}</div>
      </div>
      <div className="campaign-row-stat">
        <div className="campaign-row-stat-value" style={{ color: stat2Color }}>
          {stat2Value}
        </div>
        <div className="campaign-row-stat-label">{stat2Label}</div>
      </div>
      <div className="campaign-row-arrow">&rarr;</div>
    </div>
  );
}
