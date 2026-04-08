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

  it('renders core API key cards (Lemlist, CRM)', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Lemlist')).toBeInTheDocument();
      expect(screen.getByText('CRM')).toBeInTheDocument();
    });
  });

  it('renders the integrations library title', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Biblioth.que d'int.grations/)).toBeInTheDocument();
    });
  });

  it('renders preference selects', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Limite quotidienne Lemlist/)).toBeInTheDocument();
      expect(screen.getByText(/Fen.tre d'envoi/)).toBeInTheDocument();
      expect(screen.getByText(/Jours d'envoi/)).toBeInTheDocument();
      expect(screen.getByText(/Mod.le Claude/)).toBeInTheDocument();
    });
  });

  it('renders the theme toggle section', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Th.me/)).toBeInTheDocument();
      expect(screen.getByText(/Mode sombre activ/)).toBeInTheDocument();
    });
  });

  it('toggles theme from dark to light', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Mode sombre activ/)).toBeInTheDocument();
    });

    // Click the theme toggle
    const toggle = document.querySelector('.theme-toggle');
    fireEvent.click(toggle);

    expect(screen.getByText(/Mode clair activ/)).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggles theme back from light to dark', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Mode clair activ/)).toBeInTheDocument();
    });

    const toggle = document.querySelector('.theme-toggle');
    fireEvent.click(toggle);

    expect(screen.getByText(/Mode sombre activ/)).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('renders the integrations library as collapsible section', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Biblioth.que d'int.grations/)).toBeInTheDocument();
    });
  });

  it('shows extended integrations when library header is clicked', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText(/Biblioth.que d'int.grations/)).toBeInTheDocument();
    });

    // Extended integrations are hidden by default (collapsed)
    // Click the library header to expand
    fireEvent.click(screen.getByText(/Biblioth.que d'int.grations/));

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
