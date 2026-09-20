import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ClientsPage from '../ClientsPage';
import { I18nProvider } from '../../i18n';
import { request } from '../../services/api-client';

vi.mock('../../services/auth', () => ({
  isLoggedIn: () => true,
  getUser: () => ({ id: 'u1', email: 'goran@baakal.ai' }),
  getToken: () => 'token',
  getRefreshToken: () => null,
}));

vi.mock('../../services/api-client', () => ({
  request: vi.fn(),
  default: {},
}));

vi.mock('../../services/notifications', () => ({ showToast: vi.fn() }));

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

// Trois deals dont l'ordre de création est l'INVERSE de l'ordre de silence :
// c'est la seule façon de prouver que la liste se trie sur le silence et non
// sur ce que l'API renvoie.
const DEALS = [
  { id: 'd1', name: 'Claire Mercier', company: 'Atelier Vasseur', status: 'interested', crm_provider: 'salesforce', last_activity_at: iso(4), score: 41 },
  { id: 'd2', name: 'Ahmed Ben Salah', company: 'Novatech', status: 'negotiation', crm_provider: 'salesforce', last_activity_at: iso(61), deal_value: 45000, score: 74, crm_stage: 'Negociation', crm_stage_changed_at: iso(12) },
  { id: 'd3', name: 'Marie Dupont', company: 'Groupe Belfort', status: 'imported', crm_provider: 'salesforce', last_activity_at: iso(142), deal_value: 12000, score: 68 },
  { id: 'w1', name: 'Paul Gagnant', company: 'Deja Client', status: 'won', crm_provider: 'salesforce', last_activity_at: iso(3) },
];

function mockApi(overrides = {}) {
  request.mockImplementation((url) => {
    if (url.startsWith('/crm/providers')) return Promise.resolve({ providers: [{ provider: 'salesforce', connected: true }], activeCrm: 'salesforce' });
    if (url.startsWith('/dashboard/opportunities')) return Promise.resolve({ opportunities: overrides.opportunities || DEALS });
    if (url.startsWith('/crm/team-owners')) return Promise.resolve({ owners: [] });
    if (url.startsWith('/crm/stages')) return Promise.resolve({ stages: overrides.stages || [] });
    if (url.includes('/timeline')) return Promise.resolve({ timeline: [] });
    if (url.startsWith('/crm/client/')) return Promise.resolve({});
    if (url.startsWith('/crm/product-lines')) return Promise.resolve({ productLines: [] });
    return Promise.resolve({});
  });
}

function renderDeals() {
  localStorage.setItem('baakalai_lang', 'fr');
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ClientsPage scope="deals" />
      </I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  request.mockReset();
  mockApi();
});

/**
 * Deux ReferenceError silencieuses ont vécu onze jours dans cette page : un
 * `churnData` inexistant coupait loadData avant la requête des étapes de
 * pipeline, et `crmProviderCounts`, lu hors de sa portée, faisait planter le
 * panneau de détail au clic. Les deux étaient avalées, l'une par un `catch {}`
 * vide, l'autre par l'ErrorBoundary. D'où ces garde-fous.
 */
describe('ClientsPage · chargement complet', () => {
  it('va jusqu\'au bout de loadData, donc jusqu\'aux étapes de pipeline', async () => {
    renderDeals();
    // Cette requête est la DERNIÈRE de loadData : si elle part, rien n'a
    // interrompu la fonction en route.
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/crm/stages');
    });
  });

  it('demande la fenêtre triée par silence, pas par date de création', async () => {
    renderDeals();
    await waitFor(() => {
      const call = request.mock.calls.find(([url]) => url.startsWith('/dashboard/opportunities'));
      expect(call[0]).toContain('sort=silence');
    });
  });

  it('ouvre le panneau de détail sans planter', async () => {
    renderDeals();
    await screen.findByText('Marie Dupont');
    fireEvent.click(screen.getByText('Marie Dupont'));
    // Le panneau charge le détail du contact cliqué : preuve qu'il a été rendu.
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/crm/client/d3');
    });
  });
});

describe('ClientsPage · Vue globale Deals', () => {
  it('classe le plus long silence en premier', async () => {
    const { container } = renderDeals();
    await screen.findByText('Marie Dupont');
    // L'ordre se lit sur les chips de silence, seule information ordonnée.
    // Feuilles seulement : le span extérieur du chip porte le même texte que
    // celui qu'il contient, et chaque valeur sortirait en double.
    const silences = [...container.querySelectorAll('span')]
      .filter(el => el.children.length === 0)
      .map(el => el.textContent)
      .filter(txt => /^\d+ j sans contact$/.test(txt))
      .map(txt => parseInt(txt, 10));
    expect(silences).toEqual([142, 61, 4]);
  });

  it('affiche le montant total en annonçant combien de deals sont valorisés', async () => {
    renderDeals();
    // 45 000 + 12 000 sur 2 deals valorisés, sur 3 deals en cours.
    await screen.findByText(/57 000 . sur 2 deal/);
  });

  it('compte comme dormants les seuls deals silencieux depuis plus de 30 jours', async () => {
    renderDeals();
    await screen.findByText('2 dorment depuis plus de 30 jours');
  });

  it('exclut le client gagné de la portée Deals', async () => {
    renderDeals();
    await screen.findByText('Marie Dupont');
    expect(screen.queryByText('Paul Gagnant')).toBeNull();
  });

  it('bascule sur le montant quand on change le tri', async () => {
    const { container } = renderDeals();
    await screen.findByText('Marie Dupont');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'value' } });
    const rows = [...container.querySelectorAll('div')]
      .filter(el => el.style.fontWeight === '600' && el.textContent);
    expect(rows[0].textContent).toBe('Ahmed Ben Salah');
  });

  it('dit « aucun contact connu » plutôt que zéro jour quand la date manque', async () => {
    mockApi({ opportunities: [{ id: 'x', name: 'Sans Activite', status: 'new', last_activity_at: null }] });
    renderDeals();
    await screen.findByText('aucun contact connu');
  });

  it('ne compte pas les clients gagnés dans la barre des étapes', async () => {
    // « Paul Gagnant » (status won) tombe dans le repli par nom d'étape, qui est
    // justement le chemin où il était compté sous Deals.
    mockApi({ stages: [{ id: 's1', name: 'Won', order: 0, pipelineName: null }] });
    renderDeals();
    await screen.findByText('Won');
    const card = screen.getByText('Won').parentElement;
    expect(card.textContent).toContain('0');
  });
});
