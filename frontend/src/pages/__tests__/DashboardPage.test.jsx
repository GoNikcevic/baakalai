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
  // ClientsTab (bandeau "Risque de churn") et ActivationTab (feedback utile / pas utile
  // des recommandations) appellent ces exports nommés directement.
  getChurnSummary: vi.fn().mockResolvedValue({}),
  sendRecoFeedback: vi.fn(),
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
  // fichier sans appelant. L'état vide ne montre plus qu'une seule carte
  // « Campagnes actives » pleine largeur (Performance/Recommandations retirées).
  it('shows empty state card when no campaigns', () => {
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

    // Le sous-titre d'accueil décrit le produit dans son ensemble (deals,
    // clients, données) plutôt qu'une seule offre — voir dashboard.welcomeSubtitle.
    expect(screen.getByText(/analyse votre CRM en continu/)).toBeInTheDocument();
  });
});
