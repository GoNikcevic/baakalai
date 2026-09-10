import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import NurturePage from '../NurturePage';
import { I18nProvider } from '../../i18n';

vi.mock('../../services/auth', () => ({
  isLoggedIn: () => true,
  getUser: () => ({ id: 1, email: 'test@baakal.ai' }),
  getToken: () => 'token',
  getRefreshToken: () => null,
}));

vi.mock('../../services/api-client', () => ({
  // Le dashboard d'Activation attend `null` quand les métriques ne sont pas
  // encore calculées ; un objet vide le ferait planter sur metrics.segments.
  request: vi.fn(url => Promise.resolve(
    url.startsWith('/dashboard') ? null : { triggers: [], emails: [] }
  )),
  default: {},
}));

vi.mock('../../services/notifications', () => ({ showToast: vi.fn() }));

function renderPage() {
  // jsdom annonce une locale « en » : sans ce réglage l'écran serait rendu en
  // anglais et les libellés français ci-dessous ne diraient plus rien.
  localStorage.setItem('baakalai_lang', 'fr');
  return render(
    <MemoryRouter>
      <I18nProvider>
        <NurturePage />
      </I18nProvider>
    </MemoryRouter>
  );
}

/**
 * Le formulaire « Nouveau trigger » alignait quatre champs nus : ni le nombre
 * de jours ni le mode d'envoi n'étaient explicables sans lire le moteur de
 * nurture. Ces tests verrouillent l'explication affichée sous le formulaire.
 */
describe('NurturePage — formulaire de création de trigger', () => {
  it('explique le délai en jours selon le type de trigger choisi', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('+ Nouveau trigger'));

    // Type par défaut : lead stagnant, 30 jours.
    expect(await screen.findByText(/aucune activité depuis 30 jours/i)).toBeTruthy();

    // Un autre type donne un sens différent au même champ.
    fireEvent.change(screen.getByLabelText('Déclencheur'), { target: { value: 'renewal_reminder' } });
    await waitFor(() => {
      expect(screen.getByText(/avant la date de renouvellement/i)).toBeTruthy();
    });
  });

  it("reprend le nombre saisi dans l'explication", async () => {
    renderPage();
    fireEvent.click(await screen.findByText('+ Nouveau trigger'));

    fireEvent.change(await screen.findByLabelText('Délai (jours)'), { target: { value: '90' } });
    await waitFor(() => {
      expect(screen.getByText(/aucune activité depuis 90 jours/i)).toBeTruthy();
    });

    // Champ vidé : handleCreate enregistre 30 par défaut, l'explication doit le dire.
    fireEvent.change(screen.getByLabelText('Délai (jours)'), { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByText(/aucune activité depuis 30 jours/i)).toBeTruthy();
    });
  });

  it("explique Approbation, Automatique, et le cas LinkedIn", async () => {
    renderPage();
    fireEvent.click(await screen.findByText('+ Nouveau trigger'));

    expect(await screen.findByText(/Rien ne part tant que vous ne l'avez pas validé/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Envoi'), { target: { value: 'auto' } });
    await waitFor(() => {
      expect(screen.getByText(/sans validation de votre part/i)).toBeTruthy();
    });

    // En LinkedIn le champ Envoi disparaît (mode forcé à auto) : il faut le dire.
    fireEvent.change(screen.getByLabelText('Canal'), { target: { value: 'linkedin_message' } });
    await waitFor(() => {
      expect(screen.queryByLabelText('Envoi')).toBeNull();
      expect(screen.getByText(/LinkedIn s'exécutent automatiquement/i)).toBeTruthy();
    });
  });
});
