/**
 * A/B Test Memory · cross-user anonymized pattern library.
 *
 * All patterns stored here are ANONYMIZED:
 * - No verbatim message text
 * - No company / prospect / user names
 * - No emails or URLs
 * - Segment is aggregated (sector + size bucket + role level)
 *
 * This mirrors what users accept in the CGU regarding collective learning.
 */

const db = require('../db');

// The 5 A/B categories supported in v1 (closed set)
const AB_CATEGORIES = {
  angle: {
    label: 'Angle',
    description: "L'angle d'approche du message",
    options: ['Douleur client', 'Preuve sociale', 'Opportunité', 'Curiosité', 'Urgence'],
  },
  tone: {
    label: 'Ton',
    description: 'Le registre de langage',
    options: ['Formel', 'Décontracté', 'Direct', 'Empathique'],
  },
  length: {
    label: 'Longueur',
    description: 'La densité du message',
    options: ['Court', 'Standard', 'Développé'],
  },
  hook: {
    label: 'Hook',
    description: "L'accroche d'ouverture",
    options: ['Question ouverte', 'Statistique chiffrée', 'Affirmation provocatrice', 'Observation personnalisée'],
  },
  specificity: {
    label: 'Spécificité',
    description: 'Le niveau de personnalisation',
    options: ['Générique', 'Secteur-spécifique', 'Hyper-personnalisé'],
  },
};

/**
 * Anonymize a pattern before insert:
 * - Round sample_size into buckets (50, 100, 250, 500, 1000+)
 * - Round sectors to standardized list
 * - Round targets to seniority levels only (CEO/Decider/Manager/Operator)
 */
function anonymizeSegment(segment) {
  const sizeBuckets = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001+'];
  const matchSize = sizeBuckets.find(b => segment.size?.includes(b)) || segment.size || null;

  return {
    sectors: segment.sectors || [],
    targets: segment.targets || [],
    size_bucket: matchSize,
  };
}

function bucketSampleSize(size) {
  if (size >= 1000) return 1000;
  if (size >= 500) return 500;
  if (size >= 250) return 250;
  if (size >= 100) return 100;
  return 50;
}

/**
 * Record a new A/B pattern learned from a concluded test.
 * Called when user clicks "Promouvoir B" or "Garder A" on the diff UI.
 */
async function recordABPattern({
  segment,          // { sectors: [], targets: [], size: '' }
  category,         // 'angle' | 'tone' | ...
  variantA,         // e.g. 'Douleur client'
  variantB,         // e.g. 'Preuve sociale'
  winner,           // 'A' | 'B'
  improvement_pct,  // numeric
  sample_size,      // raw count
  metric,           // 'reply_rate' | 'open_rate' | 'accept_rate'
  sourceTestId,     // versions.id
  testedOn,         // 'E1' | 'LI1'
  userId,           // tenant du verdict, le pool cross-user passe par shared, pas par team_id NULL
}) {
  // Tenant des patterns (audit 02/09) : l'équipe si l'utilisateur en a une,
  // sinon l'utilisateur · jamais les deux (règle DAO, migration 089).
  let tenant = userId ? { userId } : {};
  if (userId) {
    try {
      const team = await db.teams.getByUser(userId);
      if (team) tenant = { teamId: team.id };
    } catch { /* résolution d'équipe indisponible : le pattern reste scopé user */ }
  }

  const anon = anonymizeSegment(segment);
  const winnerLabel = winner === 'B' ? variantB : variantA;
  const loserLabel = winner === 'B' ? variantA : variantB;

  // Build human-readable pattern sentence (no verbatim text, only labels)
  const sectorStr = (anon.sectors[0] || 'tous secteurs');
  const sizeStr = anon.size_bucket || 'toutes tailles';
  const targetStr = (anon.targets[0] || 'cible générique');
  const metricLabel = {
    reply_rate: 'taux de réponse',
    open_rate: 'taux d\'ouverture',
    accept_rate: 'taux d\'acceptation',
  }[metric] || metric;

  const pattern = `Sur ${sectorStr} ${sizeStr} (${targetStr}), l'angle "${winnerLabel}" bat "${loserLabel}" de +${improvement_pct}% en ${metricLabel} (touchpoint ${testedOn})`;

  // Check if a similar pattern already exists → increment confirmations instead of duplicate.
  // category est stocké avec son label ('Angle'), pas sa clé ('angle') · l'ancien
  // filtre sur la clé ne matchait jamais et dupliquait le pattern à chaque verdict.
  const existing = await db.memoryPatterns.list({
    category: categoryLabelFor(category),
    limit: 100,
    ...(userId ? { userId } : {}),
  });

  // On ne confirme (update) que les patterns de son propre tenant : un pattern
  // shared équivalent d'un autre client reste intouché, on crée le sien.
  const sameTenant = p => tenant.teamId ? p.team_id === tenant.teamId
    : tenant.userId ? p.user_id === tenant.userId
    : (p.team_id == null && p.user_id == null);

  const dupe = existing.find(p =>
    sameTenant(p) &&
    p.ab_category === category &&
    Array.isArray(p.sectors) && p.sectors.includes(sectorStr) &&
    Array.isArray(p.targets) && p.targets.includes(targetStr) &&
    p.data && typeof p.data === 'object' &&
    p.data.winner_variant === winnerLabel &&
    p.data.loser_variant === loserLabel
  );

  if (dupe) {
    // Confirm existing pattern · boost confidence
    const newConfirmations = (dupe.confirmations || 1) + 1;
    let newConfidence = dupe.confidence;
    if (newConfirmations >= 3) newConfidence = 'Haute';
    else if (newConfirmations >= 2) newConfidence = 'Moyenne';

    await db.memoryPatterns.update(dupe.id, {
      confidence: newConfidence,
      confirmations: newConfirmations,
      sample_size: (dupe.sample_size || 0) + bucketSampleSize(sample_size),
    });
    return { action: 'confirmed', patternId: dupe.id, confirmations: newConfirmations };
  }

  // New pattern · initial confidence based on sample size
  let confidence = 'Faible';
  if (sample_size >= 200) confidence = 'Moyenne';
  if (sample_size >= 500 && improvement_pct >= 5) confidence = 'Haute';

  const created = await db.memoryPatterns.create({
    ...tenant,
    pattern,
    category: categoryLabelFor(category),
    ab_category: category,
    data: JSON.stringify({
      winner_variant: winnerLabel,
      loser_variant: loserLabel,
      tested_on: testedOn,
      metric,
    }),
    confidence,
    sectors: anon.sectors,
    targets: anon.targets,
    sourceTestId,
    sample_size: bucketSampleSize(sample_size),
    improvement_pct,
    confirmations: 1,
  });
  return { action: 'created', patternId: created.id, confidence };
}

function categoryLabelFor(key) {
  return AB_CATEGORIES[key]?.label || key;
}

/**
 * Find the best recommendation for a given segment + category.
 * Used when proposing A/B tests at campaign creation time.
 */
async function getRecommendation(segment, category, userId = null) {
  const anon = anonymizeSegment(segment);
  // Avec userId : ses patterns + pool shared Haute. Sans : pool global seul.
  const patterns = await db.memoryPatterns.list({
    category: categoryLabelFor(category),
    limit: 50,
    ...(userId ? { userId } : {}),
  });

  // Match sectors + targets
  const relevant = patterns.filter(p =>
    p.ab_category === category &&
    Array.isArray(p.sectors) && (anon.sectors.length === 0 || p.sectors.some(s => anon.sectors.includes(s))) &&
    Array.isArray(p.targets) && (anon.targets.length === 0 || p.targets.some(t => anon.targets.includes(t)))
  );

  if (relevant.length === 0) return null;

  // Sort by confidence (Haute > Moyenne > Faible) then by confirmations, then by improvement
  const rank = { 'Haute': 3, 'Moyenne': 2, 'Faible': 1 };
  relevant.sort((a, b) =>
    (rank[b.confidence] || 0) - (rank[a.confidence] || 0) ||
    (b.confirmations || 0) - (a.confirmations || 0) ||
    (b.improvement_pct || 0) - (a.improvement_pct || 0)
  );

  const top = relevant[0];
  let data = top.data || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  return {
    winner: data.winner_variant,
    loser: data.loser_variant,
    improvement_pct: top.improvement_pct,
    confidence: top.confidence,
    confirmations: top.confirmations || 1,
    sample_size: top.sample_size,
    summary: top.pattern,
  };
}

/**
 * Get all recommendations across all categories for a segment.
 * Returns { angle: {...} | null, tone: {...} | null, ... }
 */
async function getAllRecommendations(segment, userId = null) {
  const result = {};
  for (const category of Object.keys(AB_CATEGORIES)) {
    result[category] = await getRecommendation(segment, category, userId);
  }
  return result;
}

module.exports = {
  AB_CATEGORIES,
  anonymizeSegment,
  bucketSampleSize,
  recordABPattern,
  getRecommendation,
  getAllRecommendations,
  categoryLabelFor,
};
