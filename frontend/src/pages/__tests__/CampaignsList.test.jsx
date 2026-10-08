import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CampaignsList from '../CampaignsList';
import { AppProvider } from '../../context/AppContext';

// L'utilisateur courant est une référence mutable, et non une valeur figée : les
// onglets de cette page dépendent de son rôle d'équipe, donc un test doit
// pouvoir le changer. `vi.hoisted` est nécessaire parce que `vi.mock` est remonté
// au-dessus des imports, avant toute déclaration de module.
const { utilisateur } = vi.hoisted(() => ({ utilisateur: { courant: null } }));

// Mock auth service
vi.mock('../../services/auth', () => ({
  isLoggedIn: () => false,
  getUser: () => utilisateur.courant,
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
}));

// Mock useApp to control campaigns and projects data
const mockCampaigns = {
  'camp-1': {
    id: 'camp-1',
    name: 'DAF Ile-de-France',
    status: 'active',
    channel: 'email',
    sectorShort: 'Finance',
    size: '11-50 sal.',
    angle: 'Douleur client',
    startDate: '3 mars',
    channelLabel: 'Email',
    channelColor: 'var(--blue)',
    projectId: 'proj-1',
    kpis: { openRate: 54, replyRate: 7.2, contacts: 247 },
    volume: { sent: 247, planned: 300 },
  },
  'camp-2': {
    id: 'camp-2',
    name: 'Dirigeants Formation',
    status: 'active',
    channel: 'linkedin',
    sectorShort: 'Formation',
    size: '1-10 sal.',
    angle: 'Preuve sociale',
    startDate: '10 fev',
    channelLabel: 'LinkedIn',
    channelColor: 'var(--purple)',
    projectId: 'proj-1',
    kpis: { replyRate: 6.8, contacts: 84 },
    volume: { sent: 84, planned: 100 },
  },
  'camp-3': {
    id: 'camp-3',
    name: 'DRH PME Lyon',
    status: 'prep',
    channel: 'multi',
    sectorShort: 'Conseil RH',
    size: '51-200 sal.',
    angle: 'Offre directe',
    startDate: '8 mars',
    channelLabel: 'Multi',
    channelColor: 'var(--orange)',
    projectId: null,
  },
};

const mockProjects = {
  'proj-1': {
    id: 'proj-1',
    name: 'Projet Finance',
    description: 'Campagnes finance IDF',
    color: '#60a5fa',
    files: [],
  },
};

vi.mock('../../context/useApp', () => ({
  useApp: () => ({
    campaigns: mockCampaigns,
    projects: mockProjects,
  }),
}));

function renderList(props = {}) {
  // L'écran par défaut de /campaigns est désormais l'assistant de création ;
  // ces tests portent sur la liste (onglet Historique), ciblée via openHistory.
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/campaigns', state: { openHistory: true } }]}>
      <CampaignsList onNavigateCampaign={vi.fn()} {...props} />
    </MemoryRouter>
  );
}

describe('CampaignsList', () => {
  it('renders campaign count', () => {
    renderList();

    expect(screen.getByText(/3 campagnes/)).toBeInTheDocument();
    expect(screen.getByText(/1 projet/)).toBeInTheDocument();
  });

  it('renders all campaign names', () => {
    renderList();

    expect(screen.getByText('DAF Ile-de-France')).toBeInTheDocument();
    expect(screen.getByText('Dirigeants Formation')).toBeInTheDocument();
    expect(screen.getByText('DRH PME Lyon')).toBeInTheDocument();
  });

  it('renders filter buttons', () => {
    renderList();

    expect(screen.getByText('Filtrer :')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toutes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'En préparation' })).toBeInTheDocument();
  });

  it('filters to show only active campaigns', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));

    expect(screen.getByText('DAF Ile-de-France')).toBeInTheDocument();
    expect(screen.getByText('Dirigeants Formation')).toBeInTheDocument();
    // Prep campaign should not appear in campaign rows
    // (it may still appear in project group header text)
    const rows = document.querySelectorAll('.campaign-row');
    const rowNames = [...rows].map((r) => r.textContent);
    const hasDRH = rowNames.some((t) => t.includes('DRH PME Lyon'));
    expect(hasDRH).toBe(false);
  });

  it('filters to show only prep campaigns', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'En préparation' }));

    const rows = document.querySelectorAll('.campaign-row');
    const rowTexts = [...rows].map((r) => r.textContent);
    expect(rowTexts.some((t) => t.includes('DRH PME Lyon'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('DAF Ile-de-France'))).toBe(false);
  });

  it('renders project group headers', () => {
    renderList();

    expect(screen.getByText('Projet Finance')).toBeInTheDocument();
    expect(screen.getByText('Sans projet')).toBeInTheDocument();
  });

  it('shows active status badge for active campaigns', () => {
    renderList();

    const activeBadges = document.querySelectorAll('.status-active');
    expect(activeBadges.length).toBe(2);
  });

  it('shows prep status badge for prep campaigns', () => {
    renderList();

    const prepBadges = document.querySelectorAll('.status-prep');
    expect(prepBadges.length).toBe(1);
  });

  it('renders sort button', () => {
    renderList();

    expect(screen.getByRole('button', { name: /Trier par réponse/ })).toBeInTheDocument();
  });

  it('toggles sort on click', () => {
    renderList();

    const sortBtn = screen.getByRole('button', { name: /Trier par réponse/ });
    fireEvent.click(sortBtn);

    expect(screen.getByRole('button', { name: /Tri par réponse/ })).toBeInTheDocument();
  });

  it('calls onNavigateCampaign when clicking a campaign row', () => {
    const onNavigate = vi.fn();
    renderList({ onNavigateCampaign: onNavigate });

    const rows = document.querySelectorAll('.campaign-row');
    fireEvent.click(rows[0]);

    expect(onNavigate).toHaveBeenCalled();
  });

  it('collapses project group on header click', () => {
    renderList();

    // Initially campaigns should be visible
    expect(screen.getByText('DAF Ile-de-France')).toBeInTheDocument();

    // Click project header to collapse
    fireEvent.click(screen.getByText('Projet Finance'));

    // Campaigns inside should be hidden
    expect(screen.queryByText('DAF Ile-de-France')).not.toBeInTheDocument();
  });

  it('shows audience count for campaigns with volume', () => {
    renderList();

    expect(screen.getByText('247 prospects')).toBeInTheDocument();
    expect(screen.getByText('84 prospects')).toBeInTheDocument();
  });
});

describe('CampaignsList, onglets selon le role d equipe', () => {
  // `utilisateur.courant` est global au fichier : le laisser posé ferait basculer
  // les tests suivants en non-admin sans qu'ils le demandent.
  afterEach(() => { utilisateur.courant = null; });

  it('un commercial garde l acces a l historique de ses campagnes', () => {
    // Le defaut que ce test tient : la page rendait l'assistant SEUL a un
    // non-admin, sans onglets. Il creait sa campagne, l'activait depuis sa
    // fiche, puis n'avait plus aucun chemin pour y revenir ni pour la mettre en
    // pause. La liste est cloisonnee cote API (GET /api/campaigns filtre sur
    // req.user.id), donc la lui rendre ne lui montre pas celle d'un collegue.
    utilisateur.courant = { teamRole: 'prospection' };
    renderList();

    expect(screen.getByRole('button', { name: 'Historique' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer une campagne' })).toBeInTheDocument();
    // Et l'historique rend bien ses campagnes, pas une page vide.
    expect(screen.getByText('DAF Ile-de-France')).toBeInTheDocument();
  });

  it('un commercial ne voit ni Autopilot ni Campagnes equipe', () => {
    // Autopilot regle une politique d'envoi pour toute la portee, et les routes
    // des campagnes equipe repondent 403 a un non-admin : afficher ces onglets
    // serait proposer des boutons qui echouent.
    utilisateur.courant = { teamRole: 'prospection' };
    renderList();

    expect(screen.queryByRole('button', { name: /Autopilot/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Campagnes équipe' })).not.toBeInTheDocument();
  });

  it('un viewer garde le meme acces en lecture', () => {
    utilisateur.courant = { teamRole: 'viewer' };
    renderList();

    expect(screen.getByRole('button', { name: 'Historique' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Campagnes équipe' })).not.toBeInTheDocument();
  });

  it('un admin voit les quatre onglets', () => {
    // Le controle positif : sans lui, masquer les onglets a tout le monde ferait
    // passer les deux tests precedents.
    utilisateur.courant = { teamRole: 'admin' };
    renderList();

    expect(screen.getByRole('button', { name: 'Créer une campagne' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Historique' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Autopilot/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Campagnes équipe' })).toBeInTheDocument();
  });

  it('un utilisateur sans equipe voit les quatre onglets', () => {
    // Un compte solo n'a pas de teamRole et doit garder le produit complet.
    utilisateur.courant = { teamRole: null };
    renderList();

    expect(screen.getByRole('button', { name: /Autopilot/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Campagnes équipe' })).toBeInTheDocument();
  });
});

describe('CampaignsList, filtered empty', () => {
  it('shows no-result message when filter matches nothing', () => {
    renderList();

    // Apply "En préparation" filter, then "Active" · toggle quickly
    fireEvent.click(screen.getByRole('button', { name: 'En préparation' }));

    // Prep campaigns should show, active ones hidden from rows
    const rows = document.querySelectorAll('.campaign-row');
    const rowTexts = [...rows].map((r) => r.textContent);
    expect(rowTexts.some((t) => t.includes('DRH PME Lyon'))).toBe(true);
  });
});
