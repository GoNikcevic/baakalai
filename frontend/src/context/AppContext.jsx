/* ===============================================================================
   BAKAL — Global App Context (React)
   Replaces the vanilla BAKAL global object with React state management.
   Provides campaigns, projects, KPIs, backend status, and user state.
   =============================================================================== */

import { useState, useCallback } from 'react';
import api from '../services/api-client';
import { getUser, isLoggedIn } from '../services/auth';
import { AppContext } from './appContextValue';

export function AppProvider({ children }) {
  const [campaigns, setCampaigns] = useState({});
  const [projects, setProjects] = useState({});
  const [globalKpis, setGlobalKpis] = useState({});
  const [opportunities, setOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [reports, setReports] = useState([]);
  const [chartData, setChartData] = useState([]);
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
        const [campaignsData, kpisData, projectsData] = await Promise.all([
          api.fetchAllCampaigns(),
          api.fetchDashboard(),
          api.fetchProjects().catch(() => ({})),
        ]);

        setCampaigns(campaignsData);
        setGlobalKpis(kpisData);
        setProjects(projectsData);
      } else {
        throw new Error('Backend unreachable');
      }
    } catch {
      // Backend not available — load demo data
      setBackendAvailable(false);

      const { DEMO_DATA } = await import('../data/demo-data');
      setCampaigns(DEMO_DATA.campaigns || {});
      setProjects(DEMO_DATA.projects || {});
      setGlobalKpis(DEMO_DATA.globalKpis || {});
      setOpportunities(DEMO_DATA.opportunities || []);
      setRecommendations(DEMO_DATA.recommendations || []);
      setReports(DEMO_DATA.reports || []);
      setChartData(DEMO_DATA.chartData || []);
    }
  }, []);

  const value = {
    // State
    campaigns,
    projects,
    globalKpis,
    opportunities,
    recommendations,
    reports,
    chartData,
    backendAvailable,
    user,

    // Setters
    setCampaigns,
    setProjects,
    setGlobalKpis,
    setOpportunities,
    setRecommendations,
    setReports,
    setChartData,
    setBackendAvailable,
    setUser,

    // Actions
    initData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
