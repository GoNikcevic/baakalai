/**
 * Shared enrichment context for AI-generated emails (reactivation + upsell drafts).
 * Extracted from the old agent-chains.js so both deal-coach.js and upsell-detector.js
 * can pull the same timing/copy/memory-pattern context without duplicating queries.
 */

const db = require('../db');

// ─── Timing enrichment ───

async function getTimingContext(userId) {
  // Pull best day/hour from memory patterns created by Timing Agent
  const patterns = await db.query(
    `SELECT pattern, data FROM memory_patterns
     WHERE category = 'Séquence' AND dismissed_at IS NULL
       AND (pattern ILIKE '%meilleur jour%' OR pattern ILIKE '%meilleure heure%')
     ORDER BY confidence DESC, created_at DESC LIMIT 2`
  );
  let bestDay = null, bestHour = null;
  for (const p of patterns.rows) {
    let data = p.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
    if (data?.bestDay) bestDay = data.bestDay;
    if (data?.bestHour != null) bestHour = data.bestHour;
  }
  return { bestDay, bestHour };
}

// ─── Copy context ───

async function getCopyContext(userId) {
  const patterns = await db.query(
    `SELECT pattern FROM memory_patterns
     WHERE category = 'Séquence' AND dismissed_at IS NULL AND confidence IN ('Haute', 'Moyenne')
       AND (pattern ILIKE '%sujets efficaces%' OR pattern ILIKE '%longueur optimale%' OR pattern ILIKE '%copy%')
     ORDER BY confidence DESC LIMIT 3`
  );
  return patterns.rows.map(p => p.pattern).join('\n');
}

// ─── Memory patterns context ───

// userId : repli pour les utilisateurs SOLO (sans équipe) — sans lui, teamId
// null retombait sur le pool global partagé uniquement et l'utilisateur ne
// recevait jamais ses propres patterns (audit mémoire 02/09).
async function getPatternContext(teamId, userId = null) {
  let patterns;
  try {
    patterns = await db.memoryPatterns.listForPrompt(8, teamId, teamId ? null : userId);
  } catch {
    patterns = [];
  }
  if (patterns.length === 0) return { text: '', ids: [] };
  return {
    text: patterns.map(p => `- ${p.applied ? '[APPROVED]' : `[${p.confidence}]`} ${p.pattern}`).join('\n'),
    ids: patterns.map(p => p.id),
  };
}

// ─── Resolve team ───

async function getTeamId(userId) {
  try {
    const team = await db.teams.getByUser(userId);
    return team?.id || null;
  } catch { return null; }
}

module.exports = { getTimingContext, getCopyContext, getPatternContext, getTeamId };
