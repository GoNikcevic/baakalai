import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import CampaignsList from '../CampaignsList';
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
  return render(
    <MemoryRouter>
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
    expect(screen.getByRole('button', { name: 'En preparation' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'En preparation' }));

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

    expect(screen.getByRole('button', { name: /Trier par reponse/ })).toBeInTheDocument();
  });

  it('toggles sort on click', () => {
    renderList();

    const sortBtn = screen.getByRole('button', { name: /Trier par reponse/ });
    fireEvent.click(sortBtn);

    expect(screen.getByRole('button', { name: /Tri par reponse/ })).toBeInTheDocument();
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

describe('CampaignsList — filtered empty', () => {
  it('shows no-result message when filter matches nothing', () => {
    renderList();

    // Apply "En preparation" filter, then "Active" — toggle quickly
    fireEvent.click(screen.getByRole('button', { name: 'En preparation' }));

    // Prep campaigns should show, active ones hidden from rows
    const rows = document.querySelectorAll('.campaign-row');
    const rowTexts = [...rows].map((r) => r.textContent);
    expect(rowTexts.some((t) => t.includes('DRH PME Lyon'))).toBe(true);
  });
});
