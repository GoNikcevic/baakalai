import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import CopyEditorPage from '../CopyEditorPage';
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
    saveSequence: vi.fn().mockResolvedValue({}),
    regenerateSequence: vi.fn().mockResolvedValue({ messages: [] }),
    runRefinement: vi.fn().mockResolvedValue({ analysis: {}, regeneration: {} }),
  },
  fetchVariables: vi.fn().mockResolvedValue([]),
  exportCampaignCsv: vi.fn(),
}));

function renderEditor() {
  return render(
    <AppProvider>
      <MemoryRouter>
        <CopyEditorPage />
      </MemoryRouter>
    </AppProvider>
  );
}

describe('CopyEditorPage', () => {
  it('renders the editor header with campaign name', () => {
    renderEditor();

    // The first campaign name appears in both sidebar and header
    const titles = screen.getAllByText('DAF Ile-de-France');
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  it('renders campaign sidebar with fallback campaigns', () => {
    renderEditor();

    // Fallback data has these campaigns — use getAllByText since names appear in sidebar + header
    expect(screen.getAllByText('DAF Ile-de-France').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Dirigeants Formation')).toBeInTheDocument();
    expect(screen.getByText('DRH PME Lyon')).toBeInTheDocument();
  });

  it('renders sidebar section titles', () => {
    renderEditor();

    expect(screen.getByText('Campagnes')).toBeInTheDocument();
  });

  it('shows first campaign as active by default', () => {
    renderEditor();

    // First campaign is DAF Ile-de-France — its header should be in the main area
    expect(screen.getByText(/Iteration 4/)).toBeInTheDocument();
  });

  it('renders touchpoint cards for active campaign', () => {
    renderEditor();

    // DAF campaign has E1, E2, E3, E4
    expect(screen.getByText('E1')).toBeInTheDocument();
    expect(screen.getByText('E2')).toBeInTheDocument();
    expect(screen.getByText('E3')).toBeInTheDocument();
    expect(screen.getByText('E4')).toBeInTheDocument();
  });

  it('renders editor params as badges', () => {
    renderEditor();

    expect(screen.getByText('Canal: Email')).toBeInTheDocument();
    expect(screen.getByText(/Douleur client/)).toBeInTheDocument();
  });

  it('renders Parametres and Tout regenerer buttons', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: 'Parametres' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tout regenerer' })).toBeInTheDocument();
  });

  it('shows params panel when clicking Parametres', () => {
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Parametres' }));

    expect(screen.getByText('Parametres de la campagne')).toBeInTheDocument();
  });

  it('hides params panel when clicking Fermer', () => {
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Parametres' }));
    expect(screen.getByText('Parametres de la campagne')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Parametres de la campagne')).not.toBeInTheDocument();
  });

  it('switches campaign when clicking sidebar item', () => {
    renderEditor();

    // Click Dirigeants Formation
    fireEvent.click(screen.getByText('Dirigeants Formation'));

    // Should show LinkedIn touchpoints
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('L2')).toBeInTheDocument();
    // Should no longer show email touchpoints
    expect(screen.queryByText('E1')).not.toBeInTheDocument();
  });

  it('renders save and cancel buttons', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: /Sauvegarder/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annuler/ })).toBeInTheDocument();
  });

  it('renders AI suggestion bar for campaigns with suggestions', () => {
    renderEditor();

    expect(screen.getByText('2 suggestions disponibles')).toBeInTheDocument();
  });

  it('renders touchpoint AI suggestions inline', () => {
    renderEditor();

    // E3 and E4 both have suggestions
    const suggestions = screen.getAllByText(/Suggestion IA/);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('renders LaunchBar for prep campaigns', () => {
    renderEditor();

    // Switch to DRH PME Lyon (prep)
    fireEvent.click(screen.getByText('DRH PME Lyon'));

    expect(screen.getByText(/Sequence prete/)).toBeInTheDocument();
  });

  it('shows status text for active campaigns', () => {
    renderEditor();

    expect(screen.getByText(/Campagne active/)).toBeInTheDocument();
  });

  it('renders Variable Manager panel in sidebar', () => {
    renderEditor();

    expect(screen.getByText('Variables')).toBeInTheDocument();
  });
});
