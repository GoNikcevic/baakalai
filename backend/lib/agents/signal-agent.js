/**
 * Signal Agent — Detect buying signals and build prospect lists
 *
 * Monitors multiple sources for signals that indicate a prospect is ready to buy:
 * - Funding / investment rounds
 * - Hiring activity (especially sales/marketing roles)
 * - Company news (expansion, partnerships, product launches)
 * - Job changes (promotions, new hires in decision-making roles)
 * - Competitor engagement (mentions, reviews, switches)
 * - Leadership changes
 * - Event attendance
 *
 * Sources: Brave Search (web), Apollo (enrichment), News APIs
 *
 * Runs daily per user. Each detected signal creates a "signal card"
 * that the user can action (add to CRM, send email, deploy to Lemlist).
 */

const db = require('../../db');
const claude = require('../../api/claude');
const logger = require('../logger');
const { safeParseClaudeArray } = require('../utils/safe-json-parse');

const SIGNAL_QUERIES = {
  funding: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    return `(${sectors} ${keywords}) (funding OR "raised" OR "series" OR "seed round" OR "investment") site:techcrunch.com OR site:crunchbase.com OR site:bloomberg.com`;
  },
  hiring: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    const titles = config.target_titles?.join(' OR ') || 'sales marketing growth';
    return `(${sectors} ${keywords}) hiring (${titles}) -site:linkedin.com`;
  },
  news: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    return `(${sectors} ${keywords}) (expansion OR partnership OR launch OR acquisition) -site:reddit.com`;
  },
  job_change: (config) => {
    const titles = config.target_titles?.join(' OR ') || 'CEO CTO CMO VP Director';
    const sectors = config.target_sectors?.join(' OR ') || '';
    return `(${sectors}) "just joined" OR "new role" OR "promoted to" (${titles})`;
  },
  leadership_change: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    return `(${sectors} ${keywords}) ("new CEO" OR "new CTO" OR "appoints" OR "names") -site:reddit.com`;
  },
  competitor: (config) => {
    const competitors = config.target_competitors?.join(' OR ') || '';
    if (!competitors) return null;
    return `(${competitors}) (review OR alternative OR switch OR complaint OR "moved from")`;
  },
  product_launch: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    return `(${sectors} ${keywords}) ("just launched" OR "product launch" OR "new feature" OR "now available") site:producthunt.com OR site:techcrunch.com`;
  },
  expansion: (config) => {
    const sectors = config.target_sectors?.join(' OR ') || '';
    const keywords = config.target_keywords?.join(' OR ') || '';
    return `(${sectors} ${keywords}) ("opens office" OR "expands to" OR "new market" OR "international expansion")`;
  },
  tech_adoption: (config) => {
    const keywords = config.target_keywords?.join(' OR ') || '';
    if (!keywords) return null;
    return `(${keywords}) ("switched to" OR "migrated to" OR "now using" OR "adopted")`;
  },
};

/**
 * Run the signal agent for a user.
 */
async function run(userId) {
  const report = { detected: 0, configs: 0, errors: [] };

  try {
    // Load user's signal configs
    const configs = await db.query(
      `SELECT * FROM signal_configs WHERE user_id = $1 AND enabled = true`,
      [userId]
    );

    if (configs.rows.length === 0) return report;
    report.configs = configs.rows.length;

    // Load existing signals to avoid duplicates (last 7 days)
    const recent = await db.query(
      `SELECT title, company_name FROM signals WHERE user_id = $1 AND detected_at > now() - interval '7 days'`,
      [userId]
    );
    const recentSet = new Set(recent.rows.map(r => `${r.title}::${r.company_name}`.toLowerCase()));

    for (const config of configs.rows) {
      try {
        const signalTypes = config.signal_types || ['funding', 'hiring', 'news'];

        for (const signalType of signalTypes) {
          const queryBuilder = SIGNAL_QUERIES[signalType];
          if (!queryBuilder) continue;

          const searchQuery = queryBuilder(config);
          if (!searchQuery) continue;

          // Search via Brave Search
          const results = await searchBrave(searchQuery);
          if (!results || results.length === 0) continue;

          // Use Claude to extract structured signals from search results
          const signals = await extractSignals(results, signalType, config);

          for (const signal of signals) {
            // Dedup
            const key = `${signal.title}::${signal.companyName}`.toLowerCase();
            if (recentSet.has(key)) continue;
            recentSet.add(key);

            // Try to enrich with email via Apollo
            let enriched = {};
            if (signal.companyName) {
              try {
                enriched = await enrichContact(signal, userId);
              } catch { /* enrichment is optional */ }
            }

            // Insert signal
            try {
              await db.query(`
                INSERT INTO signals (user_id, config_id, signal_type, title, description, source_url, source,
                  company_name, company_domain, contact_name, contact_title, contact_email, contact_linkedin, relevance_score)
                VALUES ($1, $2, $3, $4, $5, $6, 'brave_search', $7, $8, $9, $10, $11, $12, $13)
              `, [
                userId, config.id, signalType,
                signal.title, signal.description, signal.sourceUrl,
                signal.companyName, enriched.domain || signal.companyDomain || null,
                enriched.contactName || signal.contactName || null,
                enriched.contactTitle || signal.contactTitle || null,
                enriched.email || null,
                enriched.linkedinUrl || null,
                signal.relevance || 50,
              ]);
              report.detected++;
            } catch (insertErr) {
              logger.warn('signal-agent', `Insert failed for "${signal.title}": ${insertErr.message}`);
            }
          }
        }

        // Update last_run
        await db.query(`UPDATE signal_configs SET last_run = now() WHERE id = $1`, [config.id]);
      } catch (err) {
        report.errors.push(`Config ${config.name}: ${err.message}`);
        logger.warn('signal-agent', `Config ${config.name} failed: ${err.message}`);
      }
    }
  } catch (err) {
    report.errors.push(err.message);
    logger.error('signal-agent', err.message);
  }

  // Notify user of high-relevance signals
  if (report.detected > 0) {
    logger.info('signal-agent', `User ${userId}: ${report.detected} signals detected from ${report.configs} configs`);

    try {
      const highRelevance = await db.query(
        `SELECT COUNT(*) AS count FROM signals WHERE user_id = $1 AND status = 'new' AND relevance_score >= 70 AND detected_at > now() - interval '1 day'`,
        [userId]
      );
      const count = parseInt(highRelevance.rows[0]?.count || 0);
      if (count > 0) {
        const { notifyUser } = require('../../socket');
        notifyUser(userId, 'signals', {
          type: 'new_signals',
          count,
          message: `${count} high-relevance signal(s) detected`,
        });
      }
    } catch { /* notifications are optional */ }

    // Auto-prospecting: if user has no outreach tool, auto-add top signals to CRM
    try {
      const hasOutreach = await db.query(
        `SELECT 1 FROM user_integrations WHERE user_id = $1 AND provider IN ('lemlist', 'apollo', 'smartlead') LIMIT 1`,
        [userId]
      );
      if (hasOutreach.rows.length === 0) {
        // No outreach tool — auto-add top signals to CRM
        const topSignals = await db.query(
          `SELECT id, contact_name, contact_email, contact_title, company_name, contact_linkedin
           FROM signals WHERE user_id = $1 AND status = 'new' AND relevance_score >= 75 AND contact_email IS NOT NULL
           ORDER BY relevance_score DESC LIMIT 5`,
          [userId]
        );
        for (const s of topSignals.rows) {
          try {
            await db.opportunities.create({
              userId, name: s.contact_name || s.company_name || 'Unknown',
              email: s.contact_email, title: s.contact_title, company: s.company_name,
              status: 'new', linkedinUrl: s.contact_linkedin,
            });
            await db.query(`UPDATE signals SET status = 'actioned', action_taken = 'auto_crm', actioned_at = now() WHERE id = $1`, [s.id]);
            report.autoAdded = (report.autoAdded || 0) + 1;
          } catch { /* skip duplicates */ }
        }
        if (report.autoAdded > 0) {
          logger.info('signal-agent', `Auto-added ${report.autoAdded} high-relevance prospects to CRM (no outreach tool)`);
        }
      }
    } catch { /* auto-prospecting is optional */ }
  }

  return report;
}

/**
 * Search Brave and return raw results.
 */
async function searchBrave(query) {
  // api/brave-search.js lit BRAVE_SEARCH_API_KEY : accepter les deux noms,
  // sinon un scan avec la seule autre variable posée rapporte « 0 signal »
  // sans aucune erreur.
  const apiKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    logger.warn('signal-agent', 'BRAVE_API_KEY/BRAVE_SEARCH_API_KEY absente — scan de signaux impossible');
    return [];
  }

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age,
    }));
  } catch {
    return [];
  }
}

/**
 * Use Claude to extract structured signal data from search results.
 */
async function extractSignals(results, signalType, config) {
  const resultsText = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join('\n\n');

  const prompt = `Extract buying signals from these search results.
Signal type: ${signalType}
Target sectors: ${(config.target_sectors || []).join(', ') || 'any'}
Target titles: ${(config.target_titles || []).join(', ') || 'any decision maker'}

Search results:
${resultsText}

For each RELEVANT result (skip irrelevant ones), extract:
- title: short signal description (e.g., "CryptoX raises $15M Series A")
- description: 1-2 sentences explaining why this is relevant
- companyName: the company involved
- companyDomain: website if visible
- contactName: person mentioned (if any)
- contactTitle: their role (if any)
- sourceUrl: the URL
- relevance: 0-100 score based on how strong this buying signal is

Return JSON array: [{ title, description, companyName, companyDomain, contactName, contactTitle, sourceUrl, relevance }]
Return empty array [] if nothing is relevant.`;

  try {
    const result = await claude.callClaude('Return only valid JSON array.', prompt, 1500, 'signal_extraction');
    const parsed = safeParseClaudeArray(result);
    if (!Array.isArray(parsed)) {
      logger.warn('signal-agent', 'extraction: reponse non parsable, signaux ignores');
      return [];
    }
    return parsed.filter(s => s.title && s.relevance >= 30);
  } catch (err) {
    // Un tableau vide et une panne d'extraction se lisaient pareil en amont :
    // "aucun signal detecte". On distingue les deux dans les logs.
    logger.warn('signal-agent', `extraction echouee: ${err.message}`);
    return [];
  }
}

/**
 * Try to enrich a signal with contact email via Apollo.
 * Uses the USER's Apollo key if available.
 */
async function enrichContact(signal, userId) {
  try {
    // Use user's Apollo key (not a shared key)
    const { getUserKey } = require('../../config');
    const apiKey = userId ? await getUserKey(userId, 'apollo') : null;
    if (!apiKey) return {}; // No Apollo connected — skip enrichment

    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        q_organization_name: signal.companyName,
        person_titles: signal.contactTitle ? [signal.contactTitle] : ['CEO', 'CTO', 'CMO', 'Founder'],
        per_page: 1,
      }),
    });

    if (!res.ok) return {};
    const data = await res.json();
    const person = data.people?.[0];
    if (!person) return {};

    return {
      contactName: person.name,
      contactTitle: person.title,
      email: person.email,
      linkedinUrl: person.linkedin_url,
      domain: person.organization?.primary_domain,
    };
  } catch {
    return {};
  }
}

module.exports = { run };
