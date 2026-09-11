/* ===============================================================================
   BAKAL — Main Layout (Sidebar + Content + Mobile Nav)
   React equivalent of the vanilla app's sidebar navigation and page shell.
   =============================================================================== */

import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { request } from '../services/api-client';
import { useApp } from '../context/useApp';
import Icon from './Icon';
import { useT } from '../i18n';
import { logout, getUser } from '../services/auth';
import { disconnect as disconnectSocket } from '../services/socket';
import { useSocketEvents } from '../hooks/useSocketEvents';
import NotificationBell from './NotificationBell';
import AssistantNudge from './AssistantNudge';
import HelpWidget from './HelpWidget';

/* ─── Sidebar nav items (keys reference i18n nav.* keys) ─── */
// adminOnly: only visible to admins and solo users
// section + children: collapsible group. Open state persisted per section id;
// the section holding the active route is forced open on navigation.
const NAV_ITEMS = [
  { i18nKey: 'nav.assistant',           to: '/chat',                icon: 'chat' },
  { i18nKey: 'nav.dashboard',           to: '/dashboard',           icon: 'dashboard',  end: true },
  // Ordre voulu : Prospection > Deals > Clients > Activation > CRM.
  // Prospection ouvre la liste parce qu'elle est la porte d'entrée — mais elle
  // reste hors des sections CRM : campagnes froides et deals CRM sont deux
  // populations disjointes (cf. backend/lib/crm-scope.js), deux moteurs
  // distincts. Deals et Clients suivent, ce sont les deux populations du CRM ;
  // Activation est l'action qu'on leur applique, donc juste après ; CRM ferme
  // la liste comme couche d'analyse (qualité de données, analytics).
  { i18nKey: 'nav.campaigns',           to: '/campaigns',           icon: 'campaigns' },
  {
    i18nKey: 'nav.sectionDeals', section: 'deals', icon: 'pipeline',
    children: [
      { i18nKey: 'nav.globalView',      to: '/deals',               icon: 'list' },
      { i18nKey: 'nav.toReactivate',    to: '/deals-to-reactivate', icon: 'refinement', countKey: 'reactivation' },
    ],
  },
  {
    i18nKey: 'nav.sectionClients', section: 'clients', icon: 'clients',
    children: [
      { i18nKey: 'nav.globalView',      to: '/clients',             icon: 'table' },
      { i18nKey: 'nav.toUpsell',        to: '/clients-to-upsell',   icon: 'upsell', countKey: 'upsell' },
      { i18nKey: 'nav.atRisk',          to: '/churn-risk',          icon: 'churn', countKey: 'churn' },
    ],
  },
  { i18nKey: 'nav.activation',          to: '/activation',          icon: 'nurture', countKey: 'nurturePending' },
  {
    i18nKey: 'nav.sectionCrm', section: 'crm', icon: 'database',
    children: [
      { i18nKey: 'nav.dataQuality',     to: '/data-quality',        icon: 'dataQuality', countKey: 'dataQuality' },
      { i18nKey: 'nav.analytics',       to: '/analytics',           icon: 'reports', adminOnly: true },
    ],
  },
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

/* ─── Icônes de nav : jeu partagé (src/components/Icon.jsx) ─── */
function NavIcon({ name }) {
  return <Icon name={name} size={18} />;
}

export default function Layout() {
  const { user, setUser } = useApp();
  const t = useT();
  const navigate = useNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Collapsible nav sections — all closed by default, state persisted per section.
  const [openSections, setOpenSections] = useState(() => {
    const defaults = { deals: false, clients: false, crm: false };
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
    // Full reload (not navigate('/')) : App.jsx ne relit isLoggedIn() qu'au
    // montage, un navigate() client-side laisserait l'app affichée jusqu'à
    // un refresh manuel.
    window.location.href = '/';
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
        {/* Topbar — notification bell + nudge vers l'Assistant, empilés à droite */}
        <div
          className="main-topbar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            padding: '8px 24px 0',
          }}
        >
          <NotificationBell />
          <AssistantNudge />
        </div>
        <Outlet />
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

      <HelpWidget />
    </div>
  );
}
