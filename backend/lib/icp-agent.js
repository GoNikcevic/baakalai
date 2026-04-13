/**
 * ICP Analysis Agent
 *
 * Analyzes campaign performance data across multiple campaigns to identify
 * which prospect profiles (title, sector, company size, zone) generate
 * the best response rates. Returns actionable recommendations.
 *
 * Uses Claude Sonnet (via callClaude with action='analyzeICP') for the analysis.
 * Results are cached for 7 days in the memory_patterns table.
 */

const db = require('../db');
const claude = require('../api/claude');
const logger = require('./logger');

const ICP_CACHE_DAYS = 7;
const ICP_PATTERN_CATEGORY = 'ICP';
const MIN_CAMPAIGNS = 3;

/**
 * Analyze ICP patterns across a user's campaigns.
 * @param {string} userId
 * @returns {{ analysis: object, recommendations: string[], topSegments: object[], worstSegments: object[], summary: string }}
 */
async function analyzeICP(userId) {
  // 1. Load all active/completed campaigns for the user
  const allCampaigns = await db.campaigns.list({ userId });
  const campaigns = allCampaigns.filter(
    c => c.status === 'active' || c.status === 'completed'
  );

  if (campaigns.length < MIN_CAMPAIGNS) {
    return {
      analysis: null,
      recommendations: [],
      topSegments: [],
      worstSegments: [],
      summary: '',
      notEnoughData: true,
      campaignCount: campaigns.length,
    };
  }

  // 2. Load opportunities for this user
  const opportunities = await db.opportunities.listByUser(userId, 1000, 0);

  // 3. Build per-segment metrics
  const segments = buildSegmentMetrics(campaigns, opportunities);

  // 4. Send to Claude for analysis
  const systemPrompt = `Tu es un expert en prospection B2B. On te fournit les metriques de performance par segment (titre, taille entreprise, secteur, zone) des campagnes d'un utilisateur.

Analyse les donnees et identifie :
- Les segments ICP les plus performants (meilleur taux de reponse, plus de RDV)
- Les segments les moins performants a eviter
- Des recommandations actionnables pour ameliorer le ciblage

Retourne UNIQUEMENT un JSON valide avec cette structure :
{
  "topSegments": [
    { "label": "description du segment", "replyRate": number, "meetings": number, "dimension": "title|sector|size|zone" }
  ],
  "worstSegments": [
    { "label": "description du segment", "replyRate": number, "meetings": number, "dimension": "title|sector|size|zone" }
  ],
  "recommendations": ["recommendation 1", "recommendation 2", ...],
  "summary": "Resume en 1-2 phrases du profil ideal identifie"
}

Limite topSegments et worstSegments a 3-5 elements chacun.
Les recommendations doivent etre concretes et actionnables (max 5).`;

  const userContent = `Voici les metriques de performance par segment pour les ${campaigns.length} campagnes de l'utilisateur :

${JSON.stringify(segments, null, 2)}

Campagnes analysees :
${campaigns.map(c => `- ${c.name}: secteur=${c.sector || 'N/A'}, position=${c.position || 'N/A'}, taille=${c.size || 'N/A'}, zone=${c.zone || 'N/A'}, reply_rate=${c.reply_rate || 0}%, meetings=${c.meetings || 0}, prospects=${c.nb_prospects || 0}`).join('\n')}

Opportunites (${opportunities.length} total) :
${opportunities.slice(0, 50).map(o => `- ${o.title || 'N/A'} @ ${o.company || 'N/A'} (${o.company_size || 'N/A'}) — status: ${o.status || 'new'}`).join('\n')}

Analyse ces donnees et identifie le profil client ideal (ICP).`;

  let result;
  try {
    result = await claude.callClaude(systemPrompt, userContent, 3000, 'analyzeICP');
  } catch (err) {
    logger.error('icp-agent', 'Claude analysis failed', { userId, error: err.message });
    throw err;
  }

  const parsed = result.parsed || {
    topSegments: [],
    worstSegments: [],
    recommendations: [],
    summary: '',
  };

  // 5. Store the analysis in memory_patterns as a cached ICP result
  try {
    // Delete any previous ICP analysis for this user
    const existing = await db.memoryPatterns.list({ category: ICP_PATTERN_CATEGORY, limit: 100 });
    const userIcpPatterns = existing.filter(p => {
      try {
        const data = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
        return data && data.userId === userId;
      } catch { return false; }
    });
    for (const old of userIcpPatterns) {
      await db.memoryPatterns.delete(old.id);
    }

    await db.memoryPatterns.create({
      pattern: `ICP Analysis: ${parsed.summary || 'Auto-generated'}`,
      category: ICP_PATTERN_CATEGORY,
      data: JSON.stringify({
        userId,
        analyzedAt: new Date().toISOString(),
        campaignCount: campaigns.length,
        topSegments: parsed.topSegments || [],
        worstSegments: parsed.worstSegments || [],
        recommendations: parsed.recommendations || [],
        summary: parsed.summary || '',
      }),
      confidence: campaigns.length >= 5 ? 'Haute' : 'Moyenne',
      sectors: [...new Set(campaigns.map(c => c.sector).filter(Boolean))],
      targets: [...new Set(campaigns.map(c => c.position).filter(Boolean))],
    });
  } catch (err) {
    logger.error('icp-agent', 'Failed to store ICP analysis', { userId, error: err.message });
    // Non-fatal: still return the analysis
  }

  logger.info('icp-agent', 'ICP analysis completed', {
    userId,
    campaignCount: campaigns.length,
    topSegments: (parsed.topSegments || []).length,
    usage: result.usage,
  });

  return {
    analysis: parsed,
    recommendations: parsed.recommendations || [],
    topSegments: parsed.topSegments || [],
    worstSegments: parsed.worstSegments || [],
    summary: parsed.summary || '',
    notEnoughData: false,
    campaignCount: campaigns.length,
  };
}

/**
 * Get the latest ICP analysis for a user (cached, recomputed weekly).
 * @param {string} userId
 * @returns {object} ICP analysis result
 */
async function getICPAnalysis(userId) {
  // Check if a recent analysis exists in memory_patterns
  try {
    const existing = await db.memoryPatterns.list({ category: ICP_PATTERN_CATEGORY, limit: 100 });
    const userIcp = existing.find(p => {
      try {
        const data = typeof p.data === 'string' ? JSON.parse(p.data) : p.data;
        return data && data.userId === userId;
      } catch { return false; }
    });

    if (userIcp) {
      const data = typeof userIcp.data === 'string' ? JSON.parse(userIcp.data) : userIcp.data;
      const analyzedAt = new Date(data.analyzedAt);
      const daysSince = (Date.now() - analyzedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSince < ICP_CACHE_DAYS) {
        return {
          analysis: data,
          recommendations: data.recommendations || [],
          topSegments: data.topSegments || [],
          worstSegments: data.worstSegments || [],
          summary: data.summary || '',
          notEnoughData: false,
          campaignCount: data.campaignCount || 0,
          cached: true,
          analyzedAt: data.analyzedAt,
        };
      }
    }
  } catch (err) {
    logger.error('icp-agent', 'Failed to read cached ICP', { userId, error: err.message });
  }

  // No valid cache — run fresh analysis
  const result = await analyzeICP(userId);
  return { ...result, cached: false, analyzedAt: new Date().toISOString() };
}

/**
 * Build per-segment metrics from campaigns and opportunities.
 */
function buildSegmentMetrics(campaigns, opportunities) {
  const byTitle = {};
  const bySector = {};
  const bySize = {};
  const byZone = {};

  // From campaigns: aggregate by sector, zone
  for (const c of campaigns) {
    if (c.sector) {
      if (!bySector[c.sector]) bySector[c.sector] = { totalReplyRate: 0, count: 0, meetings: 0, prospects: 0 };
      bySector[c.sector].totalReplyRate += parseFloat(c.reply_rate || 0);
      bySector[c.sector].count += 1;
      bySector[c.sector].meetings += parseInt(c.meetings || 0, 10);
      bySector[c.sector].prospects += parseInt(c.nb_prospects || 0, 10);
    }

    if (c.zone) {
      if (!byZone[c.zone]) byZone[c.zone] = { totalReplyRate: 0, count: 0, meetings: 0, prospects: 0 };
      byZone[c.zone].totalReplyRate += parseFloat(c.reply_rate || 0);
      byZone[c.zone].count += 1;
      byZone[c.zone].meetings += parseInt(c.meetings || 0, 10);
      byZone[c.zone].prospects += parseInt(c.nb_prospects || 0, 10);
    }
  }

  // From opportunities: aggregate by title, company_size
  for (const o of opportunities) {
    if (o.title) {
      const t = o.title.trim();
      if (!byTitle[t]) byTitle[t] = { count: 0, interested: 0, meetings: 0 };
      byTitle[t].count += 1;
      if (['interesse', 'intéressé', 'call planifie', 'call planifié'].includes((o.status || '').toLowerCase())) {
        byTitle[t].interested += 1;
      }
      if (['call planifie', 'call planifié'].includes((o.status || '').toLowerCase())) {
        byTitle[t].meetings += 1;
      }
    }

    if (o.company_size) {
      const s = o.company_size.trim();
      if (!bySize[s]) bySize[s] = { count: 0, interested: 0, meetings: 0 };
      bySize[s].count += 1;
      if (['interesse', 'intéressé', 'call planifie', 'call planifié'].includes((o.status || '').toLowerCase())) {
        bySize[s].interested += 1;
      }
      if (['call planifie', 'call planifié'].includes((o.status || '').toLowerCase())) {
        bySize[s].meetings += 1;
      }
    }
  }

  // Compute averages
  const sectorMetrics = Object.entries(bySector).map(([name, d]) => ({
    name,
    avgReplyRate: d.count > 0 ? +(d.totalReplyRate / d.count).toFixed(1) : 0,
    meetings: d.meetings,
    campaigns: d.count,
    prospects: d.prospects,
  }));

  const zoneMetrics = Object.entries(byZone).map(([name, d]) => ({
    name,
    avgReplyRate: d.count > 0 ? +(d.totalReplyRate / d.count).toFixed(1) : 0,
    meetings: d.meetings,
    campaigns: d.count,
    prospects: d.prospects,
  }));

  const titleMetrics = Object.entries(byTitle).map(([name, d]) => ({
    name,
    opportunities: d.count,
    interested: d.interested,
    meetings: d.meetings,
    interestRate: d.count > 0 ? +((d.interested / d.count) * 100).toFixed(1) : 0,
  }));

  const sizeMetrics = Object.entries(bySize).map(([name, d]) => ({
    name,
    opportunities: d.count,
    interested: d.interested,
    meetings: d.meetings,
    interestRate: d.count > 0 ? +((d.interested / d.count) * 100).toFixed(1) : 0,
  }));

  return {
    byTitle: titleMetrics,
    bySector: sectorMetrics,
    bySize: sizeMetrics,
    byZone: zoneMetrics,
  };
}

module.exports = { analyzeICP, getICPAnalysis, buildSegmentMetrics };
