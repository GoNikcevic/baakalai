/* ===============================================================================
   Fin d'inscription : la sauvegarde du profil, et le verrou du bouton.

   ── Ce que ces tests tiennent ──────────────────────────────────────────────

   Le POST du profil était en fire-and-forget avec un `.catch(() => {})`. Comme
   ProfilePage retombe sur localStorage, un échec restait invisible alors que
   c'est le serveur qui score : `lib/contact-scoring.js` sort `{ score: 0 }`
   sans profil, et `job_role` est le seul critère ICP non déductible du CRM.
   L'appel attend donc son résultat désormais.

   Rendre cet appel attendu a ouvert une seconde faille, celle que personne
   n'aurait vue : `setupDoneRef` passe à true AVANT l'attente, si bien qu'un
   second clic pendant l'aller-retour réseau prenait la branche du garde-fou,
   finalisait, et fermait le wizard avant que le premier import CRM ait été
   lancé. L'utilisateur arrivait sur un dashboard vide, c'est-à-dire exactement
   ce que cet import existe pour éviter.

   Les deux défauts ont été constatés et corrigés à la main dans un navigateur.
   Ce fichier existe pour qu'ils ne reviennent pas à la prochaine modification :
   le wizard n'avait aucun test, et c'est sa fonction de fin qui vient d'être
   restructurée.
   =============================================================================== */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OnboardingWizard from '../OnboardingWizard';

// Le faux client HTTP est piloté test par test : c'est la réponse de
// `POST /profile` qui distingue les trois scénarios. `vi.hoisted` est
// nécessaire, `vi.mock` étant remonté au-dessus des imports.
const { faux } = vi.hoisted(() => ({
  faux: { reponseProfil: () => Promise.resolve({}), appelsProfil: 0 },
}));

vi.mock('../../services/api-client', () => ({
  request: vi.fn((chemin, opts) => {
    if (chemin === '/profile' && opts?.method === 'POST') {
      faux.appelsProfil++;
      return faux.reponseProfil();
    }
    return Promise.resolve({});
  }),
  // Aucune clé n'est saisie dans ces tests, donc `handleSaveKeys` passe à
  // l'étape suivante sans appeler celle-ci. Elle est fournie quand même : un
  // export absent fait échouer le module entier au chargement.
  saveKeys: vi.fn(() => Promise.resolve({})),
  trackEvent: vi.fn(),
}));

/** Une promesse dont le test décide du moment de résolution. */
function differe() {
  let resoudre;
  let rejeter;
  const promesse = new Promise((res, rej) => { resoudre = res; rejeter = rej; });
  return { promesse, resoudre, rejeter };
}

/**
 * Remplit l'étape entreprise et avance jusqu'au dernier écran.
 *
 * Ni site web ni document : `handleCompanyContinue` passe alors directement à
 * l'étape suivante sans déclencher l'analyse IA. Aucune clé non plus, donc
 * `handleSaveKeys` enchaîne de la même façon. Et aucun CRM sélectionné, donc
 * la fin d'inscription ne passe pas par le premier import : c'est le chemin qui
 * isole la sauvegarde du profil.
 */
async function allerAuDernierEcran() {
  fireEvent.change(screen.getByPlaceholderText('Ex: FormaPro Consulting'), {
    target: { value: 'Check SARL' },
  });
  fireEvent.change(screen.getByPlaceholderText('Ex: SaaS, Formation, Finance...'), {
    target: { value: 'SaaS' },
  });
  const listes = screen.getAllByRole('combobox');
  fireEvent.change(listes[0], { target: { value: '11-25' } });
  fireEvent.change(listes[1], { target: { value: 'responsable_commercial' } });

  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await waitFor(() => expect(screen.getByText('Connectez votre CRM')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  // On attend le bouton de fin, et non le titre « Tout est prêt ! » : ce
  // dernier figure deux fois sur l'écran, en en-tête et dans le récapitulatif.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Accéder au dashboard' })).toBeInTheDocument());

  return screen.getByRole('button', { name: 'Accéder au dashboard' });
}

describe('OnboardingWizard, fin d inscription', () => {
  let onComplete;
  // Le `fetch` d'origine est rendu après chaque test, et non supprimé : le
  // supprimer priverait les fichiers de test suivants de celui de Node.
  const fetchOrigine = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    faux.appelsProfil = 0;
    faux.reponseProfil = () => Promise.resolve({});
    localStorage.clear();
    // `finalize` marque la fin côté serveur en fire-and-forget. Sans ce faux,
    // jsdom tenterait une vraie requête sur une URL relative.
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    onComplete = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = fetchOrigine;
  });

  it('le profil part une fois, et l inscription se termine', async () => {
    render(<OnboardingWizard onComplete={onComplete} />);
    const bouton = await allerAuDernierEcran();

    fireEvent.click(bouton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(faux.appelsProfil).toBe(1);
    expect(localStorage.getItem('bakal_onboarding_complete')).toBe('true');
    // Le profil reste aussi en local : ProfilePage s'en sert en repli.
    expect(localStorage.getItem('bakal_profile')).toContain('Check SARL');
    expect(screen.queryByText(/n'a pas pu être enregistré/)).not.toBeInTheDocument();
  });

  it('le bouton se verrouille pendant la sauvegarde, et un second clic ne finalise pas', async () => {
    // Le défaut tenu ici. Sans le verrou, ce second clic prend la branche
    // `setupDoneRef` et appelle finalize() alors que le profil est encore en
    // vol : sur un compte avec CRM, le premier import n'aurait jamais lieu.
    const attente = differe();
    faux.reponseProfil = () => attente.promesse;

    render(<OnboardingWizard onComplete={onComplete} />);
    const bouton = await allerAuDernierEcran();
    expect(bouton).not.toBeDisabled();

    fireEvent.click(bouton);
    await waitFor(() => expect(bouton).toBeDisabled());
    expect(faux.appelsProfil).toBe(1);

    // Second clic pendant l'aller-retour.
    fireEvent.click(bouton);
    expect(onComplete).not.toHaveBeenCalled();
    expect(faux.appelsProfil).toBe(1);
    expect(localStorage.getItem('bakal_onboarding_complete')).toBeNull();

    // Le réseau répond, et la fin d'inscription se fait, une seule fois.
    attente.resoudre({});
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(faux.appelsProfil).toBe(1);
  });

  it('un echec serveur s affiche, et ne ferme pas le wizard', async () => {
    faux.reponseProfil = () => Promise.reject(new Error('HTTP 500'));

    render(<OnboardingWizard onComplete={onComplete} />);
    const bouton = await allerAuDernierEcran();

    fireEvent.click(bouton);

    // L'avertissement nomme ce qui s'est passé et ce qu'il faut faire.
    await waitFor(() => expect(screen.getByText(/n'a pas pu être enregistré/)).toBeInTheDocument());
    // Et l'inscription n'est PAS finalisée : sinon l'écran se fermerait avant
    // que le message soit lisible.
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem('bakal_onboarding_complete')).toBeNull();
  });

  it('apres un echec, le clic suivant finalise sans renvoyer le profil', async () => {
    // L'échec n'est pas bloquant : la correction se fait depuis Profil. Ce que
    // ce test tient en plus, c'est que le second passage ne rejoue pas l'envoi,
    // donc le garde-fou `setupDoneRef` tient toujours après le correctif.
    faux.reponseProfil = () => Promise.reject(new Error('HTTP 500'));

    render(<OnboardingWizard onComplete={onComplete} />);
    const bouton = await allerAuDernierEcran();

    fireEvent.click(bouton);
    await waitFor(() => expect(screen.getByText(/n'a pas pu être enregistré/)).toBeInTheDocument());
    await waitFor(() => expect(bouton).not.toBeDisabled());

    fireEvent.click(bouton);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(faux.appelsProfil).toBe(1);
    expect(localStorage.getItem('bakal_onboarding_complete')).toBe('true');
  });
});
