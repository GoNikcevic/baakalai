/**
 * Template Generation Agent
 *
 * Generates and updates campaign templates by analyzing:
 * 1. Memory patterns (what angles/tones/subjects work per sector)
 * 2. Campaign stats (open rates, reply rates by sector/persona)
 * 3. Existing templates (avoid duplicates, improve low-performers)
 *
 * Can run:
 * - Scheduled: weekly (part of Memory Agent Sunday run)
 * - On-demand: user asks "generate templates for X sector"
 * - Auto: when enough data accumulates for a new sector
 *
 * Templates are stored in the templates table and shown in the chat
 * campaign creation flow.
 */

const db = require('../db');
const claude = require('../api/claude');
const logger = require('./logger');

// Sectors to generate templates for
const TARGET_SECTORS = [
  'crypto', 'telecom', 'cybersecurity', 'agency', 'biotech',
  'healthcare', 'saas', 'finance', 'ecommerce', 'manufacturing',
  'consulting', 'real-estate', 'education', 'energy', 'logistics',
];

/**
 * Run the template generation agent.
 * Analyzes patterns + stats and generates/updates templates.
 */
async function runTemplateAgent({ sectors = null, force = false } = {}) {
  const startTime = Date.now();
  const report = { generated: 0, updated: 0, skipped: 0, errors: [] };

  try {
    // 1. Load memory patterns (high confidence)
    const patterns = await db.memoryPatterns.list({ confidence: 'Haute', limit: 50 });

    // 2. Load campaign stats for sector analysis
    const campaigns = await db.query(`
      SELECT c.name, c.sector, c.nb_prospects, c.open_rate, c.reply_rate,
             c.interested, c.meetings, c.status
      FROM campaigns c
      WHERE c.status IN ('active', 'completed') AND c.open_rate IS NOT NULL
      ORDER BY c.created_at DESC LIMIT 200
    `);
    const campStats = campaigns.rows;

    // 3. Load existing templates
    const existing = await db.templates.list();
    const existingSectors = new Set(existing.map(t => t.sector?.toLowerCase()));

    // 4. Determine which sectors to generate for
    const sectorsToGenerate = (sectors || TARGET_SECTORS).filter(sector => {
      if (force) return true;
      // Skip if we already have a recent AI-generated template for this sector
      const hasRecent = existing.some(t =>
        t.sector?.toLowerCase().includes(sector) && t.source === 'ai_agent'
      );
      return !hasRecent;
    });

    if (sectorsToGenerate.length === 0) {
      logger.info('template-agent', 'No sectors need templates. Skipping.');
      report.skipped = TARGET_SECTORS.length;
      return report;
    }

    // 5. Build context from patterns and stats
    const patternContext = buildPatternContext(patterns);
    const statsContext = buildStatsContext(campStats);

    // 6. Generate templates for each sector
    for (const sector of sectorsToGenerate) {
      try {
        const template = await generateTemplate(sector, patternContext, statsContext);
        if (!template) {
          report.skipped++;
          continue;
        }

        // Check if we should update an existing template or create new
        const existingTemplate = existing.find(t =>
          t.source === 'ai_agent' && t.sector?.toLowerCase().includes(sector)
        );

        if (existingTemplate) {
          await db.query(
            `UPDATE templates SET name = $1, description = $2, sequence = $3, tags = $4, updated_at = now() WHERE id = $5`,
            [template.name, template.description, JSON.stringify(template.sequence), template.tags, existingTemplate.id]
          );
          report.updated++;
        } else {
          await db.templates.create({
            name: template.name,
            sector: template.sector,
            channel: template.channel || 'email',
            description: template.description,
            tags: template.tags,
            popularity: 0,
            source: 'ai_agent',
            sequence: template.sequence,
          });
          report.generated++;
        }

        logger.info('template-agent', `Template for ${sector}: ${template.name}`);
      } catch (err) {
        report.errors.push(`${sector}: ${err.message}`);
        logger.warn('template-agent', `Failed for ${sector}: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('template-agent', `Agent failed: ${err.message}`);
  }

  report.duration = Date.now() - startTime;
  logger.info('template-agent', `Done: ${report.generated} generated, ${report.updated} updated, ${report.skipped} skipped (${report.duration}ms)`);
  return report;
}

/**
 * Generate a single template for a sector using Claude.
 */
async function generateTemplate(sector, patternContext, statsContext) {
  const prompt = `Generate a B2B outreach email sequence template for the sector: "${sector}".

${patternContext}

${statsContext}

Requirements:
- 3-4 email steps (E1, E2, E3, optionally E4)
- Each email: max 6 lines, personal tone, specific pain points for this sector
- Use variables: {{firstName}}, {{companyName}}, {{jobTitle}}
- Step timing: E1=J+0, E2=J+3, E3=J+7, E4=J+14 (break-up)
- Include social proof (specific numbers, case study)
- Last email should be a "break-up" email (short, respectful)
- Language: French
- Adapt the angle based on what patterns show works best

Return ONLY valid JSON:
{
  "name": "Template name (sector + persona)",
  "sector": "Sector category",
  "channel": "email",
  "description": "1-line description of the approach",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "sequence": [
    { "step": "E1", "type": "email", "label": "Email initial", "timing": "J+0", "subject": "...", "body": "..." },
    { "step": "E2", "type": "email", "label": "Relance valeur", "timing": "J+3", "subject": "...", "body": "..." },
    { "step": "E3", "type": "email", "label": "Social proof", "timing": "J+7", "subject": "...", "body": "..." }
  ]
}`;

  const result = await claude.callClaude(
    'You are an expert B2B copywriter. Return ONLY valid JSON.',
    prompt,
    2000,
    'template_generation'
  );

  let template = result.parsed;
  if (!template) {
    const match = (result.content || '').match(/\{[\s\S]*"name"[\s\S]*"sequence"[\s\S]*\}/);
    if (match) template = JSON.parse(match[0]);
  }

  if (!template?.name || !template?.sequence?.length) return null;
  return template;
}

/**
 * Build context string from memory patterns for the prompt.
 */
function buildPatternContext(patterns) {
  if (!patterns || patterns.length === 0) return '';

  const relevant = patterns.filter(p =>
    ['Cible', 'Canaux', 'Objection', 'S\u00e9quence'].includes(p.category)
  );

  if (relevant.length === 0) return '';

  return `INSIGHTS FROM PAST CAMPAIGNS (use these to inform the template):
${relevant.map(p => `- [${p.category}] ${p.pattern} (confidence: ${p.confidence})`).join('\n')}`;
}

/**
 * Build context string from campaign stats.
 */
function buildStatsContext(campaigns) {
  if (!campaigns || campaigns.length === 0) return '';

  // Aggregate stats by sector
  const bySector = {};
  for (const c of campaigns) {
    const sector = (c.sector || 'unknown').toLowerCase();
    if (!bySector[sector]) bySector[sector] = { count: 0, openRate: 0, replyRate: 0 };
    bySector[sector].count++;
    bySector[sector].openRate += c.open_rate || 0;
    bySector[sector].replyRate += c.reply_rate || 0;
  }

  const lines = Object.entries(bySector)
    .filter(([, v]) => v.count >= 2)
    .map(([sector, v]) => {
      const avgOpen = Math.round(v.openRate / v.count);
      const avgReply = Math.round(v.replyRate / v.count);
      return `- ${sector}: ${v.count} campaigns, avg ${avgOpen}% open, ${avgReply}% reply`;
    });

  if (lines.length === 0) return '';
  return `CAMPAIGN PERFORMANCE BY SECTOR:\n${lines.join('\n')}`;
}

/**
 * Generate templates for a specific list of sectors (on-demand from chat).
 */
async function generateForSectors(sectors) {
  return runTemplateAgent({ sectors, force: true });
}

module.exports = { runTemplateAgent, generateForSectors, TARGET_SECTORS };
