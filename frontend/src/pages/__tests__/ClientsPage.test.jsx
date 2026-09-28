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
 * `churnData` inexistant coupait loadData en route, et `crmProviderCounts`, lu
 * hors de sa portée, faisait planter le panneau de détail au clic. Les deux
 * étaient avalées, l'une par un `catch {}` vide, l'autre par l'ErrorBoundary.
 * D'où ces garde-fous.
 */
describe('ClientsPage · chargement complet', () => {
  it('va jusqu\'au bout de loadData sans rien avaler', async () => {
    // loadData ne se termine plus sur une requête repérable (la barre de tête
    // n'interroge plus /crm/stages) : le garde-fou porte désormais sur le
    // `console.error` du catch, seul endroit où une exception atterrit.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDeals();
    await screen.findByText('Marie Dupont');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
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

  /**
   * La barre de tête affichait une tuile par étape de pipeline CRM : sur un
   * Salesforce standard ça faisait plus de seize tuiles, illisibles et toutes à
   * zéro faute de crm_stage_id rempli. Elle est désormais un jeu fixe de quatre
   * segments de silence, indépendant du CRM branché.
   */
  it('affiche quatre tuiles de silence, jamais les étapes du CRM', async () => {
    mockApi({ stages: [{ id: 's1', name: 'Qualification', order: 0, pipelineName: null }] });
    renderDeals();

    await screen.findByText('Marie Dupont');
    expect(screen.queryByText('Qualification')).toBeNull();
    for (const label of ['Actifs', 'Dorment (30 j+)', 'Au point mort (60 j+)', 'Perdus']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('ne compte pas le client gagné dans les tuiles de tête', async () => {
    renderDeals();
    await screen.findByText('Marie Dupont');
    // Paul Gagnant est silencieux depuis 3 jours : sans la restriction à la
    // portée Deals, il gonflerait « Actifs », qui ne doit compter que Claire
    // Mercier (4 j). Ahmed (61 j) et Marie (142 j) sont au point mort.
    const countOf = (label) => screen.getByText(label).closest('button').textContent.replace(label, '');
    expect(countOf('Actifs')).toBe('1');
    expect(countOf('Dorment (30 j+)')).toBe('0');
    expect(countOf('Au point mort (60 j+)')).toBe('2');
    expect(countOf('Perdus')).toBe('0');
  });
});

function renderClients() {
  localStorage.setItem('baakalai_lang', 'fr');
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ClientsPage scope="clients" />
      </I18nProvider>
    </MemoryRouter>
  );
}

/**
 * Les chiffres de la barre de tête ne servaient à rien : on lisait « 8 » sans
 * pouvoir voir lesquels. Chaque tuile est donc un filtre. Sous Clients, les
 * segments sont ceux d'un contrat signé ; sous Deals, les tranches de silence.
 */
describe('ClientsPage · tuiles de tête cliquables', () => {
  it('filtre la liste sur la tranche de silence cliquée, et la rend au clic suivant', async () => {
    mockApi({
      opportunities: [
        // 30 et 60 jours pile sont les bornes : strictes, comme les libellés
        // « plus de 30 jours ». À 30 j on est encore actif, à 61 j au point mort.
        { id: 'a1', name: 'Alice Fraiche', status: 'interested', last_activity_at: iso(30) },
        { id: 'b1', name: 'Bob Endormi', status: 'interested', last_activity_at: iso(45) },
        { id: 'c1', name: 'Carl Immobile', status: 'interested', last_activity_at: iso(61) },
        { id: 'd1', name: 'Diane Perdue', status: 'lost', last_activity_at: iso(90) },
      ],
    });
    renderDeals();

    await screen.findByText('Alice Fraiche');
    expect(screen.getByText('Bob Endormi')).toBeTruthy();

    fireEvent.click(screen.getByText('Dorment (30 j+)').closest('button'));
    await waitFor(() => expect(screen.queryByText('Alice Fraiche')).toBeNull());
    expect(screen.getByText('Bob Endormi')).toBeTruthy();
    expect(screen.queryByText('Carl Immobile')).toBeNull();

    fireEvent.click(screen.getByText('Dorment (30 j+)').closest('button'));
    await screen.findByText('Alice Fraiche');
  });

  it('range le deal perdu dans sa seule tuile, jamais aussi dans une tranche de silence', async () => {
    mockApi({
      opportunities: [
        { id: 'c1', name: 'Carl Immobile', status: 'interested', last_activity_at: iso(61) },
        { id: 'd1', name: 'Diane Perdue', status: 'lost', last_activity_at: iso(90) },
      ],
    });
    renderDeals();

    await screen.findByText('Carl Immobile');
    // Diane est muette depuis 90 jours : sans l'exclusion des perdus, elle
    // apparaîtrait à la fois dans « Au point mort » et dans « Perdus ».
    const countOf = (label) => screen.getByText(label).closest('button').textContent.replace(label, '');
    expect(countOf('Au point mort (60 j+)')).toBe('1');
    expect(countOf('Perdus')).toBe('1');
  });

  it('affiche les segments clients, pas les tranches de silence des deals, sous Clients', async () => {
    mockApi({
      opportunities: [
        { id: 'c1', name: 'Claire Recente', status: 'won', won_date: iso(10), last_activity_at: iso(5) },
        { id: 'c2', name: 'Silvain Silence', status: 'won', won_date: iso(400), last_activity_at: iso(200) },
      ],
    });
    renderClients();

    await screen.findByText('Claire Recente');
    // Un contrat signé ne « dort » pas au sens du pipeline : il est silencieux.
    expect(screen.queryByText('Dorment (30 j+)')).toBeNull();

    fireEvent.click(screen.getByText('Silencieux (90 j+)').closest('button'));
    await waitFor(() => expect(screen.queryByText('Claire Recente')).toBeNull());
    expect(screen.getByText('Silvain Silence')).toBeTruthy();
  });
});
