import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ContactSubline, { contactSubline } from '../ContactSubline';

/**
 * La fonction du contact était en base depuis toujours (les sept importeurs CRM
 * la mappent) et n'apparaissait nulle part : chaque écran affichait `name` puis
 * `company`, la fonction ne sortant qu'en repli quand la société manquait. La
 * règle vit maintenant à un seul endroit, d'où ces cas.
 */
describe('contactSubline', () => {
  it('met la fonction avant la société', () => {
    expect(contactSubline({ title: 'Directrice Marketing', company: 'Groupe Belfort' }))
      .toBe('Directrice Marketing · Groupe Belfort');
  });

  it('se contente de ce qui existe', () => {
    expect(contactSubline({ company: 'Groupe Belfort' })).toBe('Groupe Belfort');
    expect(contactSubline({ title: 'CEO' })).toBe('CEO');
  });

  it('ne tombe sur l\'email que si les deux manquent, et seulement si on l\'autorise', () => {
    expect(contactSubline({ email: 'a@b.fr' })).toBe('a@b.fr');
    expect(contactSubline({ email: 'a@b.fr' }, { withEmail: false })).toBe('');
  });

  it('ignore une chaîne vide ou blanche venue du CRM', () => {
    // Salesforce renvoie '' plutôt que null sur un Title jamais rempli : sans ce
    // filtre, la ligne afficherait un séparateur orphelin devant la société.
    expect(contactSubline({ title: '   ', company: 'Novatech' })).toBe('Novatech');
  });

  it('ne rend rien du tout plutôt qu\'une ligne vide', () => {
    const { container } = render(<ContactSubline contact={{}} withEmail={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('rend la ligne quand il y a quelque chose à dire', () => {
    render(<ContactSubline contact={{ title: 'CEO', company: 'Novatech' }} />);
    expect(screen.getByText('CEO · Novatech')).toBeTruthy();
  });
});
