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
    note: 'Base de données B2B complète — recherche par titre, secteur, taille, localisation',
  },
  lemlist: {
    name: 'Lemlist',
    label: 'Lemlist',
    canSearch: false,
    note: "Lemlist est un outil d'exécution de campagnes. Pour générer une liste, connecte Apollo.",
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
    return searchContacts(userId, criteria);
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
