import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsPage from '../SettingsPage';
import { AppProvider } from '../../context/AppContext';
import { NotificationProvider } from '../../context/NotificationContext';

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
  getKeys: vi.fn().mockResolvedValue({ keys: {} }),
  saveKeys: vi.fn().mockResolvedValue({ errors: [] }),
  testKeys: vi.fn().mockResolvedValue({ results: {} }),
  syncLemlist: vi.fn().mockResolvedValue({}),
  syncCRM: vi.fn().mockResolvedValue({}),
}));

// Mock socket service
vi.mock('../../services/socket', () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  getSocket: vi.fn(),
}));

function renderSettings() {
  return render(
    <AppProvider>
      <NotificationProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </NotificationProvider>
    </AppProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    // Reset document theme
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
  });

  it('renders the page title and subtitle', async () => {
    renderSettings();

    // Use regex to handle potential unicode escape differences
    await waitFor(() => {
      expect(screen.getByText(/Param.tres/)).toBeInTheDocument();
      expect(screen.getByText(/Configuration des int.grations/)).toBeInTheDocument();
    });
  });

  it('renders the save button', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeInTheDocument();
    });
  });

  it('renders core API key cards', async () => {
    renderSettings();

    // Les cartes de tête sont les outils d'outreach ; les CRM ont été
    // déplacés dans la section étendue, et « CRM » n'est plus un libellé
    // autonome dans le DOM.
    await waitFor(() => {
      expect(screen.getByText('Lemlist')).toBeInTheDocument();
      expect(screen.getByText('Apollo')).toBeInTheDocument();
    });
  });

  it('renders the integrations section title', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Intégrations')).toBeInTheDocument();
    });
  });

  it('renders preference selects', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Limite quotidienne Lemlist/)).toBeInTheDocument();
      expect(screen.getByText(/Fen.tre d'envoi/)).toBeInTheDocument();
      expect(screen.getByText(/Jours d'envoi/)).toBeInTheDocument();
      expect(screen.getByText(/Mod.le IA/)).toBeInTheDocument();
    });
  });

  // Le sélecteur de thème est devenu un simple bouton, qui affiche la cible du
  // basculement (« Sombre » quand on est en clair). Les phrases « Mode sombre
  // activé » et la classe .theme-toggle ont disparu : ces tests vérifient
  // désormais l'effet réel — l'attribut data-theme sur <html> — plutôt que la
  // formulation, qui rebougera au prochain ajustement de copie.
  it('renders the theme toggle section', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Th.me/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sombre|Clair/ })).toBeInTheDocument();
    });
  });

  it('toggles theme from dark to light', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderSettings();

    // En thème sombre, le bouton propose de passer en clair.
    const toggle = await screen.findByRole('button', { name: /Clair/ });
    fireEvent.click(toggle);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles theme back from light to dark', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    renderSettings();

    const toggle = await screen.findByRole('button', { name: /Sombre/ });
    fireEvent.click(toggle);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('renders the integrations library as collapsible section', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Voir plus d'intégrations/)).toBeInTheDocument();
    });
  });

  it('shows extended integrations when library header is clicked', async () => {
    renderSettings();

    const toggle = await screen.findByText(/Voir plus d'intégrations/);

    // La section étendue est repliée par défaut (max-height 0) : on la déplie
    // en cliquant le bouton dédié, et non plus le titre de la section.
    fireEvent.click(toggle);

    // Extended integrations should now be visible (in the DOM, even if visually hidden via CSS)
    expect(screen.getByText('DropContact')).toBeInTheDocument();
    expect(screen.getByText('Apollo')).toBeInTheDocument();
  });

  it('renders notification email input', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Email de notification')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('votre@email.com')).toBeInTheDocument();
    });
  });

  it('renders the reset preferences button', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/initialiser les pr.f.rences/)).toBeInTheDocument();
    });
  });

  it('renders the test connections button', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Tester tout/ })).toBeInTheDocument();
    });
  });
});
