const db = require('../db');
const claude = require('../api/claude');
const logger = require('./logger');

const PERF_THRESHOLDS = { minOpenRate: 55, minReplyRate: 7, minProspects: 100 };

/**
 * Generate community templates from high-performing campaigns.
 * Anonymizes content, keeps structure and {{variables}}.
 */
async function generateCommunityTemplates() {
  logger.info('template-gen', 'Starting community template generation');

  // Find campaigns that meet performance thresholds
  const result = await db.query(
    `SELECT c.*, u.company FROM campaigns c
     JOIN users u ON c.user_id = u.id
     WHERE c.open_rate >= $1 AND c.reply_rate >= $2 AND c.nb_prospects >= $3
     AND c.status = 'active'
     AND c.id NOT IN (SELECT source_campaign_id FROM templates WHERE source_campaign_id IS NOT NULL)`,
    [PERF_THRESHOLDS.minOpenRate, PERF_THRESHOLDS.minReplyRate, PERF_THRESHOLDS.minProspects]
  );

  const eligibleCampaigns = result.rows;
  logger.info('template-gen', `Found ${eligibleCampaigns.length} eligible campaigns`);

  let created = 0;

  for (const campaign of eligibleCampaigns) {
    try {
      // Get touchpoints
      const touchpoints = await db.touchpoints.listByCampaign(campaign.id);
      if (touchpoints.length === 0) continue;

      // Anonymize: ask Claude to strip company-specific content
      const sequenceText = touchpoints.map(tp =>
        `Step ${tp.step} (${tp.type}): Subject: ${tp.subject || 'N/A'} | Body: ${tp.body}`
      ).join('\n\n');

      const anonymizeResult = await claude.callClaude(
        `Tu es un expert en prospection B2B. Anonymise cette séquence de campagne pour en faire un template réutilisable.

Règles :
- Remplace tout nom d'entreprise spécifique par {{companyName}}
- Remplace tout prénom par {{firstName}}
- Garde les variables Lemlist existantes telles quelles
- Garde le ton, le style, et la structure
- Remplace les chiffres spécifiques à un client par des formulations génériques ("nos clients", "en moyenne")
- Garde les chiffres de benchmark qui sont génériques

Retourne un JSON :
{
  "name": "Nom court du template",
  "description": "Description en 1 ligne",
  "tags": ["tag1", "tag2"],
  "sequence": [
    { "step": "E1", "type": "email", "label": "...", "timing": "...", "subject": "...", "body": "..." }
  ]
}`,
        `Secteur: ${campaign.sector}\nCanal: ${campaign.channel}\nAngle: ${campaign.angle}\n\nSéquence:\n${sequenceText}`,
        3000
      );

      if (anonymizeResult.parsed) {
        const tpl = anonymizeResult.parsed;
        await db.templates.create({
          name: tpl.name || `${campaign.sector} — ${campaign.angle}`,
          sector: campaign.sector || 'Général',
          channel: campaign.channel,
          description: tpl.description || `Template basé sur une campagne performante (${campaign.open_rate}% open, ${campaign.reply_rate}% reply)`,
          tags: tpl.tags || [campaign.channel, campaign.sector_short || campaign.sector],
          popularity: 0,
          source: 'community',
          sourceCampaignId: campaign.id,
          sequence: tpl.sequence || [],
        });
        created++;
        logger.info('template-gen', `Created community template from campaign ${campaign.id} (${campaign.name})`);
      }
    } catch (err) {
      logger.error('template-gen', `Failed to generate template from campaign ${campaign.id}`, { error: err.message });
    }
  }

  return created;
}

/**
 * Generate AI templates from memory patterns in sectors with high-confidence patterns
 * but no existing templates.
 */
async function generateAITemplates() {
  logger.info('template-gen', 'Starting AI template generation');

  // Find sectors with 5+ high-confidence patterns but no templates
  const patterns = await db.memoryPatterns.list({ confidence: 'Haute' });

  // Group by sector
  const sectorPatterns = {};
  for (const p of patterns) {
    for (const sector of (p.sectors || [])) {
      if (!sectorPatterns[sector]) sectorPatterns[sector] = [];
      sectorPatterns[sector].push(p);
    }
  }

  // Get existing template sectors
  const existingTemplates = await db.templates.list();
  const existingSectors = new Set(existingTemplates.map(t => t.sector.toLowerCase()));

  let created = 0;

  for (const [sector, sectorPats] of Object.entries(sectorPatterns)) {
    if (sectorPats.length < 5) continue;
    if (existingSectors.has(sector.toLowerCase())) continue;

    try {
      const patternsText = sectorPats.map(p => `- [${p.category}] ${p.pattern}`).join('\n');

      const result = await claude.callClaude(
        `Tu es un expert en prospection B2B. Génère un template de séquence email basé sur ces patterns de performance validés.

Le template doit :
- Utiliser les patterns qui fonctionnent dans ce secteur
- Inclure 3-4 touchpoints (email ou multi-canal selon les patterns)
- Utiliser les variables Lemlist : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}
- Être directement utilisable

Retourne un JSON :
{
  "name": "Nom du template",
  "description": "Description en 1 ligne",
  "channel": "email|linkedin|multi",
  "tags": ["tag1", "tag2"],
  "sequence": [
    { "step": "E1", "type": "email", "label": "...", "timing": "J+0", "subject": "...", "body": "..." }
  ]
}`,
        `Secteur: ${sector}\n\nPatterns validés:\n${patternsText}`,
        3000
      );

      if (result.parsed) {
        const tpl = result.parsed;
        await db.templates.create({
          name: tpl.name || `${sector} — Template IA`,
          sector,
          channel: tpl.channel || 'email',
          description: tpl.description || `Template généré par IA basé sur ${sectorPats.length} patterns validés`,
          tags: tpl.tags || [sector],
          popularity: 0,
          source: 'ai',
          sequence: tpl.sequence || [],
        });
        created++;
        logger.info('template-gen', `Created AI template for sector "${sector}" from ${sectorPats.length} patterns`);
      }
    } catch (err) {
      logger.error('template-gen', `Failed to generate AI template for sector "${sector}"`, { error: err.message });
    }
  }

  return created;
}

async function runTemplateGeneration() {
  const community = await generateCommunityTemplates();
  const ai = await generateAITemplates();
  logger.info('template-gen', `Template generation complete: ${community} community + ${ai} AI templates created`);
  return { community, ai };
}

module.exports = { runTemplateGeneration, generateCommunityTemplates, generateAITemplates };
