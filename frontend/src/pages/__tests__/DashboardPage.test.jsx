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
  // Les composants passent par request() pour les appels non typés ;
  // sans cette entrée, vitest rejette tout accès à l'export absent.
  request: vi.fn().mockResolvedValue({}),
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
    useOutletContext: () => ({ setShowCreatorModal: vi.fn() }),
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

  // L'ancienne bannière d'accueil et ses quatre étapes d'onboarding
  // (WelcomeBanner) ne sont plus rendues : l'audit UX du 2026-08-05 a retiré
  // les jauges de progression concurrentes, et le composant est resté dans le
  // fichier sans appelant. L'état vide se compose désormais des KPI à blanc et
  // des cartes « Campagnes actives » / « Performance 4 semaines ».
  it('shows empty state cards when no campaigns', () => {
    renderDashboard();

    expect(screen.getByText(/Campagnes actives/)).toBeInTheDocument();
    expect(screen.getByText(/Aucune campagne pour le moment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cr.er une campagne/ })).toBeInTheDocument();
  });

  it('shows empty KPI cards with placeholder values', () => {
    renderDashboard();

    // Multiple KPI cards show "En attente de données"
    const placeholders = screen.getAllByText('En attente de données');
    expect(placeholders.length).toBe(6);
  });

  it('shows subtitle for empty state', () => {
    renderDashboard();

    // Le sous-titre d'accueil parle désormais de connecter le CRM, plus de
    // configurer une campagne — le positionnement a changé.
    expect(screen.getByText(/Connectez votre CRM/)).toBeInTheDocument();
  });

  it('shows the 4-week performance placeholder in empty overview', () => {
    renderDashboard();

    expect(screen.getByText(/Performance 4 semaines/)).toBeInTheDocument();
  });
});
