/**
 * Contextual Personalization Agent
 *
 * For each prospect in a campaign, searches for recent context about
 * their company and generates a personalized icebreaker/opening line.
 *
 * Uses: Brave Search (already integrated) + Claude Haiku (fast, cheap)
 */

const { webSearch } = require('../api/brave-search');
const claude = require('../api/claude');
const logger = require('./logger');
const db = require('../db');

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 500;

/** Sleep helper */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enrich a single prospect with web context.
 * @param {object} prospect - { name, company, title, email }
 * @param {object} options  - { language, tone, formality }
 * @returns {{ context: string, icebreaker: string, sources: string[] }}
 */
async function enrichProspectContext(prospect, options = {}) {
  const { language = 'fr', tone = 'Pro decontracte', formality = 'Vous' } = options;
  const year = new Date().getFullYear();
  const company = prospect.company || '';
  const name = prospect.name || '';

  if (!company && !name) {
    return { context: '', icebreaker: '', sources: [] };
  }

  // 1. Search Brave for recent news about the company
  let companyResults = [];
  if (company) {
    const langTerms = language === 'fr'
      ? 'actualites OR news OR annonce'
      : 'news OR announcement OR launch';
    const query = `"${company}" ${langTerms} ${year}`;
    try {
      companyResults = await webSearch(query, 5);
    } catch (err) {
      logger.warn('personalization', `Brave search failed for company "${company}"`, { error: err.message });
    }
  }

  // 2. Search for the prospect on LinkedIn (optional, best-effort)
  let linkedinResults = [];
  if (name && company) {
    try {
      linkedinResults = await webSearch(`"${name}" "${company}" site:linkedin.com`, 3);
    } catch (err) {
      logger.warn('personalization', `LinkedIn search failed for "${name}"`, { error: err.message });
    }
  }

  const allResults = [...companyResults, ...linkedinResults];
  const sources = allResults.map(r => r.url).filter(Boolean);

  if (allResults.length === 0) {
    return { context: '', icebreaker: '', sources: [] };
  }

  // 3. Build context summary from search results
  const searchSummary = allResults
    .map(r => `- ${r.title}: ${r.description}${r.age ? ` (${r.age})` : ''}`)
    .join('\n');

  // 4. Use Claude Haiku to synthesize context + icebreaker
  const langInstruction = language === 'fr'
    ? 'Reponds en francais.'
    : 'Respond in English.';

  const systemPrompt = `Tu es un assistant de prospection B2B. A partir de resultats de recherche web sur une entreprise et un prospect, tu generes :
1. Un contexte court (1-2 phrases) resumant l'actualite recente la plus pertinente de l'entreprise.
2. Un icebreaker personnalise (1-2 phrases max) qu'un commercial pourrait utiliser en ouverture d'email ou de message LinkedIn.

Contraintes :
- Ton : ${tone}
- Formulation : ${formality === 'Tu' ? 'Tutoiement' : 'Vouvoiement'}
- ${langInstruction}
- L'icebreaker doit montrer une connaissance du METIER et de l'ACTUALITE, pas juste du prospect
- Ne mentionne JAMAIS l'IA, l'automatisation, ou que l'info a ete "recherchee"
- L'icebreaker doit se lire comme une remarque naturelle d'un expert du secteur
- Pas de formule bateaux ("j'espere que vous allez bien", etc.)

Reponds UNIQUEMENT au format JSON :
{ "context": "...", "icebreaker": "..." }`;

  const userContent = `Prospect : ${name}
Poste : ${prospect.title || 'inconnu'}
Entreprise : ${company}

Resultats de recherche web :
${searchSummary}`;

  try {
    // Passe par api/claude : client partage, timeout, retry unique, routage par
    // action (config/models.js) et comptabilisation dans llm_usage. L'appel
    // direct au SDK instanciait un client Anthropic par prospect et n'apparaissait
    // dans aucun suivi de cout.
    const { parsed } = await claude.callClaude(systemPrompt, userContent, 300, 'personalization_icebreaker');

    if (!parsed) {
      logger.warn('personalization', 'Reponse non parsable — icebreaker vide', { prospect: name, company });
    }

    return {
      context: parsed?.context || '',
      icebreaker: parsed?.icebreaker || '',
      sources: sources.slice(0, 5),
    };
  } catch (err) {
    logger.error('personalization', 'Appel Claude echoue', { prospect: name, error: err.message });
    return { context: '', icebreaker: '', sources };
  }
}

/**
 * Enrich all prospects in a campaign (batch processing).
 * @param {string} campaignId
 * @param {function} [onProgress] - optional callback({ done, total, current })
 * @returns {{ enriched: number, skipped: number, errors: number, prospects: object[] }}
 */
async function enrichCampaignProspects(campaignId, onProgress) {
  // Load campaign to get tone/formality/language settings
  const campaign = await db.campaigns.get(campaignId);
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.status = 404;
    throw err;
  }

  const options = {
    language: campaign.language || 'fr',
    tone: campaign.tone || 'Pro decontracte',
    formality: campaign.formality || 'Vous',
  };

  // Load prospects (opportunities) for this campaign
  const prospectsResult = await db.opportunities.listByCampaign(campaignId);
  const prospects = prospectsResult || [];

  if (prospects.length === 0) {
    return { enriched: 0, skipped: 0, errors: 0, prospects: [] };
  }

  let enriched = 0;
  let skipped = 0;
  let errors = 0;
  const enrichedProspects = [];

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < prospects.length; i += BATCH_SIZE) {
    const batch = prospects.slice(i, i + BATCH_SIZE);

    const batchPromises = batch.map(async (prospect) => {
      // Skip if already enriched recently (within 7 days)
      if (prospect.personalization?.enrichedAt) {
        const enrichedDate = new Date(prospect.personalization.enrichedAt);
        const daysSince = (Date.now() - enrichedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) {
          skipped++;
          enrichedProspects.push(prospect);
          return;
        }
      }

      // Skip if no company and no name
      if (!prospect.company && !prospect.name) {
        skipped++;
        enrichedProspects.push(prospect);
        return;
      }

      try {
        const result = await enrichProspectContext({
          name: prospect.name,
          company: prospect.company,
          title: prospect.title,
          email: prospect.email,
        }, options);

        if (!result.icebreaker) {
          skipped++;
          enrichedProspects.push(prospect);
          return;
        }

        const personalization = {
          context: result.context,
          icebreaker: result.icebreaker,
          sources: result.sources,
          enrichedAt: new Date().toISOString(),
        };

        // Store in DB
        await db.opportunities.update(prospect.id, { personalization });

        enriched++;
        enrichedProspects.push({ ...prospect, personalization });
      } catch (err) {
        logger.error('personalization', 'Failed to enrich prospect', {
          prospectId: prospect.id,
          error: err.message,
        });
        errors++;
        enrichedProspects.push(prospect);
      }
    });

    await Promise.all(batchPromises);

    if (onProgress) {
      onProgress({
        done: Math.min(i + BATCH_SIZE, prospects.length),
        total: prospects.length,
        enriched,
        skipped,
        errors,
      });
    }

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < prospects.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  logger.info('personalization', 'Campaign enrichment complete', {
    campaignId,
    enriched,
    skipped,
    errors,
    total: prospects.length,
  });

  return { enriched, skipped, errors, prospects: enrichedProspects };
}

module.exports = { enrichProspectContext, enrichCampaignProspects };
