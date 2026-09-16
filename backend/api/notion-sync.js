/**
 * Notion Sync · Background mirror of SQLite data → Notion
 *
 * Notion is NOT the source of truth. This module pushes data
 * to Notion so the team can view campaign progress without
 * touching the backend directly.
 *
 * All sync methods are fire-and-forget (call with .catch(console.error)).
 * If Notion is unreachable, data stays safe in SQLite.
 */

const { config } = require('../config');
const notionApi = require('./notion');
const db = require('../db');

function isConfigured() {
  return !!(config.notion.token && config.notion.databases.resultats);
}

// ── Campaign → Notion Résultats ──

async function syncCampaign(campaignId) {
  if (!isConfigured()) return;

  const campaign = db.campaigns.get(campaignId);
  if (!campaign) return;

  const statusMap = {
    active: 'Active',
    prep: 'En préparation',
    terminated: 'Terminée',
    optimizing: 'En optimisation',
  };

  const channelMap = {
    email: 'Email',
    linkedin: 'LinkedIn',
    multi: 'Multi',
  };

  const data = {
    name: campaign.name,
    client: campaign.client,
    statut: statusMap[campaign.status] || 'Active',
    canal: channelMap[campaign.channel] || 'Email',
    nbProspects: campaign.nb_prospects,
    secteur: campaign.sector || '',
    cible: campaign.position || '',
    openRate: (campaign.open_rate || 0) / 100,
    replyRate: (campaign.reply_rate || 0) / 100,
    acceptRate: (campaign.accept_rate_lk || 0) / 100,
    replyRateLk: (campaign.reply_rate_lk || 0) / 100,
    lemlistId: campaign.lemlist_id || '',
    dateCollecte: campaign.last_collected || new Date().toISOString().split('T')[0],
  };

  try {
    if (campaign.notion_page_id) {
      await notionApi.updateResultat(campaign.notion_page_id, data);
    } else {
      const page = await notionApi.createResultat(data);
      db.campaigns.update(campaignId, { notion_page_id: page.id });
    }
  } catch (err) {
    console.warn(`[Notion sync] Campaign ${campaignId} failed:`, err.message);
  }
}

// ── Diagnostic → Notion Diagnostics ──

async function syncDiagnostic(diagnosticId, campaignId) {
  if (!isConfigured()) return;

  const diag = db.diagnostics.listByCampaign(campaignId)
    .find((d) => d.id === diagnosticId);
  if (!diag) return;

  const campaign = db.campaigns.get(campaignId);
  if (!campaign) return;

  try {
    const priorities = tryParse(diag.priorities);
    const page = await notionApi.createDiagnostic({
      campaignName: campaign.name,
      dateAnalyse: diag.date_analyse,
      diagnostic: diag.diagnostic,
      priorites: priorities,
      nbMessagesOptimiser: diag.nb_to_optimize,
    });
    // Store notion page id back
    db.getDb().prepare('UPDATE diagnostics SET notion_page_id = ? WHERE id = ?')
      .run(page.id, diagnosticId);
  } catch (err) {
    console.warn(`[Notion sync] Diagnostic ${diagnosticId} failed:`, err.message);
  }
}

// ── Version → Notion Historique ──

async function syncVersion(versionId, campaignId) {
  if (!isConfigured()) return;

  const version = db.versions.listByCampaign(campaignId)
    .find((v) => v.id === versionId);
  if (!version) return;

  const campaign = db.campaigns.get(campaignId);
  if (!campaign) return;

  try {
    const page = await notionApi.createVersion({
      campaignName: campaign.name,
      version: version.version,
      date: version.date,
      messagesModifies: tryParse(version.messages_modified),
      hypotheses: version.hypotheses,
      resultat: resultMap(version.result),
    });
    db.getDb().prepare('UPDATE versions SET notion_page_id = ? WHERE id = ?')
      .run(page.id, versionId);
  } catch (err) {
    console.warn(`[Notion sync] Version ${versionId} failed:`, err.message);
  }
}

// ── Memory Pattern → Notion Mémoire ──

async function syncMemoryPattern(patternId) {
  if (!isConfigured()) return;

  const all = db.memoryPatterns.list({});
  const pattern = all.find((p) => p.id === patternId);
  if (!pattern) return;

  try {
    const page = await notionApi.createMemoryPattern({
      pattern: pattern.pattern,
      categorie: pattern.category,
      donnees: pattern.data,
      confiance: pattern.confidence,
      secteurs: tryParse(pattern.sectors),
      cibles: tryParse(pattern.targets),
    });
    db.getDb().prepare('UPDATE memory_patterns SET notion_page_id = ? WHERE id = ?')
      .run(page.id, patternId);
  } catch (err) {
    console.warn(`[Notion sync] Memory pattern ${patternId} failed:`, err.message);
  }
}

// ── Full sync (cron-friendly) ──

async function syncAll() {
  if (!isConfigured()) {
    console.warn('[Notion sync] Not configured, skipping full sync');
    return;
  }

  console.log('[Notion sync] Starting full sync...');
  const campaigns = db.campaigns.list({});

  for (const campaign of campaigns) {
    await syncCampaign(campaign.id);
  }

  console.log(`[Notion sync] Synced ${campaigns.length} campaigns`);
}

function resultMap(result) {
  const map = {
    testing: 'En cours',
    improved: 'Amélioré',
    degraded: 'Dégradé',
    neutral: 'Neutre',
  };
  return map[result] || 'En cours';
}

function tryParse(str) {
  try { return JSON.parse(str); } catch { return []; }
}

module.exports = {
  syncCampaign,
  syncDiagnostic,
  syncVersion,
  syncMemoryPattern,
  syncAll,
  isConfigured,
};
