/* ===============================================================================
   BAKAL — Main Layout (Sidebar + Content + Mobile Nav)
   React equivalent of the vanilla app's sidebar navigation and page shell.
   =============================================================================== */

import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { request } from '../services/api-client';
import { useApp } from '../context/useApp';
import { useT } from '../i18n';
import { logout, getUser } from '../services/auth';
import { disconnect as disconnectSocket } from '../services/socket';
import { useSocketEvents } from '../hooks/useSocketEvents';
import CampaignCreatorModal from './CampaignCreatorModal';
import NotificationBell from './NotificationBell';
import HelpWidget from './HelpWidget';

/* ─── Sidebar nav items (keys reference i18n nav.* keys) ─── */
// adminOnly: only visible to admins and solo users
// section + children: collapsible group. Open state persisted per section id;
// the section holding the active route is forced open on navigation.
const NAV_ITEMS = [
  { i18nKey: 'nav.assistant',           to: '/chat',                icon: 'chat' },
  { i18nKey: 'nav.dashboard',           to: '/dashboard',           icon: 'dashboard',  end: true },
  {
    i18nKey: 'nav.sectionDeals', section: 'deals', icon: 'refinement',
    children: [
      { i18nKey: 'nav.toReactivate',    to: '/deals-to-reactivate', icon: 'refinement', countKey: 'reactivation' },
      { i18nKey: 'nav.campaigns',       to: '/campaigns',           icon: 'campaigns' },
    ],
  },
  {
    i18nKey: 'nav.sectionClients', section: 'clients', icon: 'clients',
    children: [
      { i18nKey: 'nav.globalView',      to: '/clients',             icon: 'clients' },
      { i18nKey: 'nav.toUpsell',        to: '/clients-to-upsell',   icon: 'upsell', countKey: 'upsell' },
      { i18nKey: 'nav.atRisk',          to: '/churn-risk',          icon: 'churn', countKey: 'churn' },
    ],
  },
  {
    i18nKey: 'nav.sectionCrm', section: 'crm', icon: 'crm',
    children: [
      { i18nKey: 'nav.dataQuality',     to: '/data-quality',        icon: 'crm', countKey: 'dataQuality' },
      { i18nKey: 'nav.analytics',       to: '/analytics',           icon: 'reports', adminOnly: true },
    ],
  },
  { i18nKey: 'nav.activation',          to: '/activation',          icon: 'nurture', countKey: 'nurturePending' },
  { i18nKey: 'nav.performance',         to: '/performance',         icon: 'dashboard', adminOnly: true },
  { i18nKey: 'nav.settings',            to: '/settings',            icon: 'settings', adminOnly: true },
];

const NAV_SECTIONS_STORAGE_KEY = 'nav_open_sections';

// '/clients' must not match '/clients-to-upsell' — exact segment boundary only.
function routeMatches(pathname, to) {
  return pathname === to || pathname.startsWith(to + '/');
}

function isVisibleToUser(item) {
  if (!item.adminOnly) return true;
  const u = getUser();
  return !u?.teamRole || u.teamRole === 'admin';
}

/* ─── Mobile bottom nav (subset) ─── */
const MOBILE_NAV = [
  { i18nKey: 'nav.chat',        to: '/chat',        icon: 'chat' },
  { i18nKey: 'nav.dashboard',   to: '/dashboard',   icon: 'dashboard' },
  { i18nKey: 'nav.campaigns',   to: '/campaigns',   icon: 'campaigns' },
  { i18nKey: 'nav.churnRisk',   to: '/churn-risk',  icon: 'churn' },
  { i18nKey: 'nav.activation',  to: '/activation',  icon: 'nurture' },
  { i18nKey: 'nav.settings',    to: '/settings',    icon: 'settings', adminOnly: true },
];

/* ─── Simple SVG icon map ─── */
function NavIcon({ name }) {
  const icons = {
    chat: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    dashboard: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    campaigns: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    copy: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
    recos: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
    reports: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    refinement: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
    upsell: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 6" /><polyline points="14 6 21 6 21 13" />
      </svg>
    ),
    churn: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    profil: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
    ),
    memory: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
        <line x1="9" y1="21" x2="15" y2="21" />
      </svg>
    ),
    clients: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    signals: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
      </svg>
    ),
    nurture: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    crm: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    ),
    settings: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };
  return icons[name] || null;
}

export default function Layout() {
  const { user, setUser } = useApp();
  const t = useT();
  const navigate = useNavigate();
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Collapsible nav sections — all open by default, state persisted per section.
  const [openSections, setOpenSections] = useState(() => {
    const defaults = { deals: true, clients: true, crm: true };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(NAV_SECTIONS_STORAGE_KEY) || '{}') };
    } catch {
      return defaults;
    }
  });

  function toggleSection(id) {
    setOpenSections(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(NAV_SECTIONS_STORAGE_KEY, JSON.stringify(next)); } catch { /* quota/private mode */ }
      return next;
    });
  }

  // Wire socket events to app state + notifications
  useSocketEvents();

  async function handleLogout() {
    disconnectSocket();
    await logout();
    setUser(null);
    navigate('/');
  }

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  // Paywall : GET /billing renvoie locked:true uniquement quand Stripe est
  // branché ET l'essai expiré sans abonnement. Inerte pour tous les comptes
  // actuels (trial_ends_at NULL = exempté).
  const [billingLocked, setBillingLocked] = useState(false);
  const location = useLocation();
  useEffect(() => {
    request('/billing').then(d => setBillingLocked(!!d.locked)).catch(() => {});
  }, []);

  // The section holding the active page always ends up open (without closing others).
  useEffect(() => {
    const owner = NAV_ITEMS.find(item =>
      item.children?.some(child => routeMatches(location.pathname, child.to)));
    if (owner && !openSections[owner.section]) {
      setOpenSections(prev => ({ ...prev, [owner.section]: true }));
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Action counters for the nav badges — refreshed on navigation (throttled)
  // so approving emails or postponing a deal updates the numbers, plus a slow
  // interval for long-lived tabs. The endpoint is cheap (DB-only) by contract.
  const [navCounts, setNavCounts] = useState({});
  const lastCountsFetchRef = useRef(0);
  useEffect(() => {
    function fetchCounts(force = false) {
      if (!force && Date.now() - lastCountsFetchRef.current < 10_000) return;
      lastCountsFetchRef.current = Date.now();
      request('/nav/counts').then(setNavCounts).catch(() => {});
    }
    fetchCounts(true);
    const interval = setInterval(() => fetchCounts(true), 120_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (Date.now() - lastCountsFetchRef.current >= 10_000) {
      lastCountsFetchRef.current = Date.now();
      request('/nav/counts').then(setNavCounts).catch(() => {});
    }
  }, [location.pathname]);

  const countFor = (item) => (item.countKey ? navCounts[item.countKey] || 0 : 0);

  return (
    <div className="app-shell">
      {billingLocked && !location.pathname.startsWith('/settings') && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'color-mix(in srgb, var(--paper) 92%, transparent)',
          backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ maxWidth: 420, padding: '32px 36px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{t('billing.lockedTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>{t('billing.lockedBody')}</div>
            <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => navigate('/settings')}>
              {t('billing.lockedCta')}
            </button>
          </div>
        </div>
      )}
      {/* ═══ Sidebar ═══ */}
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        {/* Brand */}
        <NavLink to="/dashboard" className="sidebar-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <svg className="brand-logo" width="22" height="22" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
            <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round"/>
            <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="22" cy="26" r="7" fill="#C4B5FD"/>
            <circle cx="82" cy="30" r="8" fill="#9A84EB"/>
            <circle cx="30" cy="80" r="7" fill="#C4B5FD"/>
            <circle cx="50" cy="50" r="13" fill="#6E57FA"/>
          </svg>
          <span className="brand-text">baakalai</span>
        </NavLink>

        {/* New campaign button (admin only) */}
        {(!getUser()?.teamRole || getUser()?.teamRole === 'admin') && (
          <button
            className="btn btn-primary sidebar-cta"
            onClick={() => setShowCreatorModal(true)}
          >
            {t('nav.newCampaign')}
          </button>
        )}

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.filter(isVisibleToUser).map((item) => {
            if (!item.children) {
              const count = countFor(item);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end || false}
                  className={({ isActive }) =>
                    'nav-item' + (isActive ? ' active' : '')
                  }
                >
                  <NavIcon name={item.icon} />
                  <span className="nav-label">{t(item.i18nKey)}</span>
                  {count > 0 && !sidebarCollapsed && <span className="badge">{count}</span>}
                </NavLink>
              );
            }

            const children = item.children.filter(isVisibleToUser);
            if (!children.length) return null;
            const isOpen = !!openSections[item.section];
            const childActive = children.some(c => routeMatches(location.pathname, c.to));
            const sectionCount = children.reduce((sum, c) => sum + countFor(c), 0);
            const showHeaderBadge = !isOpen && sectionCount > 0;

            // Collapsed sidebar: no room for headers — surface the children as icons.
            if (sidebarCollapsed) {
              return children.map(child => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                >
                  <NavIcon name={child.icon} />
                  <span className="nav-label">{t(child.i18nKey)}</span>
                </NavLink>
              ));
            }

            return (
              <div key={item.section}>
                <button
                  type="button"
                  onClick={() => toggleSection(item.section)}
                  className={'nav-item' + (!isOpen && childActive ? ' active' : '')}
                  aria-expanded={isOpen}
                  style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
                >
                  <NavIcon name={item.icon} />
                  <span className="nav-label">{t(item.i18nKey)}</span>
                  {showHeaderBadge && <span className="badge">{sectionCount}</span>}
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{
                      marginLeft: showHeaderBadge ? 8 : 'auto', flexShrink: 0, opacity: 0.6,
                      transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease',
                    }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                {isOpen && children.map(child => {
                  const count = countFor(child);
                  return (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                      style={{ paddingLeft: 34 }}
                    >
                      <NavIcon name={child.icon} />
                      <span className="nav-label">{t(child.i18nKey)}</span>
                      {count > 0 && <span className="badge">{count}</span>}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Sidebar collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(p => !p)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: '8px', width: '100%',
            display: 'flex', justifyContent: 'center', marginTop: 8,
          }}
          title={sidebarCollapsed ? t('nav.openSidebar') : t('nav.collapseSidebar')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sidebarCollapsed
              ? <polyline points="9 18 15 12 9 6" />
              : <polyline points="15 18 9 12 15 6" />
            }
          </svg>
        </button>

        {/* Sidebar bottom — user section */}
        {user && (
          <div className="sidebar-user-section">
            <div className="sidebar-user-avatar">{userInitial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-email">{user.email}</div>
            </div>
            <button
              className="sidebar-logout-btn"
              onClick={handleLogout}
              title={t('nav.logoutTitle')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        )}
      </aside>

      {/* ═══ Main content area ═══ */}
      <main className="main" style={sidebarCollapsed ? { marginLeft: 60 } : undefined}>
        {/* Topbar with notification bell */}
        <div
          className="main-topbar"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: '8px 24px 0',
          }}
        >
          <NotificationBell />
        </div>
        <Outlet context={{ showCreatorModal, setShowCreatorModal }} />
      </main>

      {/* ═══ Mobile bottom nav ═══ */}
      <nav className="mobile-nav">
        {MOBILE_NAV.filter(item => {
          if (!item.adminOnly) return true;
          const u = getUser();
          return !u?.teamRole || u.teamRole === 'admin';
        }).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              'mobile-nav-item' + (isActive ? ' active' : '')
            }
          >
            <NavIcon name={item.icon} />
            <span className="mobile-nav-label">{t(item.i18nKey)}</span>
          </NavLink>
        ))}
      </nav>

      {/* Campaign creator modal */}
      {showCreatorModal && (
        <CampaignCreatorModal onClose={() => setShowCreatorModal(false)} />
      )}

      <HelpWidget />
    </div>
  );
}
