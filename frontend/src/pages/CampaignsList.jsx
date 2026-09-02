/* ===============================================================================
   BAKAL — Campaigns List Page (React)
   Lists all campaigns with filter, sort, project grouping, and row navigation.
   Migrated from renderCampaignsList / renderCampaignRow in campaigns-data.js
   and filterCampaignsList / sortCampaignsList in pages.js.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT, useI18n } from '../i18n';
import api, { request } from '../services/api-client';
import { useConfirm } from '../components/ConfirmModal';
import { showToast } from '../services/notifications';
import { getUser } from '../services/auth';
import CampaignAssistant from '../components/campaigns/CampaignAssistant';

export default function CampaignsList({ onNavigateCampaign }) {
  const { campaigns, projects, setCampaigns } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const { lang } = useI18n();
  const confirm = useConfirm();
  const en = lang === 'en';
  const user = getUser();
  // Non-admins get the campaign assistant only — no tab switcher, no campaign-list/autopilot
  // management views (matches this app's existing "simplified UI for non-admins" principle
  // elsewhere, e.g. Layout.jsx's simplified sidebar).
  const isAdmin = !user?.teamRole || user.teamRole === 'admin';
  // CTAs relocated from the old /chat flow (Dashboard, Performance, onboarding, Deal Coach)
  // land here with state.openAssistant to pre-select the Assistant tab instead of an extra click.
  const [view, setView] = useState(location.state?.openAssistant ? 'assistant' : 'campaigns');
  const [actionLoading, setActionLoading] = useState({});

  const [filter, setFilter] = useState('active');
  const [sortByReply, setSortByReply] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState({});

  const FILTERS = useMemo(() => [
    { key: '', label: t('campaigns.all') },
    { key: 'active', label: t('campaigns.active') },
    { key: 'prep', label: t('campaigns.prep') },
    { key: 'archived', label: t('campaigns.archived') },
  ], [t]);

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
    } else if (filter === 'archived') {
      list = list.filter((c) => c.status === 'archived');
    } else {
      // Default "All" : exclude archived
      list = list.filter((c) => c.status !== 'archived');
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

  /* ── Group campaigns by project ── */
  const campaignsByProject = useMemo(() => {
    const grouped = {};
    projectsList.forEach((p) => {
      grouped[p.id] = sorted.filter((c) => c.projectId === p.id);
    });
    grouped._orphans = sorted.filter((c) => !c.projectId);
    return grouped;
  }, [sorted, projectsList]);

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
    } else {
      navigate(`/campaigns/${campaignId}`);
    }
  };

  const handleArchive = useCallback(async (e, campaign) => {
    e.stopPropagation();
    const backendId = campaign._backendId || campaign.id;
    setActionLoading(prev => ({ ...prev, [campaign.id]: 'archiving' }));
    try {
      await api.request('/campaigns/' + backendId, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
      });
      setCampaigns(prev => ({
        ...prev,
        [campaign.id]: { ...prev[campaign.id], status: 'archived' },
      }));
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message });
    }
    setActionLoading(prev => ({ ...prev, [campaign.id]: null }));
  }, [setCampaigns, t, en]);

  const handleDelete = useCallback(async (e, campaign) => {
    e.stopPropagation();
    if (!await confirm(en ? `Delete campaign "${campaign.name}"?` : `Supprimer la campagne "${campaign.name}" ?`, { danger: true })) return;
    const backendId = campaign._backendId || campaign.id;
    setActionLoading(prev => ({ ...prev, [campaign.id]: 'deleting' }));
    try {
      await api.request('/campaigns/' + backendId, { method: 'DELETE' });
      setCampaigns(prev => {
        const next = { ...prev };
        delete next[campaign.id];
        return next;
      });
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message });
    }
    setActionLoading(prev => ({ ...prev, [campaign.id]: null }));
  }, [setCampaigns, t, en]);

  /* ── Non-admins: campaign assistant only, no tab switcher ── */
  if (!isAdmin) {
    return (
      <div id="campaigns-list-view">
        <CampaignAssistant />
      </div>
    );
  }

  const countText = t('campaigns.countSummary', {
    campaigns: campaignsList.length,
    campaignPlural: campaignsList.length > 1 ? 's' : '',
    projects: projectsList.length,
    projectPlural: projectsList.length > 1 ? 's' : '',
  });

  const sortLabel = sortByReply
    ? (sortAsc ? t('campaigns.sortByReplyAsc') : t('campaigns.sortByReplyDesc'))
    : t('campaigns.sortByReply');

  return (
    <div id="campaigns-list-view">
      {/* View tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'campaigns', label: t('campaigns.title') || 'Campaigns' },
          { key: 'autopilot', label: en ? 'Autopilot' : 'Autopilot' },
          { key: 'assistant', label: t('campaigns.tabAssistant') },
        ].map(tab => (
          <button key={tab.key} onClick={() => setView(tab.key)} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            color: view === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
            background: 'none', border: 'none', borderBottom: view === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
            transition: 'all 0.2s',
          }}>
            {tab.key === 'autopilot' && '\uD83E\uDD16 '}{tab.label}
          </button>
        ))}
      </div>

      {view === 'autopilot' && <ProspectionAutopilotSection lang={lang} />}

      {view === 'assistant' && <CampaignAssistant />}

      {view === 'campaigns' && (isEmpty ? (
        <div className="empty-state">
          <div className="empty-state-icon">{'\uD83C\uDFAF'}</div>
          <div className="empty-state-title">{t('campaigns.noCampaigns')}</div>
          <div className="empty-state-desc">
            {t('campaigns.noCampaignsDesc')}
          </div>
          <button className="btn btn-primary" onClick={() => setView('assistant')}>
            {t('campaigns.createFirst')}
          </button>
        </div>
      ) : <>
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
            {sortLabel}
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
          {t('campaigns.filter')}
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
                        {isCollapsed ? '▸' : '▾'}
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
                          {filesCount} {filesCount > 1 ? t('campaigns.filesPlural') : t('campaigns.files')}
                        </span>
                      )}
                      <span className="project-badge">
                        {t('campaigns.campaignCount', { count: totalCount, plural: totalCount > 1 ? 's' : '' })}
                      </span>
                      {activeCount > 0 && (
                        <span className="project-badge project-badge-active">
                          {t('campaigns.activeCount', { count: activeCount, plural: activeCount > 1 ? 's' : '' })}
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
                            onArchive={handleArchive}
                            onDelete={handleDelete}
                            loading={actionLoading[c.id]}
                            t={t}
                          />
                        ))
                      ) : (
                        <div className="project-empty">
                          {t('campaigns.noCampaignsInProject')}
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
                      {collapsedProjects._orphans ? '▸' : '▾'}
                    </span>
                    <span
                      className="project-color-dot"
                      style={{ background: 'var(--text-muted)' }}
                    ></span>
                    <div>
                      <div className="project-header-name">{t('campaigns.noProject')}</div>
                      <div className="project-header-meta">
                        {t('campaigns.noProjectDesc')}
                      </div>
                    </div>
                  </div>
                  <div className="project-header-right">
                    <span className="project-badge">
                      {t('campaigns.campaignCount', { count: campaignsByProject._orphans.length, plural: campaignsByProject._orphans.length > 1 ? 's' : '' })}
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
                        onArchive={handleArchive}
                        onDelete={handleDelete}
                        loading={actionLoading[c.id]}
                        t={t}
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
              onArchive={handleArchive}
              onDelete={handleDelete}
              loading={actionLoading[c.id]}
              t={t}
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
            {t('campaigns.noMatchFilter')}
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}

/* ═══ Prospection Autopilot Section ═══ */

function ProspectionAutopilotSection({ lang }) {
  const en = lang === 'en';
  const [settings, setSettings] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      request('/crm/autopilot/settings').catch(() => ({ enabled: false })),
      request('/crm/autopilot/queue').catch(() => ({ queue: [] })),
    ]).then(([s, q]) => {
      setSettings(s);
      setQueue(q.queue || []);
    }).finally(() => setLoading(false));
  }, []);

  const toggleEnabled = async () => {
    const next = !settings?.enabled;
    try {
      await request('/crm/autopilot/settings', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setSettings(prev => ({ ...prev, enabled: next }));
      showToast({ type: 'success', title: 'Autopilot', message: next ? (en ? 'Enabled' : 'Activé') : (en ? 'Disabled' : 'Désactivé') });
    } catch (err) {
      showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: err.message });
    }
  };

  const cancelMessage = async (id) => {
    try {
      await request(`/crm/autopilot/queue/${id}`, { method: 'DELETE' });
      setQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'cancelled' } : q));
    } catch { /* ignore */ }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{en ? 'Loading...' : 'Chargement...'}</div>;

  const pending = queue.filter(q => q.status === 'pending');
  const sent = queue.filter(q => q.status === 'sent');

  return (
    <div>
      {/* Toggle card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                {'\uD83E\uDD16'} {en ? 'Prospection Autopilot' : 'Autopilot Prospection'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, maxWidth: 500 }}>
                {en
                  ? 'AI responds to prospect replies from Lemlist/Apollo campaigns. Manages conversations until a meeting is booked (max 5 turns, 2-4h delay).'
                  : "L'IA répond aux réponses de vos prospects (Lemlist/Apollo). Gère les conversations jusqu'au RDV (max 5 tours, délai 2-4h)."}
              </div>
            </div>
            <button
              className={`btn ${settings?.enabled ? 'btn-success' : 'btn-outline'}`}
              style={{ fontSize: 12, padding: '8px 18px', minWidth: 90 }}
              onClick={toggleEnabled}
            >
              {settings?.enabled ? (en ? 'Active' : 'Actif') : (en ? 'Enable' : 'Activer')}
            </button>
          </div>
        </div>
      </div>

      {/* Explainer when disabled */}
      {!settings?.enabled && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--bg-elevated)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{en ? 'How it works' : 'Comment ça marche'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              {[
                en ? '1. Prospect replies to your Lemlist/Apollo campaign' : '1. Un prospect répond à votre campagne Lemlist/Apollo',
                en ? '2. AI analyzes intent (interested, question, meeting request...)' : "2. L'IA analyse l'intent (intéressé, question, demande de RDV...)",
                en ? '3. AI generates a reply using conversation history + learned patterns' : "3. L'IA génère une réponse avec l'historique + patterns appris",
                en ? '4. Reply is sent after a 2-4h delay (human-like)' : '4. Réponse envoyée après 2-4h (délai naturel)',
                en ? '5. Continues until a meeting is accepted or max 5 exchanges' : "5. Continue jusqu'au RDV accepté ou max 5 échanges",
              ].map((step, i) => (
                <div key={i} style={{ padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 6, borderLeft: '2px solid var(--primary)' }}>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pending queue */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {'\u23F3'} {en ? `${pending.length} pending reply(ies)` : `${pending.length} réponse(s) en attente`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map(q => {
              const content = typeof q.content === 'string' ? (() => { try { return JSON.parse(q.content); } catch { return {}; } })() : (q.content || {});
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {q.channel === 'linkedin' ? '\uD83D\uDCAC' : '\u2709\uFE0F'} {q.contact_name || q.to_name || q.to_email}
                          {q.company && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> @ {q.company}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                          {content.body || content.message || ''}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {en ? 'Sends at:' : 'Envoi à :'} {new Date(q.scheduled_at).toLocaleString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={() => cancelMessage(q.id)}>
                        {en ? 'Cancel' : 'Annuler'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sent history */}
      {sent.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {'\u2705'} {en ? `${sent.length} auto-reply(ies) sent` : `${sent.length} réponse(s) auto envoyée(s)`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sent.slice(0, 20).map(q => {
              const content = typeof q.content === 'string' ? (() => { try { return JSON.parse(q.content); } catch { return {}; } })() : (q.content || {});
              return (
                <div key={q.id} className="card" style={{ borderLeft: '3px solid var(--success)' }}>
                  <div className="card-body" style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {q.channel === 'linkedin' ? '\uD83D\uDCAC' : '\u2709\uFE0F'} {q.contact_name || q.to_name || q.to_email}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, maxHeight: 40, overflow: 'hidden' }}>
                      {content.body || content.message || ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {en ? 'Sent:' : 'Envoyé :'} {new Date(q.sent_at).toLocaleString(en ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {settings?.enabled && pending.length === 0 && sent.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{'\uD83E\uDD16'}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {en ? 'Autopilot is active. When prospects reply to your campaigns, AI will manage the conversation here.' : "L'autopilot est actif. Quand vos prospects répondront à vos campagnes, l'IA gérera ici."}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Campaign Row
   ═══════════════════════════════════════════════════ */

function CampaignRow({ campaign: c, onClick, onArchive, onDelete, loading, t }) {
  const isPrep = c.status === 'prep';
  const isLinkedin = c.channel === 'linkedin';

  const statusBadge =
    c.status === 'active' ? (
      <span className="status-badge status-active">
        <span className="pulse-dot" style={{ width: 6, height: 6 }}></span>{' '}
        {t('campaigns.statusActive')}
      </span>
    ) : c.status === 'archived' ? (
      <span className="status-badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>📦 {t('campaigns.statusArchived')}</span>
    ) : (
      <span className="status-badge status-prep">⏳ {t('campaigns.statusPrep')}</span>
    );

  let stat1Value, stat1Label, stat2Value, stat2Label;
  if (isPrep) {
    stat1Value = '—';
    stat1Label = '—';
    stat2Value = '—';
    stat2Label = '—';
  } else if (isLinkedin) {
    stat1Value = '—';
    stat1Label = t('campaigns.naLinkedin');
    stat2Value = (c.kpis?.replyRate ?? 0) + '%';
    stat2Label = t('campaigns.replyRate');
  } else {
    stat1Value = (c.kpis?.openRate ?? 0) + '%';
    stat1Label = t('campaigns.openRate');
    stat2Value = (c.kpis?.replyRate ?? 0) + '%';
    stat2Label = t('campaigns.replyRate');
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

  const dateLabel = isPrep ? t('campaigns.created') : t('campaigns.launched');

  // Show actual prospect count from DB first, then sent, then planned (last resort)
  const audienceCount =
    c.kpis?.contacts > 0
      ? c.kpis.contacts
      : c.volume?.sent > 0
        ? c.volume.sent
        : c.volume?.planned > 0
          ? c.volume.planned
          : 0;

  return (
    <div className="campaign-row" onClick={onClick}>
      <div>
        <div className="campaign-row-name">
          {c.name}
          {audienceCount > 0 && (
            <span className="campaign-audience">
              {audienceCount} {t('campaigns.prospects')}
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
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {c.status !== 'archived' && (
          <button
            onClick={(e) => onArchive(e, c)}
            disabled={!!loading}
            title={t('campaigns.archiveTitle')}
            style={{
              background: 'var(--bg-elevated, rgba(255,255,255,0.04))',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              color: 'var(--text-secondary)',
              fontSize: 12,
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              opacity: loading ? 0.5 : 1,
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!loading) { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated, rgba(255,255,255,0.04))'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
            {loading === 'archiving' ? t('campaigns.archiving') : t('campaigns.archive')}
          </button>
        )}
        <button
          onClick={(e) => onDelete(e, c)}
          disabled={!!loading}
          title={t('campaigns.deleteTitle')}
          style={{
            background: 'transparent',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            color: 'var(--danger, #dc2626)',
            fontSize: 12,
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            opacity: loading ? 0.5 : 0.8,
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (!loading) { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; } }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.background = 'transparent'; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          {loading === 'deleting' ? t('campaigns.deleting') : t('campaigns.delete')}
        </button>
        <div className="campaign-row-arrow">&rarr;</div>
      </div>
    </div>
  );
}
