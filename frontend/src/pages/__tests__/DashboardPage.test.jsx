import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import DashboardPage from '../DashboardPage';
import { AppProvider } from '../../context/AppContext';

// Mock auth service
vi.mock('../../services/auth', () => ({
  isLoggedIn: () => false,
  getUser: () => null,
  getToken: () => null,
  getRefreshToken: () => null,
}));

// Mock api-client
vi.mock('../../services/api-client', () => ({
  default: {
    checkHealth: vi.fn().mockResolvedValue(null),
  },
  scoreLeads: vi.fn(),
  exportScoresToCRM: vi.fn(),
  downloadScoresCSV: vi.fn(),
}));

// Mock react-router-dom's useOutletContext
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => ({ setShowCreatorModal: vi.fn(), demoMode: false }),
  };
});

function renderDashboard() {
  return render(
    <AppProvider>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </AppProvider>
  );
}

describe('DashboardPage', () => {
  it('renders the page title', () => {
    renderDashboard();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('shows empty state / welcome banner when no campaigns', () => {
    renderDashboard();

    expect(screen.getByText('Bienvenue sur Bakal')).toBeInTheDocument();
  });

  it('shows empty KPI cards with placeholder values', () => {
    renderDashboard();

    // Multiple KPI cards show "En attente de données"
    const placeholders = screen.getAllByText('En attente de données');
    expect(placeholders.length).toBe(6);
  });

  it('shows subtitle for empty state', () => {
    renderDashboard();

    expect(screen.getByText(/Bienvenue.*Configurez votre premi.re campagne/)).toBeInTheDocument();
  });

  it('shows onboarding steps in empty overview', () => {
    renderDashboard();

    expect(screen.getByText(/Cr.ez votre campagne/)).toBeInTheDocument();
    expect(screen.getByText(/Claude g.n.re vos s.quences/)).toBeInTheDocument();
    expect(screen.getByText('Importez vos prospects')).toBeInTheDocument();
    expect(screen.getByText('Lancez et optimisez')).toBeInTheDocument();
  });
});
