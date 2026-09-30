/**
 * Déduire une entreprise d'une adresse email · ce qui est proposé, et surtout
 * ce qui ne l'est pas.
 *
 * Ce module remplit à l'avance le champ que l'utilisateur devait saisir 169
 * fois à la main. Le risque n'est pas de rater une déduction : un champ resté
 * vide, c'est la situation d'avant, l'utilisateur tape. Le risque est de
 * proposer une valeur FAUSSE qui a l'air juste, parce qu'elle sera acceptée en
 * masse par un « Tout accepter » et écrite dans le CRM du client.
 *
 * D'où l'asymétrie que ces tests verrouillent : en cas de doute, ne rien
 * proposer. « Gmail » comme employeur, « Info » comme nom de personne ou « Co »
 * tiré de co.uk sont les erreurs à ne jamais commettre.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  domainOf, isPersonalDomain, companyFromEmail,
  buildDomainCompanyMap, suggestCompany, suggestName,
} = require('../lib/company-from-email');

test('le domaine est extrait en minuscules, et seulement quand il en est un', () => {
  assert.strictEqual(domainOf('Laura@Acme-Industries.FR'), 'acme-industries.fr');
  assert.strictEqual(domainOf('laura@localhost'), null, 'sans point, ce n\'est pas un domaine');
  assert.strictEqual(domainOf('laura@'), null);
  assert.strictEqual(domainOf('@acme.fr'), null, 'pas de partie locale');
  assert.strictEqual(domainOf('pas-une-adresse'), null);
  assert.strictEqual(domainOf(null), null);
  assert.strictEqual(domainOf('laura@acme.fr.'), null, 'point final : domaine tronqué');
});

test('une messagerie grand public ne désigne aucun employeur', () => {
  for (const d of ['gmail.com', 'orange.fr', 'hotmail.fr', 'icloud.com', 'free.fr', 'yopmail.com']) {
    assert.strictEqual(isPersonalDomain(d), true, `${d} devrait être reconnu comme personnel`);
  }
  assert.strictEqual(isPersonalDomain('acme-industries.fr'), false);
  assert.strictEqual(companyFromEmail('laura.jacquet@gmail.com'), null, 'jamais « Gmail » comme entreprise');
});

test('le nom d\'entreprise se lit dans le domaine', () => {
  assert.strictEqual(companyFromEmail('laura@acme-industries.fr'), 'Acme Industries');
  assert.strictEqual(companyFromEmail('t.guerin@acme.com'), 'Acme');
  assert.strictEqual(companyFromEmail('x@mail.acme.com'), 'Acme', 'l\'étiquette technique est écartée');
  assert.strictEqual(companyFromEmail('x@acme.co.uk'), 'Acme', 'co.uk est un suffixe, pas un nom');
  assert.strictEqual(companyFromEmail('x@groupe-le-lann.fr'), 'Groupe le Lann', 'les particules restent minuscules');
});

test('la carte domaine vers entreprise reprend l\'orthographe du CRM', () => {
  const map = buildDomainCompanyMap([
    { email: 'a@acme.fr', company: 'Acme SAS' },
    { email: 'b@acme.fr', company: 'Acme SAS' },
    { email: 'c@acme.fr', company: 'Acme' },
    { email: 'd@gmail.com', company: 'Indépendant' },
    { email: 'e@vide.fr', company: '   ' },
  ]);
  assert.strictEqual(map.get('acme.fr'), 'Acme SAS', 'la graphie majoritaire gagne');
  assert.strictEqual(map.has('gmail.com'), false, 'une messagerie personnelle n\'entre pas dans la carte');
  assert.strictEqual(map.has('vide.fr'), false, 'une entreprise vide n\'entre pas dans la carte');
});

test('à égalité de fréquence, la graphie la plus longue gagne', () => {
  const map = buildDomainCompanyMap([
    { email: 'a@kerveil.fr', company: 'Kerveil' },
    { email: 'b@kerveil.fr', company: 'Atelier Kerveil SARL' },
  ]);
  assert.strictEqual(map.get('kerveil.fr'), 'Atelier Kerveil SARL');
});

test('la proposition privilégie ce que le CRM écrit déjà', () => {
  const map = buildDomainCompanyMap([{ email: 'a@acme.fr', company: 'Acme SAS' }]);

  assert.deepStrictEqual(suggestCompany('laura@acme.fr', map), { value: 'Acme SAS', source: 'crm' },
    'reprendre la graphie existante, sinon on fabrique le doublon qu\'on détecte à côté');
  assert.deepStrictEqual(suggestCompany('laura@inconnue-sarl.fr', map), { value: 'Inconnue Sarl', source: 'domain' });
  assert.strictEqual(suggestCompany('laura@gmail.com', map), null);
  assert.strictEqual(suggestCompany(null, map), null);
  assert.deepStrictEqual(suggestCompany('laura@acme.fr', undefined), { value: 'Acme', source: 'domain' },
    'une carte absente ne fait pas planter, elle retombe sur le domaine');
});

test('un nom de personne n\'est proposé que s\'il est réellement lisible', () => {
  assert.deepStrictEqual(suggestName('laura.jacquet@acme.fr'), { value: 'Laura Jacquet', source: 'domain' });
  assert.deepStrictEqual(suggestName('jean-pierre_martin@acme.fr'), { value: 'Jean Pierre Martin', source: 'domain' });
  assert.deepStrictEqual(suggestName('jean.dupont2@acme.fr'), { value: 'Jean Dupont', source: 'domain' },
    'le chiffre de désambiguïsation ne fait pas partie du nom');

  assert.strictEqual(suggestName('contact@acme.fr'), null, 'une boîte générique n\'est pas une personne');
  assert.strictEqual(suggestName('jdupont@acme.fr'), null, 'sans séparateur, le découpage serait inventé');
  assert.strictEqual(suggestName('laura@acme.fr'), null, 'un prénom seul ne donne pas un nom complet');
  assert.strictEqual(suggestName('commercial.sud@acme.fr'), null, 'une fonction reste une fonction');
  assert.strictEqual(suggestName('123.456@acme.fr'), null);
  assert.strictEqual(suggestName(''), null);
});
