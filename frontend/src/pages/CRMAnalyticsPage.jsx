/* ===============================================================================
   BAKAL — CRM Analytics Page
   Pipeline, Revenue Attribution, Lead Scoring, Trends, Channels, Health Score.
   =============================================================================== */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useSocket } from '../context/SocketContext';
import api from '../services/api-client';
import { useI18n, useT } from '../i18n';
import EngagementChart from '../components/charts/EngagementChart';
import FunnelChart from '../components/charts/FunnelChart';
import LoadingTips from '../components/LoadingTips';
import Icon from '../components/Icon';

/* ─── Helpers ─── */

// Valeur des filtres produit/secteur pour les deals sans ligne produit ou sans
// secteur déterminé — doit rester identique à backend/routes/analytics.js.
const UNASSIGNED = '__unassigned__';

const STAGE_COLORS = {
  new: 'var(--text-muted)',
  interested: 'var(--blue)',
  meeting: 'var(--success)',
  negotiation: 'var(--warning)',
  won: 'var(--purple)',
  lost: 'var(--danger)',
};

/* ─── Vocabulary mapping (sales vs membership orgs) ─── */

function getVocabulary(mode, en) {
  if (mode === 'membership') {
    return {
      deal: en ? 'Membership' : 'Adhésion',
      won: en ? 'Renewed' : 'Renouvelé',
      lost: en ? 'Lapsed' : 'Expiré',
      pipeline: en ? 'Member Lifecycle' : 'Cycle de vie membre',
      new: en ? 'New member' : 'Nouveau membre',
      interested: en ? 'Engaged' : 'Engagé',
      meeting: en ? 'Active' : 'Actif',
      negotiation: en ? 'At risk' : 'À risque',
    };
  }
  return {
    deal: en ? 'Deal' : 'Deal',
    won: en ? 'Won' : 'Gagné',
    lost: en ? 'Lost' : 'Perdu',
    pipeline: 'Pipeline',
    new: en ? 'New' : 'Nouveau',
    interested: en ? 'Interested' : 'Intéressé',
    meeting: en ? 'Meeting' : 'RDV',
    negotiation: en ? 'Negotiation' : 'Négo',
  };
}

function getStatusLabels(vocab) {
  return {
    new: vocab.new,
    interested: vocab.interested,
    meeting: vocab.meeting,
    negotiation: vocab.negotiation,
    won: vocab.won,
    lost: vocab.lost,
  };
}

const CHANNEL_COLORS = {
  email: 'var(--blue)',
  linkedin: 'var(--purple)',
  multi: 'var(--orange)',
};

function HelpTip({ text }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 5, verticalAlign: 'middle', flexShrink: 0 }} className="helptip-wrap">
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: '50%',
          fontSize: 10, fontWeight: 700, cursor: 'help',
          background: 'var(--border)', color: 'var(--text-muted)',
        }}
      >?</span>
      <span className="helptip-bubble">{text}</span>
      <style>{`
        .helptip-wrap .helptip-bubble {
          visibility: hidden; opacity: 0;
          position: absolute; bottom: calc(100% + 8px); left: 50%;
          transform: translateX(-50%); width: 260px;
          padding: 10px 12px; border-radius: 8px;
          background: var(--bg-primary, #fff); color: var(--text-primary, #0a0a0a);
          font-size: 12px; font-weight: 400; line-height: 1.5;
          box-shadow: 0 4px 16px rgba(0,0,0,.12); border: 1px solid var(--border, #e5e5e5);
          pointer-events: none; transition: opacity .15s; z-index: 999;
          white-space: normal; text-align: left;
        }
        .helptip-wrap:hover .helptip-bubble { visibility: visible; opacity: 1; }
      `}</style>
    </span>
  );
}

/* ─── Sections ─── */

function getTabs(t, vocab) { return [
  { key: 'pipeline', label: vocab?.pipeline || 'Pipeline', desc: t('analytics.tabDescPipeline') },
  { key: 'attribution', label: 'Attribution', desc: t('analytics.tabDescAttribution') },
  { key: 'forecast', label: 'Forecast', desc: t('analytics.tabDescForecast') },
  { key: 'lostReasons', label: t('analytics.lostReasonsTab'), desc: t('analytics.tabDescLostReasons') },
  { key: 'membership', label: t('analytics.membershipTab'), desc: t('analytics.tabDescMembership') },
  { key: 'geography', label: t('analytics.geoTab'), desc: t('analytics.tabDescGeo') },
  { key: 'trends', label: t('analytics.trends'), desc: t('analytics.tabDescTrends') },
  { key: 'channels', label: t('analytics.channels'), desc: t('analytics.tabDescChannels') },
]; }

// Groups (top-level nav) — each maps to the sub-tabs it contains
const GROUPS = [
  { key: 'deals', labelKey: 'analytics.groupDeals', tabs: ['pipeline', 'attribution', 'forecast', 'lostReasons'] },
  { key: 'clients', labelKey: 'analytics.groupClients', tabs: ['membership', 'geography'] },
  { key: 'activation', labelKey: 'analytics.groupActivation', tabs: ['trends'] },
  { key: 'prospection', labelKey: 'analytics.groupProspection', tabs: ['channels'] },
];

/* ═══ Main Component ═══ */

export default function CRMAnalyticsPage() {
  const navigate = useNavigate();
  const { backendAvailable, opportunities } = useApp();
  const { socket } = useSocket();
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';

  // Detect vocabulary mode: membership orgs vs sales teams
  const mode = useMemo(() => {
    const opps = Object.values(opportunities || {});
    if (opps.length === 0) return 'sales'; // default to sales when no data
    const hasDeals = opps.some(o => o.deal_value > 0 || o.status === 'won' || o.status === 'lost');
    return hasDeals ? 'sales' : 'membership';
  }, [opportunities]);
  const vocab = useMemo(() => getVocabulary(mode, en), [mode, en]);
  const STATUS_LABELS = useMemo(() => getStatusLabels(vocab), [vocab]);

  const [activeGroup, setActiveGroup] = useState('deals');
  const [activeTab, setActiveTab] = useState('pipeline');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const TABS = getTabs(t, vocab);
  const groupTabKeys = GROUPS.find(g => g.key === activeGroup)?.tabs || [];
  const fetchedRef = useRef(new Set());

  // Changer de groupe réinitialise l'onglet actif sur le premier de ce groupe
  useEffect(() => {
    setActiveTab(prev => (groupTabKeys.includes(prev) ? prev : groupTabKeys[0]));
  }, [activeGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtres transverses produit / secteur — propagés en query string aux
  // routes analytics de Deals/Clients (le backend filtre les opportunités
  // avant agrégation)
  const [filters, setFilters] = useState({ productLine: '', sector: '' });
  const [productLines, setProductLines] = useState([]);
  const [sectors, setSectors] = useState([]);
  const filterQs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.productLine) p.set('productLine', filters.productLine);
    if (filters.sector) p.set('sector', filters.sector);
    const s = p.toString();
    return s ? '?' + s : '';
  }, [filters]);

  const fetchData = useCallback(async (tab, force) => {
    if (!backendAvailable) {
      setData({});
      return;
    }
    // La clé de cache inclut le périmètre : changer de filtre force le refetch
    const cacheKey = tab + filterQs;
    if (!force && fetchedRef.current.has(cacheKey)) return;
    fetchedRef.current.add(cacheKey);
    setLoading(true);
    try {
      const result = await api.request('/analytics/' + tab + filterQs);
      setData(prev => ({ ...prev, [tab]: result }));
    } catch {
      setData(prev => ({ ...prev, [tab]: null }));
    }
    setLoading(false);
  }, [backendAvailable, filterQs]);

  // Options des filtres (une fois)
  useEffect(() => {
    if (!backendAvailable) return;
    api.request('/analytics/product-lines').then(d => setProductLines(d.productLines || [])).catch(() => {});
    api.request('/analytics/sectors').then(d => setSectors(d.sectors || [])).catch(() => {});
  }, [backendAvailable]);

  // Changer de périmètre invalide les données affichées (dont les KPIs pipeline)
  const prevQsRef = useRef(filterQs);
  useEffect(() => {
    if (prevQsRef.current === filterQs) return;
    prevQsRef.current = filterQs;
    setData({});
  }, [filterQs]);

  useEffect(() => {
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  // Résumé "Deals en cours" affiché entre les groupes et les sous-onglets —
  // fetch indépendant du cache activeTab/loading, pour rester visible quel
  // que soit le sous-onglet consulté (Attribution, Forecast, Raisons de perte…).
  const [dealsSummary, setDealsSummary] = useState(null);
  useEffect(() => {
    if (!backendAvailable || activeGroup !== 'deals') return;
    let cancelled = false;
    api.request('/analytics/pipeline' + filterQs).then(d => { if (!cancelled) setDealsSummary(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [backendAvailable, activeGroup, filterQs]);

  // Auto-refresh after CRM sync completes
  useEffect(() => {
    if (!socket) return;
    const onCrmSync = (ev) => {
      if (ev.status === 'done') {
        fetchedRef.current.clear();
        fetchData(activeTab, true);
      }
    };
    socket.on('crm:sync', onCrmSync);
    return () => socket.off('crm:sync', onCrmSync);
  }, [socket, activeTab, fetchData]);

  const tabData = data[activeTab];
  const contactCount = Object.keys(opportunities || {}).length;
  const hasData = contactCount > 0;

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.analytics')}</h1>
          <div className="page-subtitle">{t('analytics.subtitle')}</div>
        </div>
      </div>

      {/* Groupes (Deals / Clients / Activation / Prospection) */}
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3,
        background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 10,
        marginBottom: 20,
      }}>
        {GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => setActiveGroup(g.key)}
            style={{
              padding: '7px 18px', border: 'none', borderRadius: 8,
              background: activeGroup === g.key ? 'var(--bg-card, white)' : 'transparent',
              color: activeGroup === g.key ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeGroup === g.key ? 600 : 400,
              fontSize: 13, cursor: 'pointer',
              boxShadow: activeGroup === g.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {t(g.labelKey)}
          </button>
        ))}
      </div>

      {/* Résumé Deals — visible quel que soit le sous-onglet actif */}
      {activeGroup === 'deals' && dealsSummary && (
        <DealsGroupSummary data={dealsSummary} statusLabels={STATUS_LABELS} />
      )}

      {/* Tab bar — sous-onglets du groupe actif */}
      {groupTabKeys.length > 1 && (
        <div className="crm-tabs">
          {TABS.filter(tab => groupTabKeys.includes(tab.key)).map(tab => (
            <button
              key={tab.key}
              className={`crm-tab${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Active tab description */}
      {(() => {
        const active = TABS.find(t => t.key === activeTab);
        return active?.desc ? (
          <div style={{
            fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 16px',
            lineHeight: 1.4,
          }}>
            {active.desc}
          </div>
        ) : null;
      })()}

      {/* Filtres produit / secteur — uniquement pour Deals / Clients, sous leurs onglets */}
      {(activeGroup === 'deals' || activeGroup === 'clients') && backendAvailable && hasData && (productLines.length > 1 || sectors.length > 1) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{t('analytics.filterLabel')}</span>
          {productLines.length > 1 && (
            <select
              value={filters.productLine}
              onChange={e => setFilters(f => ({ ...f, productLine: e.target.value }))}
              style={{
                fontSize: 13, padding: '6px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
              }}
            >
              <option value="">{t('analytics.filterAllProducts')}</option>
              {productLines.filter(pl => pl.id !== UNASSIGNED).map(pl => (
                <option key={pl.id} value={pl.id}>{pl.icon ? pl.icon + ' ' : ''}{pl.name} ({pl.count})</option>
              ))}
              {productLines.filter(pl => pl.id === UNASSIGNED).map(pl => (
                <option key="unassigned" value={UNASSIGNED}>{t('analytics.filterUnassigned')} ({pl.count})</option>
              ))}
            </select>
          )}
          {sectors.length > 1 && (
            <select
              value={filters.sector}
              onChange={e => setFilters(f => ({ ...f, sector: e.target.value }))}
              style={{
                fontSize: 13, padding: '6px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
              }}
            >
              <option value="">{t('analytics.filterAllSectors')}</option>
              {sectors.filter(s => s.sector !== UNASSIGNED).map(s => (
                <option key={s.sector} value={s.sector}>{s.sector} ({s.count})</option>
              ))}
              {sectors.filter(s => s.sector === UNASSIGNED).map(s => (
                <option key="unassigned" value={UNASSIGNED}>{t('analytics.filterUnassigned')} ({s.count})</option>
              ))}
            </select>
          )}
          {(filters.productLine || filters.sector) && (
            <button
              onClick={() => setFilters({ productLine: '', sector: '' })}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
              }}
            >
              ✕ {t('analytics.filterClear')}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading && <LoadingTips />}

      {/* Empty state — no data */}
      {!loading && !tabData && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>{hasData ? '—' : '—'}</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
            {hasData
              ? (en ? 'No data for this view yet' : 'Pas encore de données pour cette vue')
              : (en ? 'Connect your CRM to get started' : 'Connectez votre CRM pour commencer')}
          </div>
          <div style={{ fontSize: 13, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            {hasData
              ? (en ? `Data will appear here once your contacts and ${vocab.deal.toLowerCase()}s have enough activity.` : `Les données apparaîtront ici quand vos contacts et ${vocab.deal.toLowerCase()}s auront assez d'activité.`)
              : (en ? 'Go to Settings, connect your CRM (Salesforce, HubSpot, Pipedrive...) and sync your data.' : 'Allez dans Paramètres, connectez votre CRM (Salesforce, HubSpot, Pipedrive...) et synchronisez vos données.')}
          </div>
          {!hasData && (
            <button
              className="btn btn-primary"
              style={{ marginTop: 16, fontSize: 13, padding: '8px 20px' }}
              onClick={() => navigate('/settings')}
            >
              {en ? 'Go to Settings' : 'Aller aux Paramètres'}
            </button>
          )}
        </div>
      )}

      {/* Les tendances, canaux et la vue d'ensemble clients viennent des campagnes /
          de toutes les opportunités, pas du périmètre filtré — les filtres produit/secteur
          ne s'y appliquent pas : on le dit plutôt que de laisser croire que les chiffres
          sont filtrés. */}
      {!loading && tabData && (filters.productLine || filters.sector) && (activeTab === 'trends' || activeTab === 'channels' || activeTab === 'membership') && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 12 }}>
          <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {t('analytics.filterNotApplied')}
        </div>
      )}

      {/* CSV Export button (pas de route CSV pour géographie / vue d'ensemble clients / raisons de perte) */}
      {!loading && tabData && activeTab !== 'geography' && activeTab !== 'membership' && activeTab !== 'lostReasons' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '6px 14px', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            onClick={() => api.downloadAnalyticsCSV(activeTab)}
          >
            CSV
          </button>
        </div>
      )}

      {!loading && activeTab === 'pipeline' && tabData && (
        <>
          <PipelineSection data={tabData} statusLabels={STATUS_LABELS} vocab={vocab} en={en} />
          <StagesBlock filterQs={filterQs} />
        </>
      )}
      {!loading && activeTab === 'attribution' && tabData && <AttributionSection data={tabData} />}
      {!loading && activeTab === 'trends' && tabData && <TrendsSection data={tabData} />}
      {!loading && activeTab === 'channels' && tabData && <ChannelsSection data={tabData} />}
      {!loading && activeTab === 'forecast' && tabData && <ForecastSection data={tabData} statusLabels={STATUS_LABELS} vocab={vocab} />}
      {!loading && activeTab === 'geography' && tabData && <GeographySection data={tabData} />}
      {!loading && activeTab === 'membership' && tabData && <MembershipSection data={tabData} en={en} />}
      {!loading && activeTab === 'lostReasons' && tabData && (
        <LostReasonsSection data={tabData} en={en} onTagged={() => fetchData('lostReasons', true)} />
      )}
    </div>
  );
}

/* ═══ Pipeline Section ═══ */

function FlowChart({ flow, en }) {
  const max = Math.max(1, ...flow.flatMap(f => [f.created, f.won, f.lost]));
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--purple)', marginRight: 5 }} />{en ? 'Created' : 'Créés'}</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--success)', marginRight: 5 }} />{en ? 'Won' : 'Gagnés'}</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--danger)', marginRight: 5 }} />{en ? 'Lost' : 'Perdus'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 4 }}>
        {flow.map(f => (
          <div key={f.period} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 40, flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 90 }}>
              <div title={`${f.period}: ${f.created}`} style={{ width: 8, height: Math.max((f.created / max) * 90, f.created > 0 ? 3 : 0), background: 'var(--purple)', borderRadius: 2 }} />
              <div title={`${f.period}: ${f.won}`} style={{ width: 8, height: Math.max((f.won / max) * 90, f.won > 0 ? 3 : 0), background: 'var(--success)', borderRadius: 2 }} />
              <div title={`${f.period}: ${f.lost}`} style={{ width: 8, height: Math.max((f.lost / max) * 90, f.lost > 0 ? 3 : 0), background: 'var(--danger)', borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{f.period.slice(5)}</div>
            <div style={{ fontSize: 9, fontWeight: 700, color: f.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {f.net >= 0 ? '+' : ''}{f.net}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohortTable({ cohorts, en }) {
  const rows = cohorts.filter(c => c.created > 0);
  if (rows.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'No data yet' : 'Pas de données'}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '6px 8px', fontWeight: 600 }}>{en ? 'Cohort' : 'Cohorte'}</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{en ? 'Created' : 'Créés'}</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', color: 'var(--success)' }}>{en ? 'Won' : 'Gagnés'}</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', color: 'var(--danger)' }}>{en ? 'Lost' : 'Perdus'}</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{en ? 'Still open' : 'Encore ouverts'}</th>
            <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>{en ? 'Win rate' : 'Taux de conversion'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.period} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.period}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{c.created}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--success)' }}>{c.won}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--danger)' }}>{c.lost}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{c.open}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{c.winRate != null ? `${c.winRate}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealSizeBlock({ dealSize, en }) {
  const rows = dealSize.distribution.map(d => ({ stage: d.label, count: d.count }));
  return (
    <>
      <StageBars rows={rows} color="var(--blue)" />
      {dealSize.totalOpenValue > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
          {en
            ? `Your top 5 open deals represent ${dealSize.top5Pct}% of open pipeline value (${dealSize.top5Value.toLocaleString()}€ of ${dealSize.totalOpenValue.toLocaleString()}€).`
            : `Vos 5 plus gros deals ouverts représentent ${dealSize.top5Pct}% de la valeur du pipeline ouvert (${dealSize.top5Value.toLocaleString()}€ sur ${dealSize.totalOpenValue.toLocaleString()}€).`}
        </div>
      )}
    </>
  );
}

// Résumé persistant du groupe Deals — entre la barre de groupes et les
// sous-onglets, visible quel que soit le sous-onglet actif (pas seulement Pipeline).
function DealsGroupSummary({ data, statusLabels }) {
  const t = useT();
  const STATUS_LABELS = statusLabels;
  const pipelineStages = (data.stages || []).filter(s => ['new', 'interested', 'meeting', 'negotiation'].includes(s.stage));
  // data.total compte TOUT le tenant (won/lost inclus) — le total affiché ici doit
  // correspondre à la somme des étapes ouvertes juste en dessous, pas au tenant entier.
  const totalOpen = pipelineStages.reduce((sum, s) => sum + s.count, 0);
  const outcomes30d = data.outcomes30d || { won: 0, lost: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
      {/* Zone 1 : pipeline en cours (total + étapes ouvertes) */}
      <div style={{ background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="crm-kpi-card" style={{ minWidth: 240 }}>
            <div className="crm-kpi-value">{totalOpen}</div>
            <div className="crm-kpi-label">{t('analytics.totalOpenDeals')}</div>
          </div>
        </div>
        <div className="crm-kpi-row-4" style={{ marginTop: 16 }}>
          {pipelineStages.map(s => (
            <div className="crm-kpi-card" key={s.stage}>
              <div className="crm-kpi-value" style={{ color: STAGE_COLORS[s.stage] }}>{s.count}</div>
              <div className="crm-kpi-label">{STATUS_LABELS[s.stage] || s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone 2 : issues sur les 30 derniers jours */}
      <div style={{ background: 'var(--bg-elevated, var(--paper-2))', borderRadius: 14, padding: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', margin: '0 0 16px', textAlign: 'center' }}>
          {t('analytics.outcomes30dTitle')}
        </h3>
        <div className="crm-kpi-row-4 crm-kpi-outcome-row">
          <div className="crm-kpi-card" key="won">
            <div className="crm-kpi-value" style={{ color: STAGE_COLORS.won }}>{outcomes30d.won}</div>
            <div className="crm-kpi-label">{STATUS_LABELS.won}</div>
          </div>
          <div className="crm-kpi-card" key="lost">
            <div className="crm-kpi-value" style={{ color: STAGE_COLORS.lost }}>{outcomes30d.lost}</div>
            <div className="crm-kpi-label">{STATUS_LABELS.lost}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineSection({ data, statusLabels, vocab, en }) {
  const t = useT();
  const STATUS_LABELS = statusLabels;
  const funnelStages = (data.stages || [])
    .filter(s => s.stage !== 'lost')
    .map(s => ({ label: STATUS_LABELS[s.stage] || s.label, value: s.count }));

  return (
    <div className="crm-section">
      <div className="crm-grid-2">
        {/* Visual funnel */}
        <div className="card">
          <div className="card-title">{t('analytics.pipelineFunnel')}</div>
          <div className="card-body">
            <FunnelChart stages={funnelStages} />
          </div>
        </div>

        {/* Conversion rates */}
        <div className="card">
          <div className="card-title">{t('analytics.conversionRates')}</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(data.conversions || []).map((c, i) => (
                <div key={i} className="crm-conversion-row">
                  <div className="crm-conversion-labels">
                    <span style={{ color: STAGE_COLORS[c.from] }}>{STATUS_LABELS[c.from]}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>→</span>
                    <span style={{ color: STAGE_COLORS[c.to] }}>{STATUS_LABELS[c.to]}</span>
                  </div>
                  <div className="crm-conversion-bar-track">
                    <div className="crm-conversion-bar-fill" style={{ width: `${c.rate}%`, background: STAGE_COLORS[c.to] }} />
                  </div>
                  <div className="crm-conversion-rate">{c.rate}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Flux mensuel : créés / gagnés / perdus, 12 derniers mois */}
      {data.flow && (
        <div className="card">
          <div className="card-title">
            {t('analytics.flowTitle')}
            <HelpTip text={t('analytics.flowHelp')} />
          </div>
          <div className="card-body">
            <FlowChart flow={data.flow} en={en} />
          </div>
        </div>
      )}

      {/* Cohortes de création */}
      {data.cohorts && (
        <div className="card">
          <div className="card-title">
            {t('analytics.cohortsTitle')}
            <HelpTip text={t('analytics.cohortsHelp')} />
          </div>
          <div className="card-body">
            <CohortTable cohorts={data.cohorts} en={en} />
          </div>
        </div>
      )}

      {/* Taille des deals ouverts */}
      {data.dealSize && (
        <div className="card">
          <div className="card-title">{t('analytics.dealSizeTitle')}</div>
          <div className="card-body">
            <DealSizeBlock dealSize={data.dealSize} en={en} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Attribution Section ═══ */

function DealTouchBlock({ dt }) {
  const t = useT();
  const navigate = useNavigate();
  if (!dt) return null;

  const empty = dt.touched.count === 0;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        {t('analytics.dealTouchTitle')}
        <HelpTip text={t('analytics.dealTouchHelp')} />
      </div>
      <div className="card-body">
        {empty ? (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('analytics.dealTouchEmptyTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('analytics.dealTouchEmptyBody', { count: dt.untouched.count })}
            </div>
            <button className="btn btn-accent" onClick={() => navigate('/activation')}>
              {t('analytics.dealTouchEmptyCta')}
            </button>
          </div>
        ) : (
          <>
            <div className="crm-kpi-row">
              <div className="crm-kpi-card">
                <div className="crm-kpi-value">{dt.touched.count}</div>
                <div className="crm-kpi-label">{t('analytics.dealTouchTouched')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(dt.touched.value || 0).toLocaleString()}€</div>
              </div>
              <div className="crm-kpi-card">
                <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>{dt.touched.replyRate}%</div>
                <div className="crm-kpi-label">{t('analytics.dealTouchReplyRate')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('analytics.dealTouchReplied', { count: dt.touched.replied })}
                </div>
              </div>
              <div className="crm-kpi-card">
                <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{dt.reactivated.count}</div>
                <div className="crm-kpi-label">{t('analytics.dealTouchReactivated')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(dt.reactivated.value || 0).toLocaleString()}€</div>
              </div>
              <div className="crm-kpi-card">
                <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>{dt.touched.won}</div>
                <div className="crm-kpi-label">{t('analytics.dealTouchWon')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t('analytics.dealTouchWonVs', { count: dt.untouched.won })}
                </div>
              </div>
            </div>
            <div className="crm-table" style={{ marginTop: 12 }}>
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>{t('analytics.dealTouchDeal')}</span>
                <span>{t('analytics.dealTouchEmails')}</span>
                <span>{t('analytics.dealTouchLastTouch')}</span>
                <span>{t('analytics.dealTouchOutcome')}</span>
              </div>
              {dt.deals.map((d, i) => (
                <div className="crm-table-row" key={i}>
                  <span style={{ flex: 2, fontWeight: 600 }}>
                    {d.name}{d.company ? ` · ${d.company}` : ''}
                    {d.dealValue > 0 && (
                      <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> — ${d.dealValue.toLocaleString()}</span>
                    )}
                  </span>
                  <span>{d.emailsSent}</span>
                  <span>{d.lastTouchAt ? new Date(d.lastTouchAt).toLocaleDateString() : '—'}</span>
                  <span style={{ fontWeight: 600, color: d.reactivatedAt ? 'var(--success)' : d.replied ? 'var(--blue)' : 'var(--text-muted)' }}>
                    {d.reactivatedAt ? t('analytics.dealTouchOutcomeReactivated')
                      : d.replied ? t('analytics.dealTouchOutcomeReplied')
                      : t('analytics.dealTouchOutcomePending')}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AttributionSection({ data }) {
  const t = useT();
  const sorted = useMemo(() =>
    [...(data.campaigns || [])].sort((a, b) => b.conversionRate - a.conversionRate),
    [data.campaigns]
  );

  return (
    <div className="crm-section">
      {/* Deals touchés par l'agent — la preuve ROI côté CRM */}
      <DealTouchBlock dt={data.dealTouch} />

      {/* Totals */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.totals?.prospects || 0}</div>
          <div className="crm-kpi-label">{t('analytics.totalProspects')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{data.totals?.meetings || 0}</div>
          <div className="crm-kpi-label">{t('analytics.meetingsBooked')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>{data.totals?.interested || 0}</div>
          <div className="crm-kpi-label">{t('analytics.interested')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>{data.totals?.avgConversion || 0}%</div>
          <div className="crm-kpi-label">{t('analytics.avgConversion')}</div>
        </div>
      </div>

      {/* Campaign table */}
      <div className="card">
        <div className="card-title">{t('analytics.roiByCampaign')}</div>
        <div className="card-body">
          <div className="crm-table">
            <div className="crm-table-header">
              <span style={{ flex: 2 }}>{t('analytics.campaign')}</span>
              <span>{t('analytics.channel')}</span>
              <span>Prospects</span>
              <span>{t('analytics.interested')}</span>
              <span>{t('analytics.meetings')}</span>
              <span>Conversion</span>
            </div>
            {sorted.map(c => (
              <div className="crm-table-row" key={c.id}>
                <span style={{ flex: 2, fontWeight: 600 }}>{c.name}</span>
                <span>
                  <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[c.channel] || 'var(--text-muted)' }}>
                    {c.channel}
                  </span>
                </span>
                <span>{c.prospects}</span>
                <span>{c.interested}</span>
                <span style={{ fontWeight: 600, color: 'var(--success)' }}>{c.meetings}</span>
                <span>
                  <span style={{
                    fontWeight: 700,
                    color: c.conversionRate >= 3 ? 'var(--success)' : c.conversionRate >= 2 ? 'var(--warning)' : 'var(--danger)',
                  }}>{c.conversionRate}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Trends Section ═══ */

function TrendsSection({ data: initialData }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [trendData, setTrendData] = useState(initialData);
  const defaultFrom = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    if (fromDate === defaultFrom && toDate === defaultTo) {
      setTrendData(initialData);
      return;
    }
    let cancelled = false;
    api.request(`/analytics/trends?from=${fromDate}&to=${toDate}`).then(result => {
      if (!cancelled) setTrendData(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [fromDate, toDate, defaultFrom, defaultTo, initialData]);

  const chartData = useMemo(() => {
    if (trendData?.weeks && trendData.weeks.length > 0) {
      return trendData.weeks.map(w => ({
        label: w.label,
        open: w.openRate ?? w.open ?? 0,
        reply: w.replyRate ?? w.reply ?? 0,
        linkedin: w.linkedin ?? 0,
      }));
    }
    return [];
  }, [trendData?.weeks]);

  return (
    <div className="crm-section">
      <div className="card">
        <div className="card-title">{t('analytics.weeklyTrends')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', padding: '0 16px' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'From' : 'De'}</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'To' : '\u00C0'}</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
        </div>
        <div className="card-body">
          {chartData.length > 0 ? (
            <EngagementChart data={chartData} />
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              {t('analytics.noTrendsData')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Channels Section ═══ */

function ChannelsSection({ data }) {
  const t = useT();
  const channels = data.channels || [];
  const best = data.bestChannel;

  return (
    <div className="crm-section">
      {/* Best channel highlight */}
      {best && (
        <div className="crm-highlight-card" style={{ borderColor: CHANNEL_COLORS[best.channel] }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('analytics.bestChannel')}:</span>
          <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[best.channel], marginLeft: 8 }}>
            {best.channel}
          </span>
          <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
            {best.value}% {t('analytics.replyRate')}
          </span>
        </div>
      )}

      <div className="crm-grid-3">
        {channels.map(ch => (
          <div className="card" key={ch.channel}>
            <div className="card-header">
              <span className="crm-channel-badge" style={{ background: CHANNEL_COLORS[ch.channel] || 'var(--text-muted)' }}>
                {ch.channel}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ch.campaigns} {t('analytics.campaigns')}</span>
            </div>
            <div className="card-body">
              <div className="crm-channel-stats">
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value">{ch.totalProspects}</div>
                  <div className="crm-channel-stat-label">Prospects</div>
                </div>
                {ch.avgOpenRate != null && (
                  <div className="crm-channel-stat">
                    <div className="crm-channel-stat-value">{ch.avgOpenRate}%</div>
                    <div className="crm-channel-stat-label">{t('analytics.openRate')}</div>
                  </div>
                )}
                {ch.avgAcceptRate != null && (
                  <div className="crm-channel-stat">
                    <div className="crm-channel-stat-value">{ch.avgAcceptRate}%</div>
                    <div className="crm-channel-stat-label">{t('analytics.acceptRate')}</div>
                  </div>
                )}
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value">{ch.avgReplyRate}%</div>
                  <div className="crm-channel-stat-label">{t('analytics.replyRate')}</div>
                </div>
                <div className="crm-channel-stat">
                  <div className="crm-channel-stat-value" style={{ color: 'var(--success)' }}>{ch.meetings}</div>
                  <div className="crm-channel-stat-label">RDV</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Intelligent Forecast (memory-calibrated) ═══ */

const MF_GROUPS = [
  { key: 'commit', color: 'var(--success)' },
  { key: 'probable', color: 'var(--warning)' },
  { key: 'possible', color: 'var(--text-muted)' },
];

function MemoryForecastBlock({ mf }) {
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const fmtEur = useMemo(
    () => new Intl.NumberFormat(en ? 'en-US' : 'fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
    [en]
  );

  const deals = Array.isArray(mf?.deals) ? mf.deals : [];
  const grouped = useMemo(() => {
    const g = { commit: [], probable: [], possible: [] };
    deals.forEach(d => { (g[d.category] || g.possible).push(d); });
    return g;
  }, [deals]);

  if (!mf || deals.length === 0) return null;

  const scenarios = mf.scenarios || {};
  const counts = mf.counts || {};
  const ctx = mf.context || {};
  const calibration = typeof ctx.calibration === 'number' ? ctx.calibration : 1;
  const calibrationPct = Math.round(Math.abs(1 - calibration) * 100);

  const groupLabels = {
    commit: t('analytics.mfGroupCommit'),
    probable: t('analytics.mfGroupProbable'),
    possible: t('analytics.mfGroupPossible'),
  };

  const tiles = [
    { key: 'commit', label: t('analytics.mfScenarioCommit'), sub: t('analytics.mfScenarioCommitSub', { count: counts.commit || 0 }), value: scenarios.commit || 0, featured: false },
    { key: 'weighted', label: t('analytics.mfScenarioWeighted'), sub: t('analytics.mfScenarioWeightedSub'), value: scenarios.weighted || 0, featured: true },
    { key: 'optimistic', label: t('analytics.mfScenarioOptimistic'), sub: t('analytics.mfScenarioOptimisticSub'), value: scenarios.optimistic || 0, featured: false },
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>{t('analytics.mfTitle')}</div>

      {/* Scenario tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {tiles.map(tile => (
          <div key={tile.key} className="card" style={{
            padding: 16,
            border: tile.featured ? '1.5px solid var(--accent)' : undefined,
            background: tile.featured ? 'var(--accent-glow)' : undefined,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: tile.featured ? 'var(--accent)' : 'var(--text-muted)' }}>
              {tile.label}
            </div>
            <div style={{ fontSize: tile.featured ? 26 : 21, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums', color: tile.featured ? 'var(--accent)' : 'var(--text-primary)' }}>
              {fmtEur.format(tile.value)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* Honest context line */}
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {ctx.reliable ? (
          <span>
            {t('analytics.mfContextReliable', { days: ctx.avgCycleDays != null ? ctx.avgCycleDays : '—', winRate: Math.round((ctx.winRate || 0) * 100) })}
            {calibrationPct > 0 && (
              <> {calibration < 1 ? t('analytics.mfCalibrationOver', { pct: calibrationPct }) : t('analytics.mfCalibrationUnder', { pct: calibrationPct })}</>
            )}
          </span>
        ) : (
          <span style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            {t('analytics.mfContextUnreliable', { count: ctx.wonSample || 0 })}
            {calibrationPct > 0 && (
              <> {calibration < 1 ? t('analytics.mfCalibrationOver', { pct: calibrationPct }) : t('analytics.mfCalibrationUnder', { pct: calibrationPct })}</>
            )}
          </span>
        )}
      </div>

      {/* Commit / Probable / Possible breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        {MF_GROUPS.map(g => {
          const list = grouped[g.key] || [];
          if (list.length === 0) return null;
          const shown = list.slice(0, 8);
          const extra = list.length - shown.length;
          return (
            <div key={g.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{groupLabels[g.key]}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({list.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {shown.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                      {d.company ? <span style={{ color: 'var(--text-muted)' }}>{' — '}{d.company}</span> : null}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, flexShrink: 0 }}>{fmtEur.format(d.value || 0)}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, color: 'var(--text-on-color)', background: g.color, flexShrink: 0 }}>
                      {t('analytics.mfProbBadge', { pct: Math.round((d.probability || 0) * 100) })}
                    </span>
                  </div>
                ))}
                {extra > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('analytics.mfMoreDeals', { count: extra })}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══ Forecast Section ═══ */

function ForecastSection({ data: initialData, statusLabels, vocab }) {
  const STATUS_LABELS = statusLabels;
  const { t, lang } = useI18n();
  const en = lang === 'en';
  const [forecastData, setForecastData] = useState(initialData);
  const defaultFrom = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultTo = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    if (fromDate === defaultFrom && toDate === defaultTo) {
      setForecastData(initialData);
      return;
    }
    let cancelled = false;
    api.request(`/analytics/forecast?from=${fromDate}&to=${toDate}`).then(result => {
      if (!cancelled) setForecastData(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [fromDate, toDate, defaultFrom, defaultTo, initialData]);

  const data = forecastData;
  const pipeline = data.pipeline || {};
  const retention = data.retention || {};
  const cycle = data.salesCycle || {};

  return (
    <div className="crm-section">
      {/* Date range picker */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'From' : 'De'}</label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{en ? 'To' : '\u00C0'}</label>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          className="form-input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} />
      </div>

      {/* Intelligent forecast (memory-calibrated) — renders nothing when memoryForecast is null/empty */}
      <MemoryForecastBlock mf={data.memoryForecast} />

      {/* KPI row */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--blue)' }}>{(pipeline.totalValue || 0).toLocaleString()}€</div>
          <div className="crm-kpi-label">{en ? `Total ${vocab.pipeline}` : `${vocab.pipeline} total`}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--purple)' }}>{(pipeline.weightedForecast || 0).toLocaleString()}€</div>
          <div className="crm-kpi-label">{t('analytics.weightedForecast')}<HelpTip text={t('analytics.helpForecast')} /></div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{cycle.avgDays || '—'}</div>
          <div className="crm-kpi-label">{t('analytics.avgSalesCycle')}<HelpTip text={t('analytics.helpSalesCycle')} /></div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--success)' }}>{(retention.totalWonRevenue || 0).toLocaleString()}€</div>
          <div className="crm-kpi-label">{en ? `${vocab.won} Revenue` : `Revenu ${vocab.won.toLowerCase()}`}</div>
        </div>
      </div>

      <div className="crm-grid-2">
        {/* Pipeline by stage */}
        <div className="card">
          <div className="card-title">{en ? `${vocab.pipeline} by Stage (Weighted)` : `${vocab.pipeline} par étape (pondéré)`}</div>
          <div className="card-body">
            <div className="crm-table">
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>{en ? 'Stage' : 'Étape'}</span>
                <span>{`${vocab.deal}s`}</span>
                <span>{en ? 'Value' : 'Valeur'}</span>
                <span>{en ? 'Win %' : 'Taux gain'}</span>
                <span>{en ? 'Weighted' : 'Pondéré'}</span>
              </div>
              {(pipeline.byStage || []).map(s => (
                <div className="crm-table-row" key={s.stage}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{STATUS_LABELS[s.stage] || s.label}</span>
                  <span>{s.deals}</span>
                  <span>{s.totalValue.toLocaleString()}€</span>
                  <span style={{ color: s.probability >= 50 ? 'var(--success)' : 'var(--warning)' }}>{s.probability}%</span>
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>{s.weightedValue.toLocaleString()}€</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Retention / churn risk */}
        <div className="card">
          <div className="card-title">{en ? 'Revenue Retention' : 'Rétention du revenu'}</div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>{en ? 'Safe Revenue' : 'Revenu sécurisé'}</span>
                <span style={{ fontWeight: 700, color: 'var(--success)' }}>{(retention.safeRevenue || 0).toLocaleString()}€</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>{en ? 'At-Risk Revenue (churn 50+)' : 'Revenu à risque (churn 50+)'}</span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{(retention.atRiskRevenue || 0).toLocaleString()}€</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13 }}>{en ? 'At-Risk Clients' : 'Clients à risque'}</span>
                <span style={{ fontWeight: 700, color: 'var(--warning)' }}>{retention.atRiskCount || 0}</span>
              </div>
              {retention.totalWonRevenue > 0 && (
                <div style={{ height: 8, borderRadius: 4, background: 'var(--danger)', overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${Math.round(((retention.safeRevenue || 0) / retention.totalWonRevenue) * 100)}%`, background: 'var(--success)', borderRadius: 4 }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Revenue History */}
      {(data.revenueHistory || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">{en ? `Monthly ${vocab.won} Revenue` : `Revenu ${vocab.won.toLowerCase()} mensuel`}</div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
              {data.revenueHistory.map((m, i) => {
                const max = Math.max(...data.revenueHistory.map(r => r.revenue));
                const pct = max > 0 ? (m.revenue / max) * 100 : 0;
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--success)' }}>{(m.revenue / 1000).toFixed(0)}k€</div>
                    <div style={{ width: '100%', height: `${Math.max(pct, 4)}%`, background: 'var(--purple)', borderRadius: 4 }} />
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{m.month.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Projected deals */}
      {(data.projectedDeals || []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">{en ? `Top Projected ${vocab.deal}s` : `Top ${vocab.deal}s projetés`}</div>
          <div className="card-body">
            <div className="crm-table">
              <div className="crm-table-header">
                <span style={{ flex: 2 }}>{en ? 'Name' : 'Nom'}</span>
                <span>{en ? 'Company' : 'Entreprise'}</span>
                <span>{en ? 'Stage' : 'Étape'}</span>
                <span>{en ? 'Value' : 'Valeur'}</span>
                <span>{en ? 'Win %' : 'Taux gain'}</span>
                <span>{en ? 'Weighted' : 'Pondéré'}</span>
                <span>{en ? 'Est. Close' : 'Clôture est.'}</span>
              </div>
              {data.projectedDeals.slice(0, 10).map(d => (
                <div className="crm-table-row" key={d.id}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{d.name}</span>
                  <span>{d.company}</span>
                  <span>
                    <span className="crm-status-dot" style={{ background: STAGE_COLORS[d.stage] || 'var(--text-muted)' }} />
                    {STATUS_LABELS[d.stage] || d.stage}
                  </span>
                  <span>{d.dealValue.toLocaleString()}€</span>
                  <span style={{ color: d.probability >= 50 ? 'var(--success)' : 'var(--warning)' }}>{d.probability}%</span>
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>{d.weightedValue.toLocaleString()}€</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{d.projectedCloseDate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {(pipeline.byStage || []).every(s => s.deals === 0) && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {en
              ? `No ${vocab.deal.toLowerCase()}s with values in ${vocab.pipeline.toLowerCase()}. Add ${vocab.deal.toLowerCase()} values to your contacts to see revenue forecasts.`
              : `Aucun ${vocab.deal.toLowerCase()} avec valeur dans le ${vocab.pipeline.toLowerCase()}. Ajoutez des valeurs à vos ${vocab.deal.toLowerCase()}s pour voir les prévisions de revenu.`}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Real CRM Stages (migration 092) ═══ */

function StageBars({ rows, color, showValue }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
            <span style={{ fontWeight: 600 }}>{r.stage}</span>
            <span style={{ color: 'var(--text-muted)' }}>
              {r.count}
              {showValue && r.value > 0 ? ' · ' + Math.round(r.value).toLocaleString() + ' €' : ''}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, width: Math.round((r.count / max) * 100) + '%', background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AvgDaysByStage({ rows, en }) {
  const max = Math.max(1, ...rows.map(r => Number(r.avg_days) || 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
            <span style={{ fontWeight: 600 }}>{r.stage}</span>
            <span style={{ color: 'var(--text-muted)' }}>{r.avg_days}{en ? 'd avg.' : 'j en moy.'}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, width: `${Math.round((Number(r.avg_days) / max) * 100)}%`, background: 'var(--orange)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StagesBlock({ filterQs = '' }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const [stagesData, setStagesData] = useState(null);

  useEffect(() => {
    let alive = true;
    api.request('/analytics/stages' + filterQs)
      .then(d => { if (alive) setStagesData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [filterQs]);

  if (!stagesData?.available) return null;
  const hasOpen = (stagesData.stages || []).length > 0;
  const hasLost = (stagesData.lostByStage || []).length > 0;
  if (!hasOpen && !hasLost) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="crm-grid-2">
        {hasOpen && (
          <div className="card">
            <div className="card-title">
              {t('analytics.crmStagesTitle')}
              <HelpTip text={t('analytics.crmStagesHelp')} />
            </div>
            <div className="card-body">
              <StageBars rows={stagesData.stages} color="var(--purple)" showValue />
            </div>
          </div>
        )}
        {hasLost && (
          <div className="card">
            <div className="card-title">
              {t('analytics.crmStagesLostTitle')}
              <HelpTip text={t('analytics.crmStagesLostHelp')} />
            </div>
            <div className="card-body">
              <StageBars rows={stagesData.lostByStage} color="var(--danger)" />
            </div>
          </div>
        )}
      </div>
      {stagesData.avgDaysByStage?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">
            {t('analytics.avgDaysByStageTitle')}
            <HelpTip text={t('analytics.avgDaysByStageHelp')} />
          </div>
          <div className="card-body">
            <AvgDaysByStage rows={stagesData.avgDaysByStage} en={en} />
          </div>
        </div>
      )}
      {stagesData.historySince && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
          {t('analytics.crmStagesSince', { date: new Date(stagesData.historySince).toLocaleDateString(en ? 'en-US' : 'fr-FR') })}
        </div>
      )}
    </div>
  );
}

/* ═══ Geography Section ═══ */

// Drapeau emoji depuis un code ISO-2 (indicateurs régionaux Unicode)
function countryFlag(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0)));
}

function GeographySection({ data }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const countries = data.countries || [];

  // Noms de pays localisés sans table à maintenir
  const regionNames = useMemo(() => {
    try { return new Intl.DisplayNames([en ? 'en' : 'fr'], { type: 'region' }); } catch { return null; }
  }, [en]);
  const countryLabel = (code) => {
    try { return regionNames?.of(code) || code; } catch { return code; }
  };

  if (countries.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
          {t('analytics.geoEmptyTitle')}
        </div>
        <div style={{ fontSize: 13, maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
          {t('analytics.geoEmptyDesc')}
        </div>
      </div>
    );
  }

  const barRows = countries.slice(0, 12).map(c => ({
    stage: `${countryFlag(c.code)} ${countryLabel(c.code)}`,
    count: c.contacts,
    value: c.openValue,
  }));

  return (
    <div>
      <div className="crm-grid-2">
        <div className="card">
          <div className="card-title">
            {t('analytics.geoContactsTitle')}
            <HelpTip text={t('analytics.geoHelp')} />
          </div>
          <div className="card-body">
            <StageBars rows={barRows} color="var(--blue)" showValue />
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('analytics.geoTableTitle')}</div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            <table className="crm-table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '6px 8px' }}>{t('analytics.geoCountry')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('analytics.geoContacts')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('analytics.geoClients')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('analytics.geoOpenValue')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('analytics.geoWonValue')}</th>
                </tr>
              </thead>
              <tbody>
                {countries.map(c => (
                  <tr key={c.code} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                      {countryFlag(c.code)} {countryLabel(c.code)}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{c.contacts}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{c.clients}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                      {c.openValue > 0 ? c.openValue.toLocaleString() + ' €' : '—'}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                      {c.wonValue > 0 ? c.wonValue.toLocaleString() + ' €' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
        {data.undetermined > 0 && (
          <span>{t('analytics.geoUndetermined', { count: data.undetermined, total: data.total })} · </span>
        )}
        {t('analytics.geoCoverageNote', { pct: data.crmCoverage })}
      </div>
    </div>
  );
}

/* ═══ Membership Section (Clients — vue d'ensemble) ═══ */

const CHURN_BAND_COLORS = { critical: '#DC2626', high: '#F59E0B', medium: '#6E57FA', low: '#16A34A' };

function MembershipSection({ data, en }) {
  const k = data.kpis || {};

  return (
    <div className="crm-section">
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          { label: en ? 'Total clients' : 'Clients total', value: k.total_won || 0, color: '#6E57FA' },
          { label: en ? 'At risk' : 'À risque', value: k.at_risk || 0, color: '#DC2626' },
          { label: en ? 'Avg lead value' : 'Valeur moyenne', value: k.avg_deal_value ? `${k.avg_deal_value}€` : '—', color: '#16A34A' },
          { label: en ? 'Total revenue' : 'Revenu total', value: k.total_revenue ? `${Number(k.total_revenue).toLocaleString()}€` : '—', color: '#16A34A' },
          { label: en ? 'Avg cycle' : 'Cycle moyen', value: k.avg_cycle_days ? `${k.avg_cycle_days}j` : '—' },
          { label: en ? 'Avg churn score' : 'Score churn moyen', value: k.avg_churn_score || '—', color: k.avg_churn_score >= 50 ? '#DC2626' : '#F59E0B' },
        ].map((kpi, i) => (
          <div key={i} className="card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color || 'var(--text-primary)' }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Churn distribution */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Churn Distribution' : 'Distribution Churn'}</div>
          {(data.churnDistribution || []).map(b => (
            <div key={b.band} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 70, fontSize: 12, fontWeight: 600, color: CHURN_BAND_COLORS[b.band] || '#737373', textTransform: 'capitalize' }}>{b.band}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 4, background: CHURN_BAND_COLORS[b.band] || '#6E57FA', width: `${Math.min((parseInt(b.count) / Math.max(parseInt(k.total_contacts) || 1, 1)) * 100, 100)}%` }} />
              </div>
              <span style={{ width: 40, fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{b.count}</span>
            </div>
          ))}
        </div>

        {/* Tenure distribution */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Client Tenure' : 'Ancienneté clients'}</div>
          {(data.tenure || []).map(tr => (
            <div key={tr.band} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span>{tr.band}</span>
              <span style={{ fontWeight: 600 }}>{tr.count} {en ? 'clients' : 'clients'}{tr.total_value ? ` · ${Number(tr.total_value).toLocaleString()}€` : ''}</span>
            </div>
          ))}
          {(!data.tenure || data.tenure.length === 0) && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{en ? 'No data yet' : 'Pas de données'}</div>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Revenue by size */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Revenue by Company Size' : 'Revenu par taille entreprise'}</div>
          {(data.bySize || []).map(s => (
            <div key={s.segment} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <span>{s.segment}</span>
              <span><strong>{s.won}</strong> {en ? 'won' : 'gagnés'} · {s.revenue ? `${Number(s.revenue).toLocaleString()}€` : '—'}</span>
            </div>
          ))}
        </div>

        {/* Performance by rep */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Performance by Rep' : 'Performance par commercial'}</div>
          {(data.byOwner || []).map(o => {
            const winRate = parseInt(o.total) > 0 ? Math.round((parseInt(o.won) / parseInt(o.total)) * 100) : 0;
            return (
              <div key={o.rep} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{o.rep}</span>
                <span><strong>{winRate}%</strong> win · {o.revenue ? `${Number(o.revenue).toLocaleString()}€` : '—'}</span>
              </div>
            );
          })}
          {(!data.byOwner || data.byOwner.length === 0) && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{en ? 'No data yet' : 'Pas de données'}</div>}
        </div>
      </div>

      {/* Monthly trend */}
      {data.monthlyTrend?.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Monthly Wins & Revenue' : 'Gains & revenus mensuels'}</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100 }}>
            {data.monthlyTrend.map(m => {
              const maxWins = Math.max(...data.monthlyTrend.map(x => parseInt(x.wins) || 0), 1);
              const h = Math.max(((parseInt(m.wins) || 0) / maxWins) * 80, 4);
              return (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>{m.wins}</div>
                  <div style={{ width: '100%', height: h, borderRadius: 4, background: '#6E57FA' }} title={`${m.month}: ${m.wins} wins, ${m.revenue}€`} />
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{m.month.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming renewals */}
      {data.upcomingRenewals?.length > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{en ? 'Upcoming Renewals (60 days)' : 'Renouvellements à venir (60 jours)'}</div>
          {data.upcomingRenewals.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.company} {r.deal_value ? `· ${r.deal_value}€` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{new Date(r.renewal_date).toLocaleDateString(en ? 'en-US' : 'fr-FR')}</div>
                {r.churn_score >= 50 && <div style={{ fontSize: 10, color: '#DC2626' }}>Churn {r.churn_score}%</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Lost Reasons Section (Deals) ═══ */

const LOST_REASON_PRESETS_FR = ['Prix trop élevé', 'Choix d\'un concurrent', 'Plus de réponse', 'Mauvais timing', 'Budget annulé en interne', 'Produit pas adapté'];
const LOST_REASON_PRESETS_EN = ['Price too high', 'Chose a competitor', 'Went silent', 'Bad timing', 'Internal budget cancelled', 'Not a fit'];

function UntaggedDealRow({ deal, en, onTag }) {
  const [submitting, setSubmitting] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const presets = en ? LOST_REASON_PRESETS_EN : LOST_REASON_PRESETS_FR;

  const submit = async (reason) => {
    if (!reason.trim() || submitting) return;
    setSubmitting(true);
    await onTag(deal.id, reason.trim());
    setSubmitting(false);
  };

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {deal.company}{deal.dealValue > 0 ? ` · ${deal.dealValue.toLocaleString()}€` : ''}
            {deal.lostDate ? ` · ${new Date(deal.lostDate).toLocaleDateString(en ? 'en-US' : 'fr-FR')}` : ''}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {presets.map(p => (
          <button
            key={p}
            disabled={submitting}
            onClick={() => submit(p)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 14, cursor: submitting ? 'default' : 'pointer',
              border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
              opacity: submitting ? 0.5 : 1,
            }}
          >{p}</button>
        ))}
        {!customOpen ? (
          <button
            disabled={submitting}
            onClick={() => setCustomOpen(true)}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
              border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-muted)',
            }}
          >{en ? '+ Other' : '+ Autre'}</button>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <input
              autoFocus
              type="text"
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(customText); }}
              placeholder={en ? 'Custom reason…' : 'Raison libre…'}
              disabled={submitting}
              style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 8, width: 140,
                border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
              }}
            />
            <button
              disabled={submitting || !customText.trim()}
              onClick={() => submit(customText)}
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '4px 10px' }}
            >OK</button>
          </span>
        )}
      </div>
    </div>
  );
}

function LostReasonsSection({ data, en, onTagged }) {
  const t = useT();

  const handleTag = async (id, reason) => {
    try {
      await api.request(`/crm/opportunities/${id}/lost-reason`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      onTagged();
    } catch { /* la ligne reste affichée, l'utilisateur peut retenter */ }
  };

  const distRows = data.distribution.map(d => ({ stage: d.reason, count: d.count, value: d.value }));

  return (
    <div className="crm-section">
      {/* KPI row */}
      <div className="crm-kpi-row">
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: 'var(--danger)' }}>{data.totalLost}</div>
          <div className="crm-kpi-label">{t('analytics.lostReasonsTotalLost')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value">{data.taggedCount}</div>
          <div className="crm-kpi-label">{t('analytics.lostReasonsTagged')}</div>
        </div>
        <div className="crm-kpi-card">
          <div className="crm-kpi-value" style={{ color: data.untaggedCount > 0 ? 'var(--warning)' : undefined }}>{data.untaggedCount}</div>
          <div className="crm-kpi-label">{t('analytics.lostReasonsUntagged')}</div>
        </div>
      </div>

      {distRows.length > 0 && (
        <div className="card">
          <div className="card-title">{t('analytics.lostReasonsDistribution')}</div>
          <div className="card-body">
            <StageBars rows={distRows} color="var(--danger)" showValue />
          </div>
        </div>
      )}

      {data.untagged.length > 0 && (
        <div className="card">
          <div className="card-title">
            {t('analytics.lostReasonsUntaggedTitle', { count: data.untaggedCount })}
            <HelpTip text={t('analytics.lostReasonsUntaggedHelp')} />
          </div>
          <div className="card-body" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {data.untagged.map(deal => (
              <UntaggedDealRow key={deal.id} deal={deal} en={en} onTag={handleTag} />
            ))}
          </div>
        </div>
      )}

      {data.totalLost === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
          {t('analytics.lostReasonsEmpty')}
        </div>
      )}
    </div>
  );
}
