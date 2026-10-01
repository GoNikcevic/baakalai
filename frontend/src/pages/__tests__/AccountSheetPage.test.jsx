import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountSheetPage from '../AccountSheetPage';
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

const DAY = 86400000;
const iso = (joursAvant) => new Date(Date.now() - joursAvant * DAY).toISOString();

/** La fiche telle que GET /crm/accounts/:id la rend. */
function fiche(over = {}) {
  return {
    compte: {
      id: 'a1', name: 'Verdoux Benali', domain: null, industry: 'Industrie',
      source: 'crm', crmProvider: 'pipedrive', ownerEmail: 'goran@baakal.ai',
      crmCreatedAt: iso(420), lastActivityAt: iso(74),
      churnScore: 64, churnFactors: [
        { signal: 'inactivity', weight: 18, detail: '74d sans activite' },
        { signal: 'status_won_offset', weight: -15, detail: 'Client actif (won), risque reduit' },
        { signal: 'activity_source', weight: 0, detail: 'Derniere activite portee par claire@vb.fr, 74d' },
      ],
      churnScoredAt: iso(1), churnFlaggedAt: iso(7),
      ...over.compte,
    },
    affaires: over.affaires ?? [
      { id: 'd1', name: 'Extension 3 sites', status: 'open', deal_value: 24200, currency: 'EUR', crm_stage: 'Negociation', crm_updated_at: iso(61) },
      { id: 'd2', name: 'Renouvellement annuel', status: 'won', deal_value: 35900, currency: 'EUR', crm_stage: 'Won', won_date: iso(80) },
    ],
    contacts: over.contacts ?? [
      { id: 'c1', name: 'Claire Benali', email: 'claire@vb.fr', title: 'Directrice des achats', account_role: 'decision_maker', is_primary_contact: true, last_activity_at: iso(74) },
      { id: 'c2', name: 'Thomas Verdoux', email: 'thomas@vb.fr', title: 'Exploitation', account_role: 'operational', is_primary_contact: false, last_activity_at: iso(112) },
    ],
    resume: {
      ouvert: 24200, gagne: 35900, perdu: 0,
      affairesOuvertes: 1, affairesGagnees: 1, upsell: true,
      devises: ['EUR'], devisesMelangees: false,
      contacts: 2, joignables: 2, injoignable: false, sansInterlocuteur: false,
      champsManquants: ['domain'],
      ...over.resume,
    },
  };
}

function monter(id = 'a1') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[`/accounts/${id}`]}>
        <Routes>
          <Route path="/accounts/:id" element={<AccountSheetPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );
}

describe('Fiche compte', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Le Provider suit navigator.language, qui vaut en-US sous jsdom : sans
    // cette ligne la page rend en anglais et toute assertion en francais
    // echoue. Meme convention que ClientsPage.test.jsx.
    localStorage.setItem('baakalai_lang', 'fr');
  });

  it('montre le gagne et l ouvert ensemble, et nomme l upsell', async () => {
    request.mockResolvedValue(fiche());
    monter();

    // Les deux affaires coexistent : c'est tout l'interet de lire `deals` et
    // non la ligne du contact, qui ne portait qu'un montant et qu'un statut.
    await waitFor(() => expect(screen.getByText('Extension 3 sites')).toBeTruthy());
    expect(screen.getByText('Renouvellement annuel')).toBeTruthy();
    expect(screen.getByText(/Upsell possible/i)).toBeTruthy();
    // L'ouvert passe avant le gagne : c'est ce sur quoi on peut encore agir.
    const noms = screen.getAllByText(/Extension 3 sites|Renouvellement annuel/);
    expect(noms[0].textContent).toBe('Extension 3 sites');
  });

  it('un compte jamais score le DIT au lieu de passer pour sain', async () => {
    request.mockResolvedValue(fiche({
      compte: { churnScore: null, churnFactors: [] },
      resume: { sansInterlocuteur: false, injoignable: false },
    }));
    monter();

    await waitFor(() => expect(screen.getByText(/Non scoré/i)).toBeTruthy());
    // Zero ne doit apparaitre nulle part comme score : NULL n'est pas zero.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('sans interlocuteur, la fiche explique pourquoi le compte n est pas scorable', async () => {
    request.mockResolvedValue(fiche({
      compte: { churnScore: null, churnFactors: [] },
      contacts: [],
      resume: { contacts: 0, joignables: 0, injoignable: null, sansInterlocuteur: true, upsell: false },
    }));
    monter();

    await waitFor(() => expect(screen.getByText(/Non scorable/i)).toBeTruthy());
    expect(screen.getByText(/Aucun interlocuteur rattaché/i)).toBeTruthy();
    // « injoignable » ne doit PAS s'afficher : sans contact, c'est inconnu, pas vrai.
    expect(screen.queryByText(/^Injoignable$/)).toBeNull();
  });

  it('des contacts dont les adresses ont rebondi donnent un compte injoignable', async () => {
    request.mockResolvedValue(fiche({
      contacts: [
        { id: 'c1', name: 'Claire Benali', email: 'claire@vb.fr', is_primary_contact: true, last_activity_at: iso(74), email_bounced_at: iso(30) },
      ],
      resume: { contacts: 1, joignables: 0, injoignable: true },
    }));
    monter();

    await waitFor(() => expect(screen.getByText(/^Injoignable$/)).toBeTruthy());
    expect(screen.getByText(/adresse invalide/i)).toBeTruthy();
  });

  it('deux devises sont signalees et non additionnees', async () => {
    request.mockResolvedValue(fiche({
      resume: { devises: ['EUR', 'USD'], devisesMelangees: true },
    }));
    monter();

    await waitFor(() => expect(screen.getByText(/EUR, USD/)).toBeTruthy());
    expect(screen.getByText(/ne sont pas additionnés/i)).toBeTruthy();
  });

  it('la decomposition du score nomme le contact qui a maintenu le compte en vie', async () => {
    request.mockResolvedValue(fiche());
    monter();

    // C'est ce facteur qui rend l'arbitrage du 01/10 revisable sans migration.
    await waitFor(() => expect(screen.getByText(/Derniere activite portee par claire@vb.fr/)).toBeTruthy());
    expect(screen.getByText('+18')).toBeTruthy();
    expect(screen.getByText('-15')).toBeTruthy();
  });

  it('un compte introuvable ne montre pas un ecran vide', async () => {
    request.mockRejectedValue(new Error('404'));
    monter('inconnu');

    // Un ecran blanc laisse croire a une panne. Il faut le dire.
    await waitFor(() => expect(screen.getByText(/Société introuvable/i)).toBeTruthy());
    expect(screen.getByText(/Retour aux clients/i)).toBeTruthy();
  });

  it('les champs manquants sont ceux de la societe, corriges une seule fois', async () => {
    request.mockResolvedValue(fiche({ resume: { champsManquants: ['industry', 'domain'], contacts: 2 } }));
    monter();

    await waitFor(() => expect(screen.getByText(/secteur, domaine web/i)).toBeTruthy());
    expect(screen.getByText(/une seule fois, pour les 2 interlocuteurs/i)).toBeTruthy();
  });
});
