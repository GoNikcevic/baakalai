import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TriggerRecipes from '../TriggerRecipes';
import { I18nProvider } from '../../../i18n';
import { request } from '../../../services/api-client';

vi.mock('../../../services/api-client', () => ({
  request: vi.fn(),
  default: {},
}));

vi.mock('../../../services/notifications', () => ({ showToast: vi.fn() }));

function renderRecipes(props = {}) {
  localStorage.setItem('baakalai_lang', 'fr');
  return render(
    <MemoryRouter>
      <I18nProvider>
        <TriggerRecipes existingTypes={[]} {...props} />
      </I18nProvider>
    </MemoryRouter>
  );
}

/**
 * Une règle se créait en choisissant un type parmi dix, un délai et un mode,
 * sans jamais savoir combien de contacts seraient touchés : 1 règle créée sur
 * 15 comptes en production. Ces tests verrouillent ce que les recettes
 * promettent, le nombre affiché et la création en un clic.
 */
describe('Recettes de règles', () => {
  beforeEach(() => {
    request.mockReset();
  });

  it('affiche le nombre de contacts concernés par recette', async () => {
    request.mockResolvedValue({
      counts: [
        { id: 'dormant', count: 12, manualOnly: false, sample: [{ name: 'Ada Lovelace', company: 'Nexalis' }] },
        { id: 'silent', count: 0, manualOnly: false, sample: [] },
        { id: 'feedback', count: 3, manualOnly: false, sample: [] },
      ],
    });

    renderRecipes();

    expect(await screen.findByText("12 contacts concernés aujourd'hui")).toBeTruthy();
    expect(screen.getByText('Aucun contact concerné aujourd\'hui')).toBeTruthy();
    expect(screen.getByText('3 contacts concernés aujourd\'hui')).toBeTruthy();
    // L'exemple de contact rend le chiffre vérifiable.
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
  });

  it('ne propose pas une recette déjà couverte par une règle existante', async () => {
    request.mockResolvedValue({ counts: [] });

    renderRecipes({ existingTypes: ['deal_stagnant'] });

    await waitFor(() => {
      expect(screen.queryByText('Relancer les deals dormants')).toBeNull();
    });
    expect(screen.getByText('Reprendre contact avec les silencieux')).toBeTruthy();
  });

  it('propose la rétention des clients à risque sans délai d\'attente', async () => {
    request.mockResolvedValue({ counts: [{ id: 'atRisk', count: 4, manualOnly: false, sample: [] }] });
    const onCreated = vi.fn();

    renderRecipes({ existingTypes: ['deal_stagnant', 'inactive_contact', 'feedback_request'], onCreated });

    fireEvent.click(await screen.findByText('Activer'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const createCall = request.mock.calls.find(([url]) => url === '/nurture/triggers');
    const body = createCall[1].body;
    expect(body).toContain('"triggerType":"churn_risk"');
    // days 0 = dès le signalement : le churn n'attend pas une ancienneté.
    expect(body).toContain('"days":0');
    expect(body).toContain('"mode":"approval"');
  });

  it('crée la règle en approbation, jamais en envoi automatique', async () => {
    request.mockResolvedValue({ counts: [{ id: 'dormant', count: 5, manualOnly: false, sample: [] }] });
    const onCreated = vi.fn();

    // On ne laisse qu'une seule recette disponible pour que « Activer » soit
    // sans ambiguïté.
    renderRecipes({ existingTypes: ['inactive_contact', 'feedback_request', 'churn_risk'], onCreated });

    fireEvent.click(await screen.findByText('Activer'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const createCall = request.mock.calls.find(([url]) => url === '/nurture/triggers');
    expect(createCall).toBeTruthy();
    const body = createCall[1].body;
    expect(body).toContain('"triggerType":"deal_stagnant"');
    expect(body).toContain('"mode":"approval"');
    expect(body).toContain('"days":30');
  });
});
