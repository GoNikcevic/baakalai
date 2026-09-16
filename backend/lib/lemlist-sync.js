/* ===============================================================================
   BAKAL · Lemlist Auto-Sync & Analysis
   Background task: pulls campaign history from Lemlist, analyzes with Claude,
   and populates memory_patterns table.
   =============================================================================== */

const { getUserKey } = require('../config');
const claude = require('../api/claude');
const lemlist = require('../api/lemlist');
const db = require('../db');
const { notifyUser } = require('../socket');

/**
 * Sync all Lemlist campaigns and analyze them with Claude.
 * Runs in background · emits socket progress events throughout.
 *
 * @param {string} userId - The user's UUID
 * @returns {{ campaigns: number, patterns: number }}
 */
async function syncAndAnalyze(userId) {
  try {
    // Get user's Lemlist API key
    const apiKey = await getUserKey(userId, 'lemlist');
    if (!apiKey) throw new Error('No Lemlist API key configured');

    // Notify: starting
    notifyUser(userId, 'lemlist:sync', { status: 'starting', progress: 0 });

    // Step 1: Pull all campaigns (uses per-user API key)
    const campaigns = await lemlist.listCampaigns(apiKey);
    notifyUser(userId, 'lemlist:sync', {
      status: 'fetching',
      progress: 10,
      message: `${campaigns.length} campagnes trouvées`,
    });

    // Step 2: Fetch stats for each campaign (with progress)
    const allStats = [];
    for (let i = 0; i < campaigns.length; i++) {
      const camp = campaigns[i];
      try {
        const rawStats = await lemlist.getCampaignStats(camp._id, apiKey);
        const transformed = lemlist.transformCampaignStats(rawStats);
        allStats.push({
          name: camp.name,
          id: camp._id,
          ...transformed,
        });
      } catch (err) {
        console.warn(`[lemlist-sync] Stats fetch failed for "${camp.name}":`, err.message);
        // Still include campaign with basic info even if stats fail
        allStats.push({
          name: camp.name,
          id: camp._id,
          contacts: 0, openRate: 0, replyRate: 0, acceptRate: 0, interested: 0, meetings: 0,
        });
      }

      const progress = 10 + Math.round(((i + 1) / campaigns.length) * 40);
      notifyUser(userId, 'lemlist:sync', {
        status: 'fetching',
        progress,
        message: `Stats collectées: ${i + 1}/${campaigns.length}`,
      });
    }

    if (allStats.length === 0) {
      notifyUser(userId, 'lemlist:sync', {
        status: 'done',
        progress: 100,
        message: 'Aucune donnée de campagne trouvée',
        patternsCount: 0,
      });
      return { campaigns: 0, patterns: 0 };
    }

    // Step 3: Claude analyzes all campaign data
    notifyUser(userId, 'lemlist:sync', {
      status: 'analyzing',
      progress: 60,
      message: 'Claude analyse vos campagnes...',
    });

    // Build analysis input
    const analysisInput = allStats.map(s =>
      `Campagne "${s.name}": ${s.contacts || 0} contacts, ouverture ${s.openRate || 0}%, réponse ${s.replyRate || 0}%, LinkedIn ${s.acceptRate || 0}%, intéressés ${s.interested || 0}, RDV ${s.meetings || 0}`
    ).join('\n');

    const systemPrompt = `Tu es un expert en prospection B2B. Analyse l'historique de campagnes Lemlist ci-dessous et identifie les patterns de performance.

Pour chaque pattern identifié, donne:
- pattern: ce qui fonctionne ou ne fonctionne pas
- category: "Objets" | "Corps" | "Timing" | "LinkedIn" | "Cible"
- confidence: "Haute" (>200 prospects) | "Moyenne" (50-200) | "Faible" (<50)
- sectors: secteurs concernés (tableau)
- targets: cibles concernées (tableau)

Retourne un JSON: { "patterns": [...] }
Sois spécifique et actionnable. Base-toi uniquement sur les données fournies.`;

    const result = await claude.callClaude(systemPrompt, analysisInput, 4000);

    notifyUser(userId, 'lemlist:sync', {
      status: 'saving',
      progress: 85,
      message: 'Sauvegarde des patterns...',
    });

    // Step 4: Save patterns to memory_patterns
    let patternsCount = 0;
    if (result.parsed && result.parsed.patterns) {
      for (const p of result.parsed.patterns) {
        try {
          await db.memoryPatterns.create({
            pattern: p.pattern,
            category: p.category || 'Corps',
            data: JSON.stringify({ source: 'lemlist_sync', campaigns: allStats.length }),
            confidence: p.confidence || 'Faible',
            sectors: p.sectors || [],
            targets: p.targets || [],
          });
          patternsCount++;
        } catch (err) {
          console.warn('[lemlist-sync] Failed to save pattern:', err.message);
        }
      }
    }

    // Step 5: Done · notify
    notifyUser(userId, 'lemlist:sync', {
      status: 'done',
      progress: 100,
      message: `Analyse terminée, ${patternsCount} patterns identifiés sur ${allStats.length} campagnes`,
      patternsCount,
      campaignsCount: allStats.length,
    });

    return { campaigns: allStats.length, patterns: patternsCount };
  } catch (err) {
    console.error('[lemlist-sync] Error:', err.message);
    notifyUser(userId, 'lemlist:sync', {
      status: 'error',
      progress: 0,
      message: err.message,
    });
    throw err;
  }
}

module.exports = { syncAndAnalyze };
