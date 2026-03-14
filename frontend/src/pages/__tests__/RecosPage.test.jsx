import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import RecosPage from '../RecosPage';
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
}));

function renderRecos() {
  return render(
    <AppProvider>
      <MemoryRouter>
        <RecosPage />
      </MemoryRouter>
    </AppProvider>
  );
}

describe('RecosPage', () => {
  it('renders the page title', () => {
    renderRecos();

    expect(screen.getByText('Recommandations IA')).toBeInTheDocument();
  });

  it('renders the page subtitle', () => {
    renderRecos();

    expect(screen.getByText(/Claude analyse vos campagnes et propose des optimisations/)).toBeInTheDocument();
  });

  it('renders recommendation stats cards', () => {
    renderRecos();

    expect(screen.getByText('Recommandations totales')).toBeInTheDocument();
    expect(screen.getByText('En attente')).toBeInTheDocument();

    // Use querySelector for labels with accented characters
    const statLabels = document.querySelectorAll('.reco-stat-label');
    const labelTexts = [...statLabels].map(el => el.textContent);
    expect(labelTexts).toContain('Recommandations totales');
    expect(labelTexts).toContain('En attente');
    expect(labelTexts.length).toBe(4);
  });

  it('renders all priority filter buttons', () => {
    renderRecos();

    expect(screen.getByRole('button', { name: /Toutes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Critiques/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Importantes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suggestions/ })).toBeInTheDocument();
  });

  it('renders recommendation cards', () => {
    renderRecos();

    expect(screen.getByText('Remplacer le CTA agressif par une question ouverte')).toBeInTheDocument();
    expect(screen.getByText(/Remplacer l'angle/)).toBeInTheDocument();
  });

  it('renders campaign filter buttons', () => {
    renderRecos();

    expect(screen.getByRole('button', { name: 'DRH PME Lyon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /DAF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dirigeants Formation' })).toBeInTheDocument();
  });

  it('filters by priority when clicking "Critiques"', () => {
    renderRecos();

    fireEvent.click(screen.getByRole('button', { name: /Critiques/ }));

    // Critical reco should still be visible
    expect(screen.getByText('Remplacer le CTA agressif par une question ouverte')).toBeInTheDocument();
    // Non-critical recos should be hidden (suggestion reco)
    expect(screen.queryByText(/Raccourcir le break-up/)).not.toBeInTheDocument();
  });

  it('filters by campaign when clicking a campaign button', () => {
    renderRecos();

    fireEvent.click(screen.getByRole('button', { name: 'DRH PME Lyon' }));

    // DRH PME Lyon reco should be visible
    expect(screen.getByText('Remplacer le CTA agressif par une question ouverte')).toBeInTheDocument();
    // Other campaign recos should be hidden
    expect(screen.queryByText(/Remplacer l'angle/)).not.toBeInTheDocument();
  });

  it('renders cross-campaign insights', () => {
    renderRecos();

    expect(screen.getByText(/Patterns cross-campagne/)).toBeInTheDocument();
    expect(screen.getByText('Questions ouvertes > CTA directs')).toBeInTheDocument();
    expect(screen.getByText(/Angle positif/)).toBeInTheDocument();
  });

  it('renders action buttons on non-applied cards', () => {
    renderRecos();

    const applyButtons = screen.getAllByRole('button', { name: 'Appliquer' });
    expect(applyButtons.length).toBeGreaterThan(0);

    const ignoreButtons = screen.getAllByRole('button', { name: 'Ignorer' });
    expect(ignoreButtons.length).toBeGreaterThan(0);
  });

  it('applies a recommendation when clicking "Appliquer"', () => {
    renderRecos();

    const applyButtons = screen.getAllByRole('button', { name: 'Appliquer' });
    const initialCount = applyButtons.length;
    fireEvent.click(applyButtons[0]);

    // After applying, there should be fewer "Appliquer" buttons
    const remainingApplyButtons = screen.getAllByRole('button', { name: 'Appliquer' });
    expect(remainingApplyButtons.length).toBeLessThan(initialCount);
  });

  it('dismisses a recommendation when clicking "Ignorer"', () => {
    renderRecos();

    const ignoreButtons = screen.getAllByRole('button', { name: 'Ignorer' });
    const initialCount = ignoreButtons.length;
    fireEvent.click(ignoreButtons[0]);

    // One fewer "Ignorer" button after dismissing
    const remainingIgnoreButtons = screen.getAllByRole('button', { name: 'Ignorer' });
    expect(remainingIgnoreButtons.length).toBeLessThan(initialCount);
  });

  it('renders the "Relancer l\'analyse" button', () => {
    renderRecos();

    expect(screen.getByRole('button', { name: /Relancer/ })).toBeInTheDocument();
  });

  it('shows analysis running state', async () => {
    renderRecos();

    fireEvent.click(screen.getByRole('button', { name: /Relancer/ }));

    await waitFor(() => {
      expect(screen.getByText(/Claude analyse vos campagnes.*Veuillez patienter/)).toBeInTheDocument();
    });
  });
});
