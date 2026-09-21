import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../services/api-client', () => ({ request: vi.fn() }));

import { request } from '../../services/api-client';
import HiddenRevenueCard from '../HiddenRevenueCard';

/* Les montants sont formatés avec des espaces insécables selon la locale :
   on compare donc sur le texte débarrassé de toute espace. */
const hasText = (needle) => (_, el) =>
  el?.textContent?.replace(/\s/g, '').includes(needle.replace(/\s/g, ''));

const renderCard = (props = {}) =>
  render(<MemoryRouter><HiddenRevenueCard {...props} /></MemoryRouter>);

const SNAPSHOT = {
  latest: {
    hrs: 47,
    confidence: 68,
    quantifiable: true,
    qualifiedValue: 1117000,
    expectedValue: 495750,
    expectedLow: 400566,
    expectedHigh: 590934,
    opportunityCount: 16,
    dimensions: {
      dormant_pipeline: { evaluated: true, subScore: 80, count: 16 },
      customer_reactivation: { evaluated: true, subScore: 0, count: 0 },
      customer_expansion: { evaluated: false },
      lead_reactivation: { evaluated: false },
    },
    context: { countWithoutValue: 0 },
  },
  delta: { hrs: -4, expectedValue: 12000 },
  recovered: { deals: 7, value: 38000 },
  history: [
    { snapshotAt: '2026-09-11T09:00:00Z', hrs: 51, expectedValue: 483000 },
    { snapshotAt: '2026-09-18T09:00:00Z', hrs: 47, expectedValue: 495750 },
  ],
};

describe('HiddenRevenueCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ne s affiche pas tant qu aucun snapshot n existe', async () => {
    request.mockResolvedValue({ latest: null, delta: null, recovered: { deals: 0, value: 0 }, history: [] });
    const { container } = renderCard();
    await waitFor(() => expect(request).toHaveBeenCalledWith('/hidden-revenue'));
    expect(container.textContent).toBe('');
  });

  it('reste muet si la route échoue, au lieu de casser le dashboard', async () => {
    request.mockRejectedValue(new Error('500'));
    const { container } = renderCard();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('affiche la fourchette, le score et le revenu récupéré', async () => {
    request.mockResolvedValue(SNAPSHOT);
    renderCard();
    await waitFor(() => expect(screen.getByText('47/100')).toBeInTheDocument());
    expect(screen.getByText('68%')).toBeInTheDocument();
    expect(screen.getByText(/7 deals signés après relance/)).toBeInTheDocument();
  });

  it('arrondit les montants au millier plutôt que d afficher une fausse précision', async () => {
    request.mockResolvedValue(SNAPSHOT);
    renderCard();
    // Le matcher remonte aussi sur les ancêtres : on compte les occurrences
    // plutôt que d'exiger un noeud unique.
    await waitFor(() => expect(screen.getAllByText(hasText('401000')).length).toBeGreaterThan(0));
    expect(screen.getAllByText(hasText('591000')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(hasText('400566'))).toHaveLength(0);
  });

  it('lit un score en baisse comme une bonne nouvelle', async () => {
    request.mockResolvedValue(SNAPSHOT);
    renderCard();
    await waitFor(() => expect(screen.getByText(/la réserve se vide/)).toBeInTheDocument());
  });

  it('un sous-score évalué mène à l écran qui le traite', async () => {
    request.mockResolvedValue(SNAPSHOT);
    renderCard();
    const row = await screen.findByText('Pipeline dormant');
    row.parentElement.click();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/deals-to-reactivate'));
  });

  it('une dimension non évaluée n est pas cliquable et le dit', async () => {
    request.mockResolvedValue(SNAPSHOT);
    renderCard();
    const row = await screen.findByText('Expansion client');
    expect(row.parentElement.getAttribute('role')).toBeNull();
    row.parentElement.click();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('une base trop trouée annonce le trou, pas une absence d opportunités', async () => {
    request.mockResolvedValue({
      ...SNAPSHOT,
      latest: {
        ...SNAPSHOT.latest,
        quantifiable: false,
        opportunityCount: 11,
        context: { countWithoutValue: 11 },
      },
    });
    renderCard();
    await waitFor(() => expect(screen.getByText(/Pas encore chiffrable/)).toBeInTheDocument());
    expect(screen.getByText(/11 deals n'ont aucun montant renseigné/)).toBeInTheDocument();
  });
});
