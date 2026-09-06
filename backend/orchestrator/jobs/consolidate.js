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
const hubspotSync = require('./hubspot-sync');

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

    // replaceOrCreate (et non create) : maintenant que le déclencheur du
    // memory-agent fonctionne, ce job tourne réellement chaque semaine — un
    // create() brut recréerait les mêmes patterns à chaque passage. La dédup
    // (exacte, préfixe, pgvector) fusionne avec l'existant et compte une
    // confirmation ; retour null = pattern écarté récemment par l'utilisateur.
    const savedIds = [];
    let mergedCount = 0;
    if (result.parsed?.patterns) {
      for (const pattern of result.parsed.patterns) {
        const saved = await db.memoryPatterns.replaceOrCreate({
          pattern: pattern.pattern,
          category: pattern.categorie,
          data: pattern.donnees,
          confidence: pattern.confiance,
          sectors: pattern.secteurs || [],
          targets: pattern.cibles || [],
        });
        if (!saved) continue; // dismissed < 7 jours : on respecte le choix
        // Fusion vs création : le chemin fusion pose toujours last_confirmed_at
        // (UPDATE ... last_confirmed_at = now()), jamais le chemin création.
        if (saved.last_confirmed_at) mergedCount++;
        else savedIds.push(saved.id);
        notionSync.syncMemoryPattern(saved.id).catch(console.error);
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

    // Push high-confidence patterns to HubSpot deals
    const hubspotResult = await hubspotSync.pushPatternsToDeals().catch((err) => {
      console.warn('[consolidate] HubSpot patterns push failed:', err.message);
      return { synced: 0 };
    });

    console.log(`[consolidate] Done. Created: ${savedIds.length}, Merged: ${mergedCount}, Updated: ${updatedCount}, HubSpot: ${hubspotResult.synced} deals`);

    // Incremental embedding sync — only embed patterns with no vector yet.
    // Source of truth is memory_patterns.embedding; the memory_embeddings twin
    // table was dropped in migration 065.
    if (process.env.PGVECTOR_ENABLED === 'true') {
      try {
        const { upsertPatternEmbedding } = require('../../lib/vector-store');
        const unembedded = await db.query(
          `SELECT mp.id, mp.pattern, mp.category, mp.confidence, mp.sectors
           FROM memory_patterns mp
           WHERE mp.dismissed_at IS NULL AND mp.embedding IS NULL
           LIMIT 100`
        );
        let embedded = 0;
        for (const p of unembedded.rows) {
          const stored = await upsertPatternEmbedding(p.id, p.pattern, {
            category: p.category, confidence: p.confidence, sectors: p.sectors,
          });
          if (stored) embedded++;
        }
        if (embedded > 0) console.log(`[consolidate] pgvector: embedded ${embedded} new patterns`);
      } catch (pgErr) {
        console.warn('[consolidate] pgvector embedding failed (non-fatal):', pgErr.message);
      }
    }

    return {
      patternsCreated: savedIds.length,
      patternsMerged: mergedCount,
      patternsUpdated: updatedCount,
      contradictions: result.parsed?.contradictions || [],
      summary: result.parsed?.summary || '',
      hubspotSynced: hubspotResult.synced,
    };
  } catch (err) {
    console.error('[consolidate] Failed:', err.message);
    return { patternsCreated: 0, patternsUpdated: 0, error: err.message };
  }
}

module.exports = { run };
