/**
 * Registry of providers that can generate prospect lists.
 * Each provider declares whether it currently supports prospect search
 * via its API in our codebase.
 */

const db = require('../db');

// Providers we recognize and their search capability status
const PROVIDER_REGISTRY = {
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

const OUTREACH_PROVIDERS = Object.keys(PROVIDER_REGISTRY);

/**
 * Get the list of prospect sources configured for a user.
 * Returns providers from user_integrations that are in PROVIDER_REGISTRY,
 * annotated with their canSearch capability.
 */
async function listUserSources(userId) {
  const integrations = await db.userIntegrations.listByUser(userId);
  return integrations
    .filter(i => PROVIDER_REGISTRY[i.provider])
    .map(i => ({
      provider: i.provider,
      ...PROVIDER_REGISTRY[i.provider],
      configured: true,
    }));
}

/**
 * Get only the sources that can actually perform prospect search.
 */
async function listSearchableSources(userId) {
  const all = await listUserSources(userId);
  return all.filter(s => s.canSearch);
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
  listUserSources,
  listSearchableSources,
  searchProspects,
};
