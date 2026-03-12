/**
 * Job: Memory Consolidation (Workflow 3 replacement)
 *
 * Flow: PostgreSQL (all diagnostics) → Claude (pattern extraction) → PostgreSQL + Notion sync
 *
 * Runs monthly (1st of month). Builds the cross-campaign pattern library.
 */

const claude = require('../../api/claude');
const notionSync = require('../../api/notion-sync');
const db = require('../../db');

async function run() {
  console.log('[consolidate] Starting monthly memory consolidation...');

  try {
    const campaigns = await db.campaigns.list({});
    const allDiagnostics = [];
    for (const campaign of campaigns) {
      const diags = await db.diagnostics.listByCampaign(campaign.id);
      allDiagnostics.push(
        ...diags.map((d) => ({ ...d, campaign: campaign.name, sector: campaign.sector }))
      );
    }

    if (allDiagnostics.length === 0) {
      console.log('[consolidate] No diagnostics found — skipping.');
      return { patternsCreated: 0, patternsUpdated: 0, skipped: true };
    }

    const existingMemory = await db.memoryPatterns.list({});
    const result = await claude.consolidateMemory(allDiagnostics, existingMemory);

    const savedIds = [];
    if (result.parsed?.patterns) {
      for (const pattern of result.parsed.patterns) {
        const created = await db.memoryPatterns.create({
          pattern: pattern.pattern,
          category: pattern.categorie,
          data: pattern.donnees,
          confidence: pattern.confiance,
          sectors: pattern.secteurs || [],
          targets: pattern.cibles || [],
        });
        savedIds.push(created.id);
        notionSync.syncMemoryPattern(created.id).catch(console.error);
      }
    }

    let updatedCount = 0;
    if (result.parsed?.updatedPatterns) {
      for (const update of result.parsed.updatedPatterns) {
        if (update.existingId && update.newConfidence) {
          await db.memoryPatterns.update(update.existingId, { confidence: update.newConfidence });
          updatedCount++;
        }
      }
    }

    console.log(`[consolidate] Done. Created: ${savedIds.length}, Updated: ${updatedCount}`);
    return {
      patternsCreated: savedIds.length,
      patternsUpdated: updatedCount,
      contradictions: result.parsed?.contradictions || [],
      summary: result.parsed?.summary || '',
    };
  } catch (err) {
    console.error('[consolidate] Failed:', err.message);
    return { patternsCreated: 0, patternsUpdated: 0, error: err.message };
  }
}

module.exports = { run };
