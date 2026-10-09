/* ===============================================================================
   Page Profil : suppression d'un document.

   Le bouton de suppression faisait `catch {}`. Quand le serveur refusait, le
   document restait affiché, aucun message n'apparaissait, et l'utilisateur
   pensait que son clic n'avait pas été pris. Ce fichier tient l'échec visible,
   et le cas nominal en contrôle : sans lui, un bouton qui n'enlèverait plus
   rien ferait passer le test d'échec.
   =============================================================================== */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ProfilePage from '../ProfilePage';

const { faux } = vi.hoisted(() => ({
  faux: { suppression: () => Promise.resolve({ ok: true }) },
}));

vi.mock('../../context/useApp', () => ({ useApp: () => ({}) }));

vi.mock('../../services/notifications', () => ({ showToast: vi.fn() }));

vi.mock('../../services/api-client', () => ({
  request: vi.fn((chemin, opts = {}) => {
    if (chemin === '/documents' && !opts.method) {
      return Promise.resolve({
        documents: [{ id: 'doc-1', original_name: 'plaquette.pdf', mime_type: 'application/pdf', created_at: '2026-10-01T10:00:00Z', doc_type: 'other' }],
      });
    }
    if (chemin === '/documents/doc-1' && opts.method === 'DELETE') return faux.suppression();
    if (chemin === '/profile') return Promise.resolve({ profile: { company: 'Check SARL' } });
    if (chemin === '/crm/product-lines' && !opts.method) return Promise.resolve({ productLines: [{ id: 'pl-1', name: 'Logiciel' }] });
    return Promise.resolve({});
  }),
}));

import { showToast } from '../../services/notifications';

/** Le bouton « × » de la ligne du document. */
async function boutonSuppression() {
  const nom = await screen.findByText('plaquette.pdf');
  return [...nom.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === '×');
}

describe('ProfilePage, suppression d un document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    faux.suppression = () => Promise.resolve({ ok: true });
  });

  it('un document supprime disparait de la liste', async () => {
    render(<ProfilePage />);
    fireEvent.click(await boutonSuppression());

    await waitFor(() => expect(screen.queryByText('plaquette.pdf')).not.toBeInTheDocument());
    expect(showToast).not.toHaveBeenCalled();
  });

  it('un echec serveur s affiche, et le document reste', async () => {
    faux.suppression = () => Promise.reject(Object.assign(new Error('HTTP 500'), { status: 500 }));

    render(<ProfilePage />);
    fireEvent.click(await boutonSuppression());

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const avis = showToast.mock.calls[0][0];
    expect(avis.type).toBe('error');
    expect(avis.message).toContain('plaquette.pdf');
    expect(avis.message).toContain('pas pu être supprimé');
    // Le document est toujours là : il n'a pas été supprimé, l'écran ne doit pas
    // prétendre le contraire.
    expect(screen.getByText('plaquette.pdf')).toBeInTheDocument();
  });
});

describe('ProfilePage, type des documents envoyes', () => {
  // Le type part avec le fichier et décide de ce que lit l'auto-remplissage du
  // profil, qui écarte les listes de prospects. Le sélecteur avait disparu le
  // 30/06 : tout partait en « other », sans moyen de le changer.
  const fetchOrigine = globalThis.fetch;
  let envois;

  beforeEach(() => {
    vi.clearAllMocks();
    envois = [];
    globalThis.fetch = vi.fn((url, opts) => {
      if (String(url).includes('/api/documents/upload')) envois.push(opts.body);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  afterEach(() => { globalThis.fetch = fetchOrigine; });

  it('le type choisi pour un fichier part avec lui', async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByText('plaquette.pdf');

    const fichier = new File(['nom,email'], 'prospects-q4.csv', { type: 'text/csv' });
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [fichier] } });

    const selecteur = await screen.findByLabelText('Type du document');
    expect(selecteur.value).toBe('other');
    fireEvent.change(selecteur, { target: { value: 'prospects' } });

    fireEvent.click(screen.getByRole('button', { name: /Envoyer 1 fichier/ }));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0].get('docTypes')).toBe(JSON.stringify({ 'prospects-q4.csv': 'prospects' }));
  });
});
