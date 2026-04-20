/* ===============================================================================
   BAKAL — Main Layout (Sidebar + Content + Mobile Nav)
   React equivalent of the vanilla app's sidebar navigation and page shell.
   =============================================================================== */

import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useT } from '../i18n';
import { logout } from '../services/auth';
import { disconnect as disconnectSocket } from '../services/socket';
import { useSocketEvents } from '../hooks/useSocketEvents';
import CampaignCreatorModal from './CampaignCreatorModal';
import NotificationBell from './NotificationBell';

/* ─── Sidebar nav items (keys reference i18n nav.* keys) ─── */
const NAV_ITEMS = [
  { i18nKey: 'nav.assistant',    to: '/chat',          icon: 'chat' },
  { i18nKey: 'nav.dashboard',    to: '/dashboard',     icon: 'dashboard',  end: true },
  { i18nKey: 'nav.campaigns',    to: '/campaigns',     icon: 'campaigns' },
  { i18nKey: 'nav.performance',  to: '/performance',   icon: 'reports' },
  { i18nKey: 'nav.memory',       to: '/memory',        icon: 'memory' },
  { i18nKey: 'nav.clients',      to: '/clients',       icon: 'clients' },
  { i18nKey: 'nav.nurture',      to: '/nurture',       icon: 'nurture' },
  { i18nKey: 'nav.crmAnalytics', to: '/crm-analytics', icon: 'crm' },
  { i18nKey: 'nav.profile',      to: '/profil',        icon: 'profil' },
  { i18nKey: 'nav.settings',     to: '/settings',      icon: 'settings' },
];

/* ─── Mobile bottom nav (subset) ─── */
const MOBILE_NAV = [
  { i18nKey: 'nav.chat',        to: '/chat',        icon: 'chat' },
  { i18nKey: 'nav.dashboard',   to: '/dashboard',   icon: 'dashboard' },
  { i18nKey: 'nav.campaigns',   to: '/campaigns',   icon: 'campaigns' },
  { i18nKey: 'nav.performance', to: '/performance',  icon: 'reports' },
  { i18nKey: 'nav.settings',    to: '/settings',    icon: 'settings' },
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
  const [showCreatorModal, setShowCreatorModal] = useState(false);
  const [demoMode, setDemoMode] = useState(() => localStorage.getItem('bakal_demo_mode') === 'true');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Wire socket events to app state + notifications
  useSocketEvents();

  async function handleLogout() {
    disconnectSocket();
    await logout();
    setUser(null);
    window.location.href = '/';
  }

  const userInitial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <div className="app-shell">
      {/* ═══ Sidebar ═══ */}
      <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        {/* Brand */}
        <NavLink to="/dashboard" className="sidebar-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="mark"></span>
          <span className="brand-text">baakalai</span>
        </NavLink>

        {/* New campaign button */}
        <button
          className="btn btn-primary sidebar-cta"
          onClick={() => setShowCreatorModal(true)}
        >
          {t('nav.newCampaign')}
        </button>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
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
            </NavLink>
          ))}
        </nav>

        {/* Demo mode toggle */}
        <button
          onClick={() => { setDemoMode(p => { const next = !p; localStorage.setItem('bakal_demo_mode', String(next)); return next; }); }}
          style={{
            padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: demoMode ? 'var(--blue)' : 'var(--bg-elevated)',
            color: demoMode ? 'white' : 'var(--text-muted)',
            border: '1px solid var(--border)', cursor: 'pointer',
            transition: 'all 0.2s', marginBottom: 12, width: '100%',
            textAlign: 'center',
          }}
        >
          {demoMode ? t('nav.demoActive') : t('nav.viewDemo')}
        </button>

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
        <Outlet context={{ showCreatorModal, setShowCreatorModal, demoMode }} />
      </main>

      {/* ═══ Mobile bottom nav ═══ */}
      <nav className="mobile-nav">
        {MOBILE_NAV.map((item) => (
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
    </div>
  );
}
