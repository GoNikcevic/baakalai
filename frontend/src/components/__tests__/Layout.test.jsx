import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import Layout from '../Layout';
import { AppProvider } from '../../context/AppContext';
import { NotificationProvider } from '../../context/NotificationContext';
import { I18nProvider } from '../../i18n';

// Assertions below are on the French labels — force fr before I18nProvider reads it
localStorage.setItem('baakalai_lang', 'fr');

// Mock auth service so AppProvider doesn't hit localStorage issues
vi.mock('../../services/auth', () => ({
  isLoggedIn: () => true,
  getUser: () => ({ name: 'Goran', email: 'goran@test.com', role: 'demo' }),
  getToken: () => 'demo-token',
  getRefreshToken: () => null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));

// Mock api-client to prevent real network calls
vi.mock('../../services/api-client', () => ({
  default: {
    checkHealth: vi.fn().mockResolvedValue(null),
  },
  request: vi.fn().mockResolvedValue({}),
}));

// Mock useSocketEvents to avoid needing full socket infrastructure
vi.mock('../../hooks/useSocketEvents', () => ({
  useSocketEvents: () => {},
}));

// Mock socket service
vi.mock('../../services/socket', () => ({
  disconnect: vi.fn(),
  connect: vi.fn(),
  reconnect: vi.fn(),
  getSocket: vi.fn(),
}));

function renderLayout(initialRoute = '/dashboard') {
  return render(
    <I18nProvider>
      <AppProvider>
        <NotificationProvider>
          <MemoryRouter initialEntries={[initialRoute]}>
            <Layout />
          </MemoryRouter>
        </NotificationProvider>
      </AppProvider>
    </I18nProvider>
  );
}

describe('Layout', () => {
  it('renders sidebar nav links', () => {
    renderLayout();

    expect(screen.getByText('Assistant')).toBeInTheDocument();
    // "Dashboard" appears in both sidebar and mobile nav, so use getAllByText
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Prospection').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Paramètres').length).toBeGreaterThanOrEqual(1);

    // Analytics vit sous la section CRM, repliee par defaut a l'arrivee sur
    // la plateforme : il faut l'ouvrir pour voir ses enfants.
    fireEvent.click(screen.getByText('CRM'));
    expect(screen.getAllByText('Analytics').length).toBeGreaterThanOrEqual(1);
  });

  it('expose une vue globale sous Deals comme sous Clients', () => {
    renderLayout();

    // Deals et Clients sont deux populations de la meme table `opportunities` :
    // chacune a sa vue globale, cadree par la route (/deals vs /clients).
    // Les sections sont repliees par defaut : on les ouvre avant d'asserter.
    fireEvent.click(screen.getByText('Deals'));
    fireEvent.click(screen.getByText('Clients'));
    expect(screen.getAllByText('Vue globale').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the brand logo', () => {
    renderLayout();

    expect(screen.getByText('baakalai')).toBeInTheDocument();
  });

  it('n affiche plus de bouton de creation de campagne dans la sidebar', () => {
    renderLayout();

    // Le formulaire fige qu'il ouvrait ignorait le CRM. La creation passe
    // desormais par l'Assistant ou par l'onglet dedie de Prospection.
    expect(screen.queryByText('+ Nouvelle campagne')).not.toBeInTheDocument();
  });

  it('renders user info when user is logged in', () => {
    renderLayout();

    expect(screen.getByText('Goran')).toBeInTheDocument();
    expect(screen.getByText('goran@test.com')).toBeInTheDocument();
  });

  it('renders user initial in avatar', () => {
    renderLayout();

    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('renders mobile navigation items', () => {
    renderLayout();

    expect(screen.getByText('Chat')).toBeInTheDocument();
    // "Prospection" appears in both sidebar and mobile nav
    expect(screen.getAllByText('Prospection').length).toBeGreaterThanOrEqual(2);
    // "Activation" appears in both sidebar and mobile nav
    expect(screen.getAllByText('Activation').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the main content outlet area', () => {
    renderLayout();

    const main = document.querySelector('main.main');
    expect(main).toBeInTheDocument();
  });
});
