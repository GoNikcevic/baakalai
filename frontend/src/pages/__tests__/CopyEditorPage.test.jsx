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
  // Les composants passent par request() pour les appels non typés ;
  // sans cette entrée, vitest rejette tout accès à l'export absent.
  request: vi.fn().mockResolvedValue({}),
  default: {
    checkHealth: vi.fn().mockResolvedValue(null),
    saveSequence: vi.fn().mockResolvedValue({}),
    regenerateSequence: vi.fn().mockResolvedValue({ messages: [] }),
    runRefinement: vi.fn().mockResolvedValue({ analysis: {}, regeneration: {} }),
  },
  fetchVariables: vi.fn().mockResolvedValue([]),
  exportCampaignCsv: vi.fn(),
}));

// Campagnes de test, dans la forme du contexte applicatif (AppContext), pas
// dans celle de l'éditeur : le composant les transforme lui-même via
// syncCampaignsFromContext, et c'est ce chemin qu'on veut couvrir.
//
// Ces tests s'appuyaient auparavant sur EDITOR_FALLBACK, un jeu de démo codé
// en dur dans la page. Il n'est plus utilisé : sans campagne, l'éditeur
// affiche désormais un état vide. D'où l'injection explicite ci-dessous.
const CAMPAIGNS = {
  'daf-idf': {
    name: 'DAF Ile-de-France',
    channel: 'email',
    status: 'active',
    iteration: 4,
    position: 'DAF',
    sectorShort: 'Comptabilite',
    size: '11-50 sal.',
    angle: 'Douleur client',
    tone: 'Pro décontracté',
    formality: 'Vous',
    length: 'Court (3 phrases)',
    cta: 'Question ouverte',
    sequence: [
      { id: 'E1', type: 'email', label: 'Email initial', timing: 'J+0', subType: 'Angle douleur client', subject: 'Sujet 1', body: 'Corps 1' },
      { id: 'E2', type: 'email', label: 'Relance', timing: 'J+3', subType: 'Preuve sociale', subject: 'Sujet 2', body: 'Corps 2' },
      { id: 'E3', type: 'email', label: 'Relance 2', timing: 'J+7', subType: 'Angle anxiogène', subject: 'Sujet 3', body: 'Corps 3' },
      { id: 'E4', type: 'email', label: 'Break-up', timing: 'J+14', subType: 'Clôture', subject: 'Sujet 4', body: 'Corps 4' },
    ],
  },
  'dirigeants': {
    name: 'Dirigeants Formation',
    channel: 'linkedin',
    status: 'active',
    iteration: 2,
    position: 'Dirigeant',
    sectorShort: 'Formation',
    sequence: [
      { id: 'L1', type: 'linkedin', label: 'Invitation', timing: 'J+0', body: 'Note 1', maxChars: 280 },
      { id: 'L2', type: 'linkedin', label: 'Message', timing: 'J+2', body: 'Note 2', maxChars: 600 },
    ],
  },
  'drh-lyon': {
    name: 'DRH PME Lyon',
    channel: 'email',
    status: 'prep',
    position: 'DRH',
    sectorShort: 'RH',
    sequence: [
      { id: 'P1', type: 'email', label: 'Email initial', timing: 'J+0', subject: 'Sujet P1', body: 'Corps P1' },
    ],
  },
};

vi.mock('../../context/useApp', () => ({
  useApp: () => ({
    campaigns: CAMPAIGNS,
    backendAvailable: false,
    setCampaigns: vi.fn(),
  }),
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
    // Le composant compose « 4 touchpoints · Itération 4 » — accentué.
    expect(screen.getByText(/Itération 4/)).toBeInTheDocument();
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

  it('renders Paramètres and Tout régénérer buttons', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: 'Paramètres' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tout régénérer' })).toBeInTheDocument();
  });

  it('shows params panel when clicking Paramètres', () => {
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }));

    expect(screen.getByText('Paramètres de la campagne')).toBeInTheDocument();
  });

  it('hides params panel when clicking Fermer', () => {
    renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }));
    expect(screen.getByText('Paramètres de la campagne')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Paramètres de la campagne')).not.toBeInTheDocument();
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

  // Supprimés : « renders AI suggestion bar » et « renders touchpoint AI
  // suggestions inline ». syncCampaignsFromContext force `aiBar: null` et
  // `suggestion: null` — aucune donnée réelle ne peut plus les renseigner.
  // Ces deux tests ne passaient qu'avec l'ancien jeu de démo codé en dur ; les
  // rétablir demanderait d'abord de rebrancher la fonctionnalité côté produit.

  it('renders LaunchBar for prep campaigns', () => {
    renderEditor();

    // Switch to DRH PME Lyon (prep)
    fireEvent.click(screen.getByText('DRH PME Lyon'));

    expect(screen.getByText(/Séquence prête/)).toBeInTheDocument();
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
