/**
 * L'écran des COMPTES · lot 2.
 *
 * Trois choses que cette page doit dire, et qu'aucun autre écran ne disait :
 *
 * 1. Ce qu'une société pèse, tous contacts confondus. Avant, une entreprise
 *    n'existait que comme texte répété sur chacun de ses interlocuteurs.
 * 2. Qu'elle porte À LA FOIS un deal gagné et un deal ouvert · c'est la
 *    définition de l'upsell, et c'était invisible.
 * 3. Depuis quand elle est silencieuse, au niveau du COMPTE. Un compte n'est
 *    pas silencieux parce qu'un de ses contacts l'est (arbitrage du 29/09) :
 *    la date affichée est la plus récente de tous ses contacts.
 *
 * Et une chose qu'elle doit dire honnêtement : quand un compte a été
 * reconstruit depuis un nom faute d'objet société côté CRM, ça se voit.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AccountsPage from '../AccountsPage';
import { I18nProvider } from '../../i18n';
import { request } from '../../services/api-client';

vi.mock('../../services/auth', () => ({
  isLoggedIn: () => true,
  getUser: () => ({ id: 'u1', email: 'goran@baakal.ai' }),
  getToken: () => 'token',
  getRefreshToken: () => null,
}));

vi.mock('../../services/api-client', () => ({ request: vi.fn(), default: {} }));

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const COMPTES = [
  {
    id: 'a1', name: 'Dunelia Systemes SAS', owner_email: 'goran@baakal.ai', source: 'crm',
    contacts: 4, deals_gagnes: 1, deals_ouverts: 2, montant: '171100', last_activity_at: iso(3),
  },
  {
    id: 'a2', name: 'Atelier Kerveil', owner_email: null, source: 'derived',
    contacts: 1, deals_gagnes: 0, deals_ouverts: 1, montant: '23400', last_activity_at: iso(95),
  },
];

function mockApi(accounts = COMPTES) {
  request.mockImplementation((url) =>
    url.startsWith('/crm/accounts') ? Promise.resolve({ accounts }) : Promise.resolve({})
  );
}

const renderPage = () => render(
  <MemoryRouter><I18nProvider><AccountsPage /></I18nProvider></MemoryRouter>
);

describe('AccountsPage', () => {
  beforeEach(() => {
    // Sans ça l'app rend en anglais et les assertions portent sur des libellés
    // qui n'existent pas · même réglage que ClientsPage.test.jsx.
    localStorage.setItem('baakalai_lang', 'fr');
    vi.clearAllMocks();
    mockApi();
  });

  it('liste les sociétés, pas les personnes', async () => {
    renderPage();
    await screen.findByText('Dunelia Systemes SAS');
    expect(screen.getByText('Atelier Kerveil')).toBeTruthy();
  });

  it('montre gagné et en cours côte à côte, ce qui rend l\'upsell visible', async () => {
    renderPage();
    await screen.findByText('Dunelia Systemes SAS');
    // Un compte qui porte un deal gagné ET un deal ouvert : c'est le signal
    // upsell, et aucun écran ne le montrait avant celui-ci.
    expect(screen.getByText(/1 gagné/)).toBeTruthy();
    expect(screen.getByText(/2 en cours/)).toBeTruthy();
  });

  it('dit quand une société a été reconstruite plutôt que lue', async () => {
    renderPage();
    await screen.findByText('Atelier Kerveil');
    // Un compte dérivé n'a pas la même valeur de preuve qu'un compte lu dans le
    // CRM. Le taire reviendrait à présenter une déduction comme un fait.
    expect(screen.getByText(/société reconstruite/)).toBeTruthy();
  });

  it('ne colle pas l\'étiquette « reconstruite » à un compte lu dans le CRM', async () => {
    renderPage();
    await screen.findByText('Dunelia Systemes SAS');
    const lu = screen.getByText('Dunelia Systemes SAS').parentElement;
    expect(lu.textContent).not.toMatch(/société reconstruite/);
  });

  it('cumule le pipeline de tous les comptes dans le sous-titre', async () => {
    renderPage();
    // 171 100 + 23 400 · un total qu'aucun écran ne donnait, puisque personne
    // ne savait ce qu'était une société.
    await waitFor(() => expect(screen.getByText(/194\s?500/)).toBeTruthy());
  });

  it('explique le vide au lieu de laisser une page blanche', async () => {
    mockApi([]);
    renderPage();
    // Une liste vide sans explication se lit comme une panne, alors que c'est
    // simplement un CRM pas encore lu.
    await screen.findByText(/Aucune société pour l'instant/);
  });

  it('affiche le silence du compte, pas celui d\'un contact', async () => {
    renderPage();
    await screen.findByText('Dunelia Systemes SAS');
    // 3 jours vient du contact le PLUS récent des quatre, pas du plus discret.
    expect(screen.getByText(/3 j sans contact/)).toBeTruthy();
    expect(screen.getByText(/95 j sans contact/)).toBeTruthy();
  });
});
