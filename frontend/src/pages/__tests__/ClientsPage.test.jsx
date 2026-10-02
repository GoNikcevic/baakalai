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

/**
 * Le serveur de comptes, en miniature.
 *
 * La page ne charge plus une fenêtre de contacts qu'elle filtre elle-même :
 * elle demande une PAGE DE COMPTES déjà filtrée, triée et comptée à
 * `/crm/account-list` (backend/lib/account-list.js). Ces tests portent sur ce
 * que la page RESTITUE, il leur faut donc un serveur crédible, pas un tableau
 * brut.
 *
 * Ce stub reproduit les mêmes règles que le vrai, et seulement celles-là : la
 * clé de regroupement, le cadrage, la tuile, la recherche, le tri, et des
 * compteurs qui portent sur toute la base et non sur la page. Les règles
 * elles-mêmes sont gardées côté serveur par backend/tests/account-list.test.js.
 */
function serveurDeComptes(lignes, url) {
  const p = new URLSearchParams(url.split('?')[1] || '');
  const scope = p.get('scope');
  const jours = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : null);

  const dansLeCadrage = (c) => (scope === 'deals' ? c.status !== 'won'
    : scope === 'clients' ? c.status === 'won' : true);

  // Mêmes bornes que le serveur, donc mêmes que les libellés : « plus de 30
  // jours » veut dire 31 jours révolus.
  const TUILES = {
    deal_active: (c) => c.status !== 'lost' && jours(c.last_activity_at) != null && jours(c.last_activity_at) <= 30,
    deal_dormant: (c) => c.status !== 'lost' && jours(c.last_activity_at) > 30 && jours(c.last_activity_at) <= 60,
    deal_stalled: (c) => c.status !== 'lost' && jours(c.last_activity_at) > 60,
    deal_lost: (c) => c.status === 'lost',
    seg_new: (c) => jours(c.won_date) != null && jours(c.won_date) < 90,
    seg_active: (c) => jours(c.last_activity_at) != null && jours(c.last_activity_at) < 90,
    seg_silent: (c) => jours(c.last_activity_at) != null && jours(c.last_activity_at) >= 90,
    seg_risk: (c) => (c.churn_score || 0) >= 60,
  };

  const cadres = lignes.filter(dansLeCadrage);
  const tuile = p.get('tile');
  const recherche = (p.get('search') || '').toLowerCase();
  const retenus = cadres.filter(c => {
    if (tuile && !TUILES[tuile](c)) return false;
    if (p.get('filter') && p.get('filter') !== 'all' && c.status !== p.get('filter')) return false;
    if (p.get('crm') && p.get('crm') !== 'all' && c.crm_provider !== p.get('crm')) return false;
    if (recherche) {
      return [c.name, c.company, c.email].some(v => (v || '').toLowerCase().includes(recherche));
    }
    return true;
  });

  // La clé de l'écran : le compte, sinon la société, sinon la personne.
  const parCle = new Map();
  for (const c of retenus) {
    const cle = c.account_id || (c.company || '').trim() || `personne:${c.id}`;
    if (!parCle.has(cle)) {
      parCle.set(cle, {
        key: cle,
        name: (c.company || '').trim() || c.name || ' ',
        orphan: cle.startsWith('personne:'),
        // L'identifiant de la SOCIÉTÉ, comme le vrai serveur l'envoie
        // (lib/account-list.js) · c'est lui qui rend le nom cliquable.
        accountId: null,
        contacts: [],
      });
    }
    parCle.get(cle).contacts.push(c);
    if (c.account_id) parCle.get(cle).accountId = String(c.account_id);
  }

  const groups = [...parCle.values()].map(g => ({
    ...g,
    montant: g.contacts.reduce((s, c) => s + (Number(c.deal_value) || 0), 0),
    // Les noms du VRAI serveur (`lib/account-list.js`), pas seulement ceux que
    // ce faux utilise pour trier. Sans eux, une régression sur `value` ou
    // `lastActivityAt` passerait tous les tests : le composant étale désormais
    // le groupe du serveur, donc ce faux doit avoir la même forme que lui.
    value: g.contacts.reduce((s, c) => s + (Number(c.deal_value) || 0), 0),
    lastActivityAt: g.contacts.reduce(
      (max, c) => (c.last_activity_at && (!max || c.last_activity_at > max) ? c.last_activity_at : max),
      null
    ),
    // Les colonnes de la société · lot 7, écran 1.
    //
    // Posées EXPLICITEMENT par la fixture (`account_open` / `account_won`), et
    // non dérivées du statut des contacts. C'est fidèle au vrai serveur, qui
    // les calcule sur `deals` indépendamment du statut de la ligne de contact ·
    // les dériver ici rendrait un gagné impossible à afficher sous le cadrage
    // « deals », qui exclut justement les contacts gagnés. Le CALCUL est testé
    // côté backend (tests/account-list.test.js), ici on teste l'AFFICHAGE.
    openValue: g.contacts.find(c => c.account_open != null)?.account_open ?? 0,
    wonValue: g.contacts.find(c => c.account_won != null)?.account_won ?? 0,
    churnScore: g.contacts.find(c => c.account_churn != null)?.account_churn ?? null,
    owner: g.contacts.find(c => c.owner_email)?.owner_email || null,
    // Le silence d'un compte est celui de son contact le plus RÉCENT
    // (arbitrage 12.3) · côté serveur c'est `MAX(last_activity_at)`.
    recence: Math.max(...g.contacts.map(c => new Date(c.last_activity_at || 0).getTime())),
  })).sort((a, b) => (p.get('sort') === 'value' ? b.montant - a.montant : a.recence - b.recence));

  // Les compteurs ignorent la tuile active, sinon on ne pourrait plus passer
  // de l'une à l'autre.
  const pourCompter = cadres;
  const clesTuiles = scope === 'clients'
    ? ['seg_new', 'seg_active', 'seg_silent', 'seg_risk']
    : ['deal_active', 'deal_dormant', 'deal_stalled', 'deal_lost'];

  const byStatus = {};
  const byProvider = {};
  for (const c of cadres) {
    byStatus[c.status || 'unknown'] = (byStatus[c.status || 'unknown'] || 0) + 1;
    if (c.crm_provider) byProvider[c.crm_provider] = (byProvider[c.crm_provider] || 0) + 1;
  }

  return {
    groups,
    total: groups.length,
    page: 1,
    pageSize: 25,
    tiles: clesTuiles.map(k => ({ key: k, count: pourCompter.filter(TUILES[k]).length })),
    stats: {
      byStatus,
      byProvider,
      totalScope: cadres.length,
      dormant: cadres.filter(c => TUILES.deal_dormant(c) || TUILES.deal_stalled(c)).length,
      valued: cadres.filter(c => c.deal_value != null).length,
      value: cadres.reduce((s, c) => s + (Number(c.deal_value) || 0), 0),
      atRisk: cadres.filter(TUILES.seg_risk).length,
    },
  };
}

function mockApi(overrides = {}) {
  const lignes = overrides.opportunities || DEALS;
  request.mockImplementation((url) => {
    if (url.startsWith('/crm/providers')) return Promise.resolve({ providers: [{ provider: 'salesforce', connected: true }], activeCrm: 'salesforce' });
    if (url.startsWith('/crm/account-list')) return Promise.resolve(serveurDeComptes(lignes, url));
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
 * Les listes sont desormais orientees COMPTE : une ligne est une societe, et
 * ses contacts sont derriere le clic (decision du 29/09). Ouvrir un compte est
 * donc un prealable a toute assertion portant sur une personne.
 */
async function ouvrirCompte(nom) {
  fireEvent.click(await screen.findByText(nom));
  return screen.findByText(nom);
}

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
    // La liste rend des societes · c'est elle qui prouve que loadData est alle
    // au bout, la personne n'apparait qu'une fois le compte ouvert.
    await screen.findByText('Groupe Belfort');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('demande au serveur la page de comptes, triée par silence et cadrée', async () => {
    renderDeals();
    await waitFor(() => {
      const call = request.mock.calls.find(([url]) => url.startsWith('/crm/account-list'));
      // Le tri, le cadrage et la pagination partent au SERVEUR. La page ne
      // charge plus une fenêtre de cinq cents contacts qu'elle trierait
      // elle-même, et dans laquelle un client actif récemment était
      // introuvable par la recherche.
      expect(call[0]).toContain('sort=silence');
      expect(call[0]).toContain('scope=deals');
      expect(call[0]).toContain('page=1');
    });
    // Et surtout : plus aucun appel à l'ancienne fenêtre.
    expect(request.mock.calls.some(([url]) => url.startsWith('/dashboard/opportunities'))).toBe(false);
  });

  it('ouvre le panneau de détail sans planter', async () => {
    renderDeals();
    await ouvrirCompte('Groupe Belfort');
    fireEvent.click(await screen.findByText('Marie Dupont'));
    // Le panneau charge le détail du contact cliqué : preuve qu'il a été rendu.
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/crm/client/d3');
    });
  });
});

describe('ClientsPage · Vue globale Deals', () => {
  it('classe le plus long silence en premier', async () => {
    const { container } = renderDeals();
    await screen.findByText('Groupe Belfort');
    // L'ordre se lit sur les chips de silence des COMPTES · le silence d'un
    // compte est celui de son contact le plus recent (arbitrage 12.3).
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
    await screen.findByText('Groupe Belfort');
    // Ni la societe du client gagne, ni la personne.
    expect(screen.queryByText('Deja Client')).toBeNull();
    expect(screen.queryByText('Paul Gagnant')).toBeNull();
  });

  it('bascule sur le montant quand on change le tri', async () => {
    const { container } = renderDeals();
    await screen.findByText('Groupe Belfort');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'value' } });
    // Le tri est desormais un aller-retour serveur, plus un tri en memoire :
    // l'ordre n'est juste qu'apres la reponse. La liste reste affichee pendant
    // ce temps, elle ne disparait pas derriere un ecran de chargement.
    await waitFor(() => {
      const rows = [...container.querySelectorAll('div')]
        .filter(el => el.style.fontWeight === '600' && el.textContent);
      // La ligne de tête porte la SOCIÉTÉ, pas la personne · voir le test suivant.
      expect(rows[0]?.textContent).toBe('Novatech');
    });
  });

  /**
   * Deals et Clients répondent tous deux à une question de compte : « quelles
   * affaires dorment », « qui sont mes clients ». La page mettait pourtant la
   * personne en gras et la société en dessous, en gris. Sur deux cents lignes,
   * on lisait deux cents prénoms et pas une entreprise.
   */
  it('met la société en tête de ligne et la personne derrière le clic', async () => {
    const { container } = renderDeals();
    await screen.findByText('Novatech');
    const gras = [...container.querySelectorAll('div')]
      .filter(el => el.style.fontWeight === '600' && el.textContent)
      .map(el => el.textContent);
    expect(gras).toContain('Novatech');
    // Compte ferme : la personne n'est pas encore la.
    expect(screen.queryByText('Ahmed Ben Salah')).toBeNull();
    // Elle apparait des qu'on ouvre le compte.
    await ouvrirCompte('Novatech');
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
  });

  it('la recherche retrouve une personne sans passer par son compte', async () => {
    // Il n'y a plus de liste Contacts : la recherche est le seul chemin vers
    // quelqu'un dont on ne connait pas la societe. Elle deplie donc tout.
    renderDeals();
    await screen.findByText('Novatech');
    fireEvent.change(screen.getByPlaceholderText(/echerch/i), { target: { value: 'ahmed' } });
    expect(await screen.findByText('Ahmed Ben Salah')).toBeTruthy();
  });

  /**
   * Un compte a huit contacts et un seul qui signe. Savoir a qui on parle vient
   * avant de savoir depuis quand il se tait, d'ou le badge en premier.
   */
  it('marque le décideur, et distingue le rôle déclaré du rôle déduit', async () => {
    mockApi({ opportunities: [
      { id: 'r1', name: 'Marie Signe', company: 'Acme', status: 'new', last_activity_at: new Date().toISOString(), account_role: 'decision_maker', role_source: 'crm' },
      { id: 'r2', name: 'Paul Execute', company: 'Acme', status: 'new', last_activity_at: new Date().toISOString(), account_role: 'operational', role_source: 'inferred' },
    ] });
    renderDeals();
    await ouvrirCompte('Acme');
    const badges = await screen.findAllByText('Décideur');
    // Un seul des deux contacts est marqué · sinon le badge ne dit plus rien.
    expect(badges).toHaveLength(1);
    // Le rôle vient du CRM : trait plein, pas pointillé.
    expect(badges[0].getAttribute('title')).toMatch(/déclaré dans votre CRM/);
  });

  it('ne marque rien quand le rôle est inconnu', async () => {
    // Une absence de marque se lit mieux qu'une étiquette « rôle inconnu »
    // répétée sur la moitié de la liste.
    mockApi({ opportunities: [
      { id: 'r3', name: 'Sans Role', company: 'Acme', status: 'new', last_activity_at: new Date().toISOString() },
    ] });
    renderDeals();
    await ouvrirCompte('Acme');
    expect(screen.queryByText('Décideur')).toBeNull();
  });

  it('garde la personne en tête quand le CRM ne donne aucune société', async () => {
    // Cas réel du 29/09 : un Pipedrive dont aucun contact n'a d'organisation.
    // Sans repli, la ligne principale serait vide sur toute la liste.
    mockApi({ opportunities: [{ id: 'y', name: 'Sans Societe', company: null, status: 'new', last_activity_at: new Date().toISOString() }] });
    const { container } = renderDeals();
    await screen.findByText('Sans Societe');
    const gras = [...container.querySelectorAll('div')]
      .filter(el => el.style.fontWeight === '600' && el.textContent)
      .map(el => el.textContent);
    expect(gras).toContain('Sans Societe');
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

    await screen.findByText('Groupe Belfort');
    expect(screen.queryByText('Qualification')).toBeNull();
    for (const label of ['Actifs', 'Dorment (30 j+)', 'Au point mort (60 j+)', 'Perdus']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('ne compte pas le client gagné dans les tuiles de tête', async () => {
    renderDeals();
    await screen.findByText('Groupe Belfort');
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

describe('ClientsPage · accès à la fiche de société', () => {
  // Le nom de société doit OUVRIR sa fiche. Ça n'a jamais marché : le
  // remappage des groupes reconstruisait un objet sans reprendre `accountId`,
  // alors que l'affichage en dépend. Le serveur l'envoyait, l'écran le jetait,
  // et la fiche compte n'était atteignable que par URL directe.
  it('le nom d une société rattachée ouvre sa fiche', async () => {
    mockApi({
      opportunities: [
        { id: 'c1', name: 'Marie Signe', company: 'Acme', account_id: 'acc-1', status: 'new', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    const lien = await screen.findByRole('link', { name: 'Acme' });
    expect(lien.getAttribute('href')).toBe('/accounts/acc-1');
  });

  it('un groupe formé sur un nom en texte libre n est PAS un lien', async () => {
    // Pas de `account_id` : le groupe porte un nom d'entreprise sans fiche.
    // En faire un lien mènerait à /accounts/undefined.
    mockApi({
      opportunities: [
        { id: 'c2', name: 'Paul Libre', company: 'Societe Sans Fiche', status: 'new', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    expect(await screen.findByText('Societe Sans Fiche')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Societe Sans Fiche' })).toBeNull();
  });

  it('propose de reconstruire les sociétés quand il en reste à reconnaître', async () => {
    mockApi({
      opportunities: [
        { id: 'c3', name: 'A B', company: 'Sans Fiche Un', status: 'new', last_activity_at: new Date().toISOString() },
        { id: 'c4', name: 'C D', company: 'Sans Fiche Deux', status: 'new', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    // Contextuel : le bandeau dit COMBIEN de sociétés y gagneraient une fiche,
    // pour qu'un bouton d'action ne reste pas une énigme.
    expect(await screen.findByText(/2 société\(s\) ne sont pas encore reconnues/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reconstruire les sociétés/ })).toBeTruthy();
  });

  it('ne propose rien quand toutes les sociétés ont leur fiche', async () => {
    mockApi({
      opportunities: [
        { id: 'c5', name: 'E F', company: 'Acme', account_id: 'acc-1', status: 'new', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    await screen.findByRole('link', { name: 'Acme' });
    expect(screen.queryByRole('button', { name: /Reconstruire les sociétés/ })).toBeNull();
  });

  it('un contact isolé ne compte pas comme une société à reconstruire', async () => {
    // Une personne sans entreprise n'aura jamais de fiche · l'annoncer comme
    // réparable promettrait un résultat que le bouton ne peut pas donner.
    mockApi({
      opportunities: [
        { id: 'c6', name: 'Sans Societe', company: null, status: 'new', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    expect(await screen.findByText('Sans Societe')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reconstruire les sociétés/ })).toBeNull();
  });
});

describe('ClientsPage · les colonnes de la société', () => {
  // L'écran affichait UN montant agrégé. Or voir l'OUVERT et le GAGNÉ ensemble
  // EST la définition de l'upsell : une société qui a déjà signé et qui a
  // encore une affaire en cours. Un total unique ne le dit pas.
  it('affiche l ouvert et le gagné séparément', async () => {
    mockApi({
      opportunities: [
        { id: 'u2', name: 'En cours', company: 'Verdoux', account_id: 'acc-v', status: 'negotiation',
          account_open: 24200, account_won: 35900, last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    await screen.findByRole('link', { name: 'Verdoux' });
    // Les deux montants coexistent sur la ligne · c'est ce qui rend l'upsell
    // lisible sans colonne dédiée.
    expect(screen.getByText(/24\s?200\s?€/)).toBeTruthy();
    expect(screen.getByText(/35\s?900\s?€/)).toBeTruthy();
  });

  it('nomme le risque, et ne le laisse jamais à la couleur seule', async () => {
    mockApi({
      opportunities: [
        { id: 'r1', name: 'A B', company: 'Critique SA', account_id: 'acc-c', account_churn: 82, status: 'negotiation', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    // Un écran lu en noir et blanc doit rester lisible : le mot porte le sens,
    // la bande porte la forme, le chiffre vient après.
    expect(await screen.findByText(/Critique 82/)).toBeTruthy();
  });

  it('un compte sans score affiche « Non scorable », jamais « Sain 0 »', async () => {
    mockApi({
      opportunities: [
        { id: 'n1', name: 'C D', company: 'Muette SA', account_id: 'acc-m', status: 'negotiation', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    // LE point qui compte. Un compte muet n'est pas un compte en bonne santé :
    // afficher « Sain 0 » présenterait un angle mort comme un bon résultat.
    expect(await screen.findByText('Non scorable')).toBeTruthy();
    expect(screen.queryByText(/Sain 0/)).toBeNull();
  });

  it('un silence inconnu s écrit « inconnu », pas zéro jour', async () => {
    mockApi({
      opportunities: [
        { id: 's1', name: 'E F', company: 'Jamais Vue', account_id: 'acc-j', status: 'negotiation', last_activity_at: null },
      ],
    });
    renderDeals();

    // « 0 j » se lirait comme « active aujourd'hui », soit l'inverse de la
    // vérité : on ne sait pas quand on lui a parlé pour la dernière fois.
    await screen.findByRole('link', { name: 'Jamais Vue' });
    expect(screen.getByText('inconnu')).toBeTruthy();
  });

  it('l en-tête de colonnes accompagne la liste des sociétés', async () => {
    mockApi({
      opportunities: [
        { id: 'h1', name: 'G H', company: 'Acme', account_id: 'acc-1', status: 'negotiation', last_activity_at: new Date().toISOString() },
      ],
    });
    renderDeals();

    await screen.findByRole('link', { name: 'Acme' });
    // Des colonnes de montants sans en-tête obligent à deviner lequel est
    // lequel, et deviner sur de l'argent se paie.
    expect(screen.getByText('Ouvert')).toBeTruthy();
    expect(screen.getByText('Gagné')).toBeTruthy();
    expect(screen.getByText('Risque du compte')).toBeTruthy();
    expect(screen.getByText('Propriétaire')).toBeTruthy();
  });

  it('l onglet « À risque » ne double plus la tuile du même nom', async () => {
    mockApi();
    renderClients();

    // Arbitrage Goran du 02/10 : la tuile et l'onglet faisaient le MEME filtre
    // au MEME seuil, à dix centimètres l'un de l'autre. L'onglet part, la
    // tuile reste · elle porte en plus la bande de sévérité.
    await screen.findByText('Clients');
    const onglets = screen.queryAllByRole('button', { name: /^À risque/ });
    expect(onglets.length).toBeLessThanOrEqual(1);
  });
});
