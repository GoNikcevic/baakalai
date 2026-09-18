import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { request } from '../../services/api-client';
import WeeklyWorkCard from '../WeeklyWorkCard';

vi.mock('../../services/api-client', () => ({
  request: vi.fn(),
}));

const RATES = { accountsReviewed: 1, signals: 4, followUps: 8, issuesFound: 2, analyses: 15 };

/** Semaine type, du lundi au vendredi après-midi. */
function activity(overrides = {}) {
  return {
    range: {
      start: '2026-09-14T00:00:00.000Z', end: '2026-09-18T15:00:00.000Z',
      weekStart: '2026-09-14', weekEnd: '2026-09-20', partial: true,
    },
    counters: {
      accountsReviewed: 412, signals: 38, followUps: 17, issuesFound: 63,
      analyses: 4, scoresRecalculated: 318, followUpsSent: 12,
    },
    minutes: 886,
    results: {
      reactivatedCount: 3, reactivatedValue: 28400, replies: 5, churnAlerts: 1,
      items: [
        { kind: 'reactivated', id: 'o1', company: 'Menuiseries Aubert', value: 12000 },
        { kind: 'reply', company: 'Vermont SAS' },
        { kind: 'churn', id: 'o2', company: 'Cabinet Reynaud', score: 72 },
      ],
    },
    pending: { approvals: 4, approvalsOldestDays: 3, drafts: 0, noEmail: 12 },
    daily: [62, 48, 71, 55, 44, 0, 0],
    hasResults: true,
    hasWork: true,
    rates: RATES,
    previous: { counters: { signals: 27 }, minutes: 700, results: {} },
    delta: { signals: 40, minutes: 26, followUps: 10 },
    ...overrides,
  };
}

const renderCard = () => render(<MemoryRouter><WeeklyWorkCard /></MemoryRouter>);

describe('WeeklyWorkCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ouvre sur le résultat, pas sur le volume de travail', async () => {
    request.mockResolvedValue(activity());
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/fait repartir 3 deals dormants/)).toBeInTheDocument();
    });
    expect(screen.getByText(/28 400 € de pipeline touché/)).toBeInTheDocument();
    expect(screen.getByText(/obtenu 5 réponses/)).toBeInTheDocument();
  });

  it('affiche le total arrondi vers le bas et le détail par ligne', async () => {
    request.mockResolvedValue(activity());
    renderCard();
    await waitFor(() => expect(screen.getByText('14 h')).toBeInTheDocument());
    expect(screen.getByText('412 comptes relus')).toBeInTheDocument();
    expect(screen.getByText('38 signaux qualifiés')).toBeInTheDocument();
  });

  it('montre ce qui attend l utilisateur, pas seulement les réussites', async () => {
    request.mockResolvedValue(activity());
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/4 relances attendent votre validation/)).toBeInTheDocument();
    });
    expect(screen.getByText(/12 comptes sans email valide/)).toBeInTheDocument();
  });

  it('bascule sur la veille quand la semaine n a rien produit', async () => {
    request.mockResolvedValue(activity({
      results: { reactivatedCount: 0, reactivatedValue: 0, replies: 0, churnAlerts: 0, items: [] },
      hasResults: false,
    }));
    renderCard();
    await waitFor(() => {
      expect(screen.getByText(/a relu 412 comptes sans rien trouver/)).toBeInTheDocument();
    });
    expect(screen.getByText('Veille')).toBeInTheDocument();
  });

  it('reste masqué tant qu aucun agent n a travaillé', async () => {
    request.mockResolvedValue(activity({ hasWork: false, minutes: 0 }));
    const { container } = renderCard();
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(container.querySelector('.wwc')).toBeNull();
  });

  it('tait la variation quand la base de comparaison est trop petite', async () => {
    request.mockResolvedValue(activity({
      previous: { counters: { signals: 1 }, minutes: 10, results: {} },
      delta: { signals: 200, minutes: 100, followUps: null },
    }));
    renderCard();
    await waitFor(() => expect(screen.getByText('14 h')).toBeInTheDocument());
    expect(screen.queryByText(/200 %/)).toBeNull();
  });

  it('ne promet « aucun jour sans travail » que si c est vrai', async () => {
    request.mockResolvedValue(activity({ daily: [62, 0, 71, 55, 44, 0, 0] }));
    renderCard();
    await waitFor(() => expect(screen.getByText('14 h')).toBeInTheDocument());
    expect(screen.queryByText(/Aucun jour sans travail/)).toBeNull();
    expect(screen.getByText(/Activité par jour/)).toBeInTheDocument();
  });
});
