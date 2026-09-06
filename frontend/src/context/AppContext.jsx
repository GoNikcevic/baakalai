/* ===============================================================================
   BAKAL — Global App Context (React)
   Replaces the vanilla BAKAL global object with React state management.
   Provides campaigns, projects, KPIs, backend status, and user state.
   =============================================================================== */

import { useState, useCallback, useMemo } from 'react';
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
   * Otherwise leaves everything empty.
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

        // Fetch campaigns first, then projects (which needs campaign data for linking)
        const [campaignsData, kpisData, oppsData, reportsData, chartDataResult, recosData] = await Promise.all([
          api.fetchAllCampaigns(),
          api.fetchDashboard(),
          api.fetchOpportunities().catch(() => []),
          api.fetchReports().catch(() => []),
          api.fetchChartData().catch(() => []),
          api.fetchRecommendations().catch(() => []),
        ]);

        const projectsData = await api.fetchProjects(campaignsData).catch(() => ({}));

        setCampaigns(campaignsData);
        setGlobalKpis(kpisData);
        setProjects(projectsData);
        setOpportunities(oppsData);
        setReports(reportsData);
        setChartData(chartDataResult);
        setRecommendations(recosData);
      } else {
        throw new Error('Backend unreachable');
      }
    } catch {
      // Backend not available — leave everything empty
      setBackendAvailable(false);
      setCampaigns({});
      setProjects({});
      setGlobalKpis({});
      setOpportunities([]);
      setRecommendations([]);
      setReports([]);
      setChartData([]);
    }
  }, []);

  const value = useMemo(() => ({
    campaigns, projects, globalKpis, opportunities, recommendations, reports, chartData, backendAvailable, user,
    setCampaigns, setProjects, setGlobalKpis, setOpportunities, setRecommendations, setReports, setChartData, setBackendAvailable, setUser,
    initData,
  }), [campaigns, projects, globalKpis, opportunities, recommendations, reports, chartData, backendAvailable, user, initData]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
