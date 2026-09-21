const { Client } = require('@notionhq/client');
const { config } = require('../config');

let notion;
function getClient() {
  if (!notion) {
    notion = new Client({ auth: config.notion.token });
  }
  return notion;
}

const db = () => config.notion.databases;

// =============================================
// Campagnes · Résultats
// =============================================

async function createResultat(data) {
  return getClient().pages.create({
    parent: { database_id: db().resultats },
    properties: {
      'Nom campagne': { title: [{ text: { content: data.name } }] },
      'Client': { rich_text: [{ text: { content: data.client } }] },
      'Date collecte': { date: { start: data.dateCollecte || new Date().toISOString().split('T')[0] } },
      'Statut': { select: { name: data.statut || 'Active' } },
      'Nb prospects': { number: data.nbProspects || 0 },
      'Canal': { select: { name: data.canal || 'Email' } },
      'Secteur': { rich_text: [{ text: { content: data.secteur || '' } }] },
      'Cible': { rich_text: [{ text: { content: data.cible || '' } }] },
      'Open rate global': { number: data.openRate || 0 },
      'Reply rate global': { number: data.replyRate || 0 },
      'Accept rate LK': { number: data.acceptRate || 0 },
      'Reply rate LK': { number: data.replyRateLk || 0 },
      'Lemlist ID': { rich_text: [{ text: { content: data.lemlistId || '' } }] },
      ...(data.openRateE1 != null && { 'Open rate E1': { number: data.openRateE1 } }),
      ...(data.openRateE2 != null && { 'Open rate E2': { number: data.openRateE2 } }),
      ...(data.openRateE3 != null && { 'Open rate E3': { number: data.openRateE3 } }),
      ...(data.openRateE4 != null && { 'Open rate E4': { number: data.openRateE4 } }),
      ...(data.replyRateE1 != null && { 'Reply rate E1': { number: data.replyRateE1 } }),
      ...(data.replyRateE2 != null && { 'Reply rate E2': { number: data.replyRateE2 } }),
      ...(data.replyRateE3 != null && { 'Reply rate E3': { number: data.replyRateE3 } }),
      ...(data.replyRateE4 != null && { 'Reply rate E4': { number: data.replyRateE4 } }),
    },
  });
}

async function queryResultats(filter = {}) {
  const params = {
    database_id: db().resultats,
    sorts: [{ property: 'Date collecte', direction: 'descending' }],
  };
  if (filter.status) {
    params.filter = {
      property: 'Statut',
      select: { equals: filter.status },
    };
  }
  return getClient().databases.query(params);
}

async function updateResultat(pageId, data) {
  const properties = {};
  if (data.statut) properties['Statut'] = { select: { name: data.statut } };
  if (data.nbProspects != null) properties['Nb prospects'] = { number: data.nbProspects };
  if (data.openRate != null) properties['Open rate global'] = { number: data.openRate };
  if (data.replyRate != null) properties['Reply rate global'] = { number: data.replyRate };
  if (data.acceptRate != null) properties['Accept rate LK'] = { number: data.acceptRate };
  if (data.dateCollecte) properties['Date collecte'] = { date: { start: data.dateCollecte } };

  return getClient().pages.update({ page_id: pageId, properties });
}

// =============================================
// Campagnes · Diagnostics
// =============================================

async function createDiagnostic(data) {
  return getClient().pages.create({
    parent: { database_id: db().diagnostics },
    properties: {
      'Campagne': { title: [{ text: { content: data.campaignName } }] },
      'Date analyse': { date: { start: data.dateAnalyse || new Date().toISOString().split('T')[0] } },
      'Priorités': { multi_select: (data.priorites || []).map((p) => ({ name: p })) },
      'Nb messages à optimiser': { number: data.nbMessagesOptimiser || 0 },
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: data.diagnostic || '' } }],
        },
      },
    ],
  });
}

async function queryDiagnostics(campaignName) {
  return getClient().databases.query({
    database_id: db().diagnostics,
    filter: {
      property: 'Campagne',
      title: { equals: campaignName },
    },
    sorts: [{ property: 'Date analyse', direction: 'descending' }],
  });
}

// =============================================
// Campagnes · Historique Versions
// =============================================

async function createVersion(data) {
  return getClient().pages.create({
    parent: { database_id: db().historique },
    properties: {
      'Campagne': { title: [{ text: { content: data.campaignName } }] },
      'Version': { number: data.version },
      'Date': { date: { start: data.date || new Date().toISOString().split('T')[0] } },
      'Messages modifiés': { multi_select: (data.messagesModifies || []).map((m) => ({ name: m })) },
      'Hypothèses testées': { rich_text: [{ text: { content: data.hypotheses || '' } }] },
      'Résultat': { select: { name: data.resultat || 'En cours' } },
    },
  });
}

async function queryVersions(campaignName) {
  return getClient().databases.query({
    database_id: db().historique,
    filter: {
      property: 'Campagne',
      title: { equals: campaignName },
    },
    sorts: [{ property: 'Version', direction: 'descending' }],
  });
}

async function updateVersion(pageId, data) {
  const properties = {};
  if (data.resultat) properties['Résultat'] = { select: { name: data.resultat } };
  return getClient().pages.update({ page_id: pageId, properties });
}

// =============================================
// Mémoire Cross-Campagne
// =============================================

async function createMemoryPattern(data) {
  return getClient().pages.create({
    parent: { database_id: db().memoire },
    properties: {
      'Pattern': { title: [{ text: { content: data.pattern } }] },
      'Catégorie': { select: { name: data.categorie } },
      'Confiance': { select: { name: data.confiance || 'Faible' } },
      'Date découverte': { date: { start: data.dateDecouverte || new Date().toISOString().split('T')[0] } },
      'Secteur': { multi_select: (data.secteurs || []).map((s) => ({ name: s })) },
      'Cible': { multi_select: (data.cibles || []).map((c) => ({ name: c })) },
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: data.donnees || '' } }],
        },
      },
    ],
  });
}

async function queryMemory(filter = {}) {
  const params = {
    database_id: db().memoire,
    sorts: [{ property: 'Date découverte', direction: 'descending' }],
  };

  const filters = [];
  if (filter.categorie) {
    filters.push({ property: 'Catégorie', select: { equals: filter.categorie } });
  }
  if (filter.confiance) {
    filters.push({ property: 'Confiance', select: { equals: filter.confiance } });
  }
  if (filter.secteur) {
    filters.push({ property: 'Secteur', multi_select: { contains: filter.secteur } });
  }

  if (filters.length > 1) {
    params.filter = { and: filters };
  } else if (filters.length === 1) {
    params.filter = filters[0];
  }

  return getClient().databases.query(params);
}

async function updateMemoryPattern(pageId, data) {
  const properties = {};
  if (data.confiance) properties['Confiance'] = { select: { name: data.confiance } };
  if (data.secteurs) properties['Secteur'] = { multi_select: data.secteurs.map((s) => ({ name: s })) };
  if (data.cibles) properties['Cible'] = { multi_select: data.cibles.map((c) => ({ name: c })) };
  return getClient().pages.update({ page_id: pageId, properties });
}

// =============================================
// Utility: Parse Notion page properties
// =============================================

function parseResultat(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: p['Nom campagne']?.title?.[0]?.plain_text || '',
    client: p['Client']?.rich_text?.[0]?.plain_text || '',
    dateCollecte: p['Date collecte']?.date?.start || null,
    statut: p['Statut']?.select?.name || '',
    nbProspects: p['Nb prospects']?.number || 0,
    canal: p['Canal']?.select?.name || '',
    secteur: p['Secteur']?.rich_text?.[0]?.plain_text || '',
    cible: p['Cible']?.rich_text?.[0]?.plain_text || '',
    openRate: p['Open rate global']?.number || 0,
    replyRate: p['Reply rate global']?.number || 0,
    acceptRate: p['Accept rate LK']?.number || 0,
    replyRateLk: p['Reply rate LK']?.number || 0,
    lemlistId: p['Lemlist ID']?.rich_text?.[0]?.plain_text || '',
  };
}

function parseDiagnostic(page) {
  const p = page.properties;
  return {
    id: page.id,
    campaignName: p['Campagne']?.title?.[0]?.plain_text || '',
    dateAnalyse: p['Date analyse']?.date?.start || null,
    priorites: (p['Priorités']?.multi_select || []).map((s) => s.name),
    nbMessagesOptimiser: p['Nb messages à optimiser']?.number || 0,
  };
}

function parseVersion(page) {
  const p = page.properties;
  return {
    id: page.id,
    campaignName: p['Campagne']?.title?.[0]?.plain_text || '',
    version: p['Version']?.number || 0,
    date: p['Date']?.date?.start || null,
    messagesModifies: (p['Messages modifiés']?.multi_select || []).map((s) => s.name),
    hypotheses: p['Hypothèses testées']?.rich_text?.[0]?.plain_text || '',
    resultat: p['Résultat']?.select?.name || '',
  };
}

function parseMemoryPattern(page) {
  const p = page.properties;
  return {
    id: page.id,
    pattern: p['Pattern']?.title?.[0]?.plain_text || '',
    categorie: p['Catégorie']?.select?.name || '',
    confiance: p['Confiance']?.select?.name || '',
    dateDecouverte: p['Date découverte']?.date?.start || null,
    secteurs: (p['Secteur']?.multi_select || []).map((s) => s.name),
    cibles: (p['Cible']?.multi_select || []).map((s) => s.name),
  };
}

module.exports = {
  getClient,
  // Résultats
  createResultat,
  queryResultats,
  updateResultat,
  parseResultat,
  // Diagnostics
  createDiagnostic,
  queryDiagnostics,
  parseDiagnostic,
  // Historique
  createVersion,
  queryVersions,
  updateVersion,
  parseVersion,
  // Mémoire
  createMemoryPattern,
  queryMemory,
  updateMemoryPattern,
  parseMemoryPattern,
};
