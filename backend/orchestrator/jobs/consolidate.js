/**
 * Job: Memory Consolidation (Workflow 3 replacement)
 *
 * Flow: PostgreSQL (diagnostics PAR TENANT) → Claude (pattern extraction) → PostgreSQL + Notion sync
 *
 * Déclenché par le Memory Agent (hebdo, ≥3 nouveaux diagnostics sur 7 jours).
 *
 * Depuis le 2026-09-14 la consolidation tourne par tenant (équipe sinon user) :
 * l'ancienne version mélangeait les diagnostics de TOUS les clients dans un
 * même prompt Claude et écrivait des patterns orphelins (team_id NULL) · les
 * conclusions d'un client fuyaient dans la mémoire des autres. Désormais
 * chaque tenant est consolidé avec SES diagnostics et SA mémoire (+ pool
 * partagé), et les patterns produits naissent scopés. Le partage éventuel
 * passe par la politique du DAO, comme partout.
 */

const claude = require('../../api/claude');
const notionSync = require('../../api/notion-sync');
const db = require('../../db');
const hubspotSync = require('./hubspot-sync');

// En dessous, l'appel Claude n'a pas assez de matière pour produire des
// patterns fiables · même seuil d'esprit que MIN_NEW_DIAGNOSTICS côté
// memory-agent, mais par tenant.
const MIN_DIAGNOSTICS_PER_TENANT = 3;

async function run() {
  console.log('[consolidate] Starting memory consolidation (per tenant)...');

  try {
    const campaigns = await db.campaigns.list({});

    // Regroupement par tenant : équipe si le propriétaire en a une, sinon
    // user · jamais les deux (règle DAO, migration 089). Résolution cachée
    // par user pour ne pas requêter teams à chaque campagne.
    const tenantByUser = new Map();
    const groups = new Map(); // clé "team:x"/"user:y" → { tenant, campaigns }
    let orphanCampaigns = 0;
    for (const campaign of campaigns) {
      if (!campaign.user_id) { orphanCampaigns++; continue; }
      let tenant = tenantByUser.get(campaign.user_id);
      if (!tenant) {
        tenant = { userId: campaign.user_id };
        try {
          const team = await db.teams.getByUser(campaign.user_id);
          if (team) tenant = { teamId: team.id };
        } catch { /* résolution d'équipe indisponible : scope user */ }
        tenantByUser.set(campaign.user_id, tenant);
      }
      const key = tenant.teamId ? `team:${tenant.teamId}` : `user:${tenant.userId}`;
      if (!groups.has(key)) groups.set(key, { tenant, campaigns: [] });
      groups.get(key).campaigns.push(campaign);
    }
    if (orphanCampaigns > 0) {
      console.warn(`[consolidate] ${orphanCampaigns} campagne(s) sans user_id ignorée(s)`);
    }

    const totals = {
      patternsCreated: 0, patternsMerged: 0, patternsUpdated: 0,
      tenants: 0, tenantsSkipped: 0, contradictions: [], summaries: [],
    };
    const savedIds = [];

    for (const { tenant, campaigns: tenantCampaigns } of groups.values()) {
      const diagnostics = [];
      for (const campaign of tenantCampaigns) {
        const diags = await db.diagnostics.listByCampaign(campaign.id);
        diagnostics.push(
          ...diags.map((d) => ({ ...d, campaign: campaign.name, sector: campaign.sector }))
        );
      }
      if (diagnostics.length < MIN_DIAGNOSTICS_PER_TENANT) {
        totals.tenantsSkipped++;
        continue;
      }

      // Mémoire du tenant + pool partagé Haute · la porte est dans list().
      const existingMemory = await db.memoryPatterns.list({ limit: 100, ...tenant });
      const result = await claude.consolidateMemory(diagnostics, existingMemory);
      totals.tenants++;

      // replaceOrCreate (et non create) : le job tourne chaque semaine · un
      // create() brut recréerait les mêmes patterns à chaque passage. La dédup
      // (exacte, préfixe, pgvector), désormais scopée tenant, fusionne avec
      // l'existant et compte une confirmation ; retour null = pattern écarté
      // récemment par l'utilisateur.
      if (result.parsed?.patterns) {
        for (const pattern of result.parsed.patterns) {
          const saved = await db.memoryPatterns.replaceOrCreate({
            ...tenant,
            pattern: pattern.pattern,
            category: pattern.categorie,
            data: pattern.donnees,
            confidence: pattern.confiance,
            sectors: pattern.secteurs || [],
            targets: pattern.cibles || [],
            source: 'consolidation',
          });
          if (!saved) continue; // dismissed < 7 jours : on respecte le choix
          // Fusion vs création : le chemin fusion pose toujours last_confirmed_at
          // (UPDATE ... last_confirmed_at = now()), jamais le chemin création.
          if (saved.last_confirmed_at) totals.patternsMerged++;
          else savedIds.push(saved.id);
          notionSync.syncMemoryPattern(saved.id).catch(console.error);
        }
      }

      // Ajustements de confiance : uniquement sur les patterns DU tenant.
      // Claude a aussi vu le pool partagé · sans cette garde, le run d'un
      // client pourrait recoter les patterns partagés des autres.
      if (result.parsed?.updatedPatterns) {
        for (const update of result.parsed.updatedPatterns) {
          if (!update.existingId || !update.newConfidence) continue;
          const target = await db.memoryPatterns.get(update.existingId);
          const owns = target && (tenant.teamId
            ? target.team_id === tenant.teamId
            : target.user_id === tenant.userId);
          if (!owns) continue;
          await db.memoryPatterns.update(update.existingId, { confidence: update.newConfidence });
          totals.patternsUpdated++;
        }
      }

      if (result.parsed?.contradictions?.length) totals.contradictions.push(...result.parsed.contradictions);
      if (result.parsed?.summary) totals.summaries.push(result.parsed.summary);
    }

    totals.patternsCreated = savedIds.length;

    if (totals.tenants === 0) {
      console.log(`[consolidate] No tenant with ≥${MIN_DIAGNOSTICS_PER_TENANT} diagnostics, skipping.`);
      return { ...totals, skipped: true, summary: '' };
    }

    // Push high-confidence patterns to HubSpot deals
    const hubspotResult = await hubspotSync.pushPatternsToDeals().catch((err) => {
      console.warn('[consolidate] HubSpot patterns push failed:', err.message);
      return { synced: 0 };
    });

    console.log(`[consolidate] Done. Tenants: ${totals.tenants} (+${totals.tenantsSkipped} skipped), Created: ${totals.patternsCreated}, Merged: ${totals.patternsMerged}, Updated: ${totals.patternsUpdated}, HubSpot: ${hubspotResult.synced} deals`);

    // Incremental embedding sync · only embed patterns with no vector yet.
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
      ...totals,
      summary: totals.summaries.join(' | '),
      hubspotSynced: hubspotResult.synced,
    };
  } catch (err) {
    console.error('[consolidate] Failed:', err.message);
    return { patternsCreated: 0, patternsUpdated: 0, error: err.message };
  }
}

module.exports = { run };
