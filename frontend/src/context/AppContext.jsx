/* ===============================================================================
   BAKAL — Global App Context (React)
   Replaces the vanilla BAKAL global object with React state management.
   Provides campaigns, projects, KPIs, backend status, and user state.
   =============================================================================== */

import { createContext, useContext, useState, useCallback } from 'react';
import api from '../services/api-client';
import { getUser, isLoggedIn } from '../services/auth';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [campaigns, setCampaigns] = useState({});
  const [projects, setProjects] = useState({});
  const [globalKpis, setGlobalKpis] = useState({});
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [user, setUser] = useState(() => (isLoggedIn() ? getUser() : null));

  /**
   * Initialize application data.
   * Checks backend health first; if reachable, fetches live data.
   * Otherwise falls back to demo data for offline / GitHub-Pages mode.
   */
  const initData = useCallback(async () => {
    // Hydrate user from local storage
    if (isLoggedIn()) {
      setUser(getUser());
    }

    try {
      const health = await api.checkHealth();

      if (health) {
        setBackendAvailable(true);

        // Fetch live data in parallel
        const [campaignsData, kpisData] = await Promise.all([
          api.fetchAllCampaigns(),
          api.fetchDashboard(),
        ]);

        setCampaigns(campaignsData);
        setGlobalKpis(kpisData);
      } else {
        throw new Error('Backend unreachable');
      }
    } catch {
      // Backend not available — load demo data
      setBackendAvailable(false);

      const { default: demoData } = await import('../data/demo-data');
      setCampaigns(demoData.campaigns || {});
      setProjects(demoData.projects || {});
      setGlobalKpis(demoData.globalKpis || {});
    }
  }, []);

  const value = {
    // State
    campaigns,
    projects,
    globalKpis,
    backendAvailable,
    user,

    // Setters
    setCampaigns,
    setProjects,
    setGlobalKpis,
    setBackendAvailable,
    setUser,

    // Actions
    initData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Hook to access the global app context.
 * Must be used within an <AppProvider>.
 */
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp() must be used inside <AppProvider>');
  }
  return ctx;
}
