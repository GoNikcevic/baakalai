/**
 * Registry of providers that can generate prospect lists.
 * Each provider declares whether it currently supports prospect search
 * via its API in our codebase.
 */

const db = require('../db');

// Providers we recognize and their search capability status.
// `keyless: true` marque une source disponible sans abonnement ni clé : elle est
// proposée à tout le monde, sans ligne dans user_integrations.
const PROVIDER_REGISTRY = {
  sirene: {
    name: 'Entreprises France',
    label: 'Entreprises France',
    canSearch: true,
    keyless: true,
    note: 'Registre officiel français (INSEE et RNE), sans clé ni abonnement. Recherche par secteur, effectif, région et ancienneté, avec le dirigeant nommé. Les emails ne sont pas fournis, ils restent à révéler.',
  },
  apollo: {
    name: 'Apollo',
    label: 'Apollo',
    canSearch: true,
    note: 'Base de données B2B complète, recherche par titre, secteur, taille, localisation',
  },
  lemlist: {
    name: 'Lemlist',
    label: 'Lemlist',
    canSearch: true,
    note: 'Base Lemlist Leads, 600M contacts, recherche par titre, secteur, taille, pays',
  },
  instantly: {
    name: 'Instantly',
    label: 'Instantly',
    canSearch: false,
    note: "Instantly n'expose pas d'API de recherche de prospects. Connecte Apollo pour générer une liste.",
  },
  smartlead: {
    name: 'Smartlead',
    label: 'Smartlead',
    canSearch: false,
    note: "Smartlead est un outil d'envoi. Pour générer une liste, connecte Apollo.",
  },
  lagrowthmachine: {
    name: 'La Growth Machine',
    label: 'LGM',
    canSearch: false,
    note: "Pas d'API de recherche disponible. Connecte Apollo pour générer une liste.",
  },
  waalaxy: {
    name: 'Waalaxy',
    label: 'Waalaxy',
    canSearch: false,
    note: "Pas d'API de recherche publique. Connecte Apollo pour générer une liste.",
  },
};

// Outils d'envoi : les sources sans clé n'en sont pas, elles ne savent que chercher.
const OUTREACH_PROVIDERS = Object.keys(PROVIDER_REGISTRY).filter(
  p => !PROVIDER_REGISTRY[p].keyless
);

const KEYLESS_PROVIDERS = Object.keys(PROVIDER_REGISTRY).filter(
  p => PROVIDER_REGISTRY[p].keyless
);

/**
 * Get the list of prospect sources available to a user.
 * Providers from user_integrations that are in PROVIDER_REGISTRY, plus the
 * keyless sources, which need no configuration and are therefore always there.
 */
async function listUserSources(userId) {
  const integrations = await db.userIntegrations.listByUser(userId);
  const configured = integrations
    .filter(i => PROVIDER_REGISTRY[i.provider])
    .map(i => ({
      provider: i.provider,
      ...PROVIDER_REGISTRY[i.provider],
      configured: true,
    }));

  const keyless = KEYLESS_PROVIDERS
    .filter(p => !configured.some(c => c.provider === p))
    .map(p => ({ provider: p, ...PROVIDER_REGISTRY[p], configured: true }));

  return [...configured, ...keyless];
}

/**
 * Get only the sources that can actually perform prospect search.
 */
async function listSearchableSources(userId) {
  const all = await listUserSources(userId);
  return all.filter(s => s.canSearch);
}

/**
 * Choose the source to use when the caller did not name one.
 *
 * Une source sans clé est désormais toujours disponible, donc « exactement une
 * source cherchable » n'arrive plus jamais : sans cet arbitrage, tout compte
 * ayant Apollo prendrait un MULTIPLE_SOURCES. On garde donc la priorité à la
 * source configurée par l'utilisateur, et le sans-clé sert de repli.
 *
 * @returns {{ source: string|null, ambiguous: object[]|null }}
 */
async function pickDefaultSource(userId) {
  const searchable = await listSearchableSources(userId);
  const keyed = searchable.filter(s => !s.keyless);

  if (keyed.length === 1) return { source: keyed[0].provider, ambiguous: null };
  if (keyed.length > 1) return { source: null, ambiguous: keyed };

  const keyless = searchable.find(s => s.keyless);
  return { source: keyless ? keyless.provider : null, ambiguous: null };
}

/**
 * Execute a prospect search via the chosen provider.
 * Throws a clear error if the provider doesn't support search.
 */
async function searchProspects(userId, source, criteria) {
  const meta = PROVIDER_REGISTRY[source];
  if (!meta) {
    throw new Error(`Provider inconnu : ${source}`);
  }
  if (!meta.canSearch) {
    throw new Error(`${meta.name} ne supporte pas la recherche de prospects. ${meta.note}`);
  }

  if (source === 'sirene') {
    const { searchCompanies, companiesToContacts } = require('../api/recherche-entreprises');
    const { companies, totalResults, diagnostics } = await searchCompanies(criteria);
    const contacts = companiesToContacts(companies, { maxPerCompany: criteria.maxPerCompany });

    // Le registre ne connaît que les mandataires : un critère de titre ne peut
    // pas filtrer ici, autant le dire plutôt que de le jeter en silence.
    const ignoredCriteria = [];
    if (criteria.titles && criteria.titles.length) ignoredCriteria.push('titles');

    return {
      contacts: contacts.slice(0, criteria.limit || 25),
      diagnostics: { ...diagnostics, totalResults, ignoredCriteria },
    };
  }

  if (source === 'apollo') {
    const { searchContacts } = require('./apollo-enrichment');
    const contacts = await searchContacts(userId, criteria);
    return { contacts };
  }

  if (source === 'lemlist') {
    const { getUserKey } = require('../config');
    const { searchPeopleDatabase } = require('../api/lemlist');
    const apiKey = await getUserKey(userId, 'lemlist');
    if (!apiKey) throw new Error('Lemlist non configuré');
    try {
      const { contacts, diagnostics } = await searchPeopleDatabase(apiKey, criteria);
      return { contacts, diagnostics };
    } catch (err) {
      // Lemlist Leads DB indisponible (outage 503, plan sans add-on, etc.)
      // → fallback transparent sur Apollo si configuré
      const isUnavailable =
        err.status === 503 ||
        err.status === 502 ||
        err.status === 504 ||
        err.code === 'LEMLIST_LEADS_UNAVAILABLE';
      if (!isUnavailable) throw err;

      const hasApollo = await db.userIntegrations.get(userId, 'apollo').catch(() => null);
      if (!hasApollo) {
        throw new Error(
          "Lemlist Leads Database indisponible (outage en cours côté Lemlist). " +
          "Connecte Apollo dans Intégrations pour débloquer la recherche de prospects."
        );
      }
      console.warn('[prospect-sources] Lemlist unavailable, falling back to Apollo:', err.message);
      const { searchContacts } = require('./apollo-enrichment');
      const apolloContacts = await searchContacts(userId, criteria);
      return {
        contacts: apolloContacts.map(c => ({ ...c, _fallback: 'apollo', _fallbackReason: 'lemlist_unavailable' })),
        fallback: { from: 'lemlist', to: 'apollo', reason: 'lemlist_unavailable' },
      };
    }
  }

  throw new Error(`Dispatch manquant pour le provider : ${source}`);
}

module.exports = {
  PROVIDER_REGISTRY,
  OUTREACH_PROVIDERS,
  KEYLESS_PROVIDERS,
  listUserSources,
  listSearchableSources,
  pickDefaultSource,
  searchProspects,
};
