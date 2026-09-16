/* ===============================================================================
   BAKAL · Unified Outreach Sync & Analysis
   Background task: pulls campaign history from Apollo/Instantly/Smartlead,
   analyzes with Claude, and populates memory_patterns table.
   =============================================================================== */

const { getUserKey } = require('../config');
const claude = require('../api/claude');
const db = require('../db');
const { notifyUser } = require('../socket');
const logger = require('./logger');

// API configurations per provider
const PROVIDERS = {
  apollo: {
    name: 'Apollo',
    baseUrl: 'https://api.apollo.io/v1',
    async fetchCampaigns(apiKey) {
      const res = await fetch('https://api.apollo.io/v1/emailer_campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ per_page: 100 }),
      });
      if (!res.ok) throw new Error(`Apollo API ${res.status}`);
      const data = await res.json();
      return (data.emailer_campaigns || []).map(c => ({
        id: c.id,
        name: c.name,
        status: c.active ? 'active' : 'paused',
      }));
    },
    async fetchStats(apiKey, campaignId) {
      const res = await fetch(`https://api.apollo.io/v1/emailer_campaigns/${campaignId}`, {
        headers: { 'x-api-key': apiKey },
      });
      if (!res.ok) throw new Error(`Apollo stats ${res.status}`);
      const data = await res.json();
      const c = data.emailer_campaign || {};
      const total = c.unique_delivered || c.total_emails_sent || 0;
      return {
        contacts: total,
        openRate: total > 0 ? Math.round((c.unique_opened || 0) / total * 100) : 0,
        replyRate: total > 0 ? Math.round((c.unique_replied || 0) / total * 100) : 0,
        interested: c.unique_replied || 0,
        meetings: 0,
        acceptRate: 0,
      };
    },
  },

  instantly: {
    name: 'Instantly',
    baseUrl: 'https://api.instantly.ai/api/v1',
    async fetchCampaigns(apiKey) {
      const res = await fetch(`https://api.instantly.ai/api/v1/campaign/list?api_key=${apiKey}`);
      if (!res.ok) throw new Error(`Instantly API ${res.status}`);
      const data = await res.json();
      return (data || []).map(c => ({
        id: c.id,
        name: c.name,
        status: c.status === 1 ? 'active' : 'paused',
      }));
    },
    async fetchStats(apiKey, campaignId) {
      const res = await fetch(`https://api.instantly.ai/api/v1/analytics/campaign/summary?api_key=${apiKey}&campaign_id=${campaignId}`);
      if (!res.ok) throw new Error(`Instantly stats ${res.status}`);
      const data = await res.json();
      const total = data.total_emails_sent || 0;
      return {
        contacts: total,
        openRate: total > 0 ? Math.round((data.emails_read || 0) / total * 100) : 0,
        replyRate: total > 0 ? Math.round((data.emails_replied || 0) / total * 100) : 0,
        interested: data.emails_replied || 0,
        meetings: 0,
        acceptRate: 0,
      };
    },
  },

  smartlead: {
    name: 'Smartlead',
    baseUrl: 'https://server.smartlead.ai/api/v1',
    async fetchCampaigns(apiKey) {
      const res = await fetch(`https://server.smartlead.ai/api/v1/campaigns?api_key=${apiKey}`);
      if (!res.ok) throw new Error(`Smartlead API ${res.status}`);
      const data = await res.json();
      return (data || []).map(c => ({
        id: c.id,
        name: c.name,
        status: c.status === 'ACTIVE' ? 'active' : 'paused',
      }));
    },
    async fetchStats(apiKey, campaignId) {
      const res = await fetch(`https://server.smartlead.ai/api/v1/campaigns/${campaignId}/analytics?api_key=${apiKey}`);
      if (!res.ok) throw new Error(`Smartlead stats ${res.status}`);
      const data = await res.json();
      const total = data.sent_count || 0;
      return {
        contacts: total,
        openRate: total > 0 ? Math.round((data.open_count || 0) / total * 100) : 0,
        replyRate: total > 0 ? Math.round((data.reply_count || 0) / total * 100) : 0,
        interested: data.reply_count || 0,
        meetings: 0,
        acceptRate: 0,
      };
    },
  },
};

/**
 * Sync any outreach tool and analyze with Claude.
 * @param {string} userId
 * @param {string} provider · 'apollo' | 'instantly' | 'smartlead'
 */
async function syncOutreach(userId, provider) {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) throw new Error(`Unknown provider: ${provider}`);

  const eventName = 'outreach:sync';

  try {
    const apiKey = await getUserKey(userId, provider);
    if (!apiKey) throw new Error(`No ${providerConfig.name} API key configured`);

    notifyUser(userId, eventName, { status: 'starting', progress: 0, provider: providerConfig.name });

    // Fetch campaigns
    let campaigns;
    try {
      campaigns = await providerConfig.fetchCampaigns(apiKey);
    } catch (err) {
      logger.error('outreach-sync', `Failed to fetch ${providerConfig.name} campaigns`, { error: err.message });
      throw err;
    }

    notifyUser(userId, eventName, {
      status: 'fetching', progress: 10,
      message: `${campaigns.length} campagnes trouvées sur ${providerConfig.name}`,
      provider: providerConfig.name,
    });

    // Fetch stats per campaign
    const allStats = [];
    for (let i = 0; i < campaigns.length; i++) {
      try {
        const stats = await providerConfig.fetchStats(apiKey, campaigns[i].id);
        allStats.push({ name: campaigns[i].name, id: campaigns[i].id, ...stats });
      } catch (err) {
        logger.warn('outreach-sync', `Stats failed for "${campaigns[i].name}"`, { error: err.message });
        allStats.push({ name: campaigns[i].name, id: campaigns[i].id, contacts: 0, openRate: 0, replyRate: 0, interested: 0, meetings: 0, acceptRate: 0 });
      }

      notifyUser(userId, eventName, {
        status: 'fetching',
        progress: 10 + Math.round(((i + 1) / campaigns.length) * 40),
        message: `Stats collectées: ${i + 1}/${campaigns.length}`,
        provider: providerConfig.name,
      });
    }

    if (allStats.length === 0) {
      notifyUser(userId, eventName, { status: 'done', progress: 100, message: `Aucune campagne trouvée sur ${providerConfig.name}`, patternsCount: 0, provider: providerConfig.name });
      return { campaigns: 0, patterns: 0 };
    }

    // Claude analysis
    notifyUser(userId, eventName, { status: 'analyzing', progress: 60, message: 'Claude analyse vos campagnes...', provider: providerConfig.name });

    const analysisInput = allStats.map(s =>
      `Campagne "${s.name}": ${s.contacts} contacts, ouverture ${s.openRate}%, réponse ${s.replyRate}%, intéressés ${s.interested}, RDV ${s.meetings}`
    ).join('\n');

    const systemPrompt = `Tu es un expert en prospection B2B. Analyse l'historique de campagnes ${providerConfig.name} ci-dessous et identifie les patterns de performance.

Pour chaque pattern identifié, donne:
- pattern: ce qui fonctionne ou ne fonctionne pas
- category: "Objets" | "Corps" | "Timing" | "LinkedIn" | "Cible"
- confidence: "Haute" (>200 prospects) | "Moyenne" (50-200) | "Faible" (<50)
- sectors: secteurs concernés (tableau)
- targets: cibles concernées (tableau)

Retourne un JSON: { "patterns": [...] }
Sois spécifique et actionnable. Base-toi uniquement sur les données fournies.`;

    const result = await claude.callClaude(systemPrompt, analysisInput, 4000);

    notifyUser(userId, eventName, { status: 'saving', progress: 85, message: 'Sauvegarde des patterns...', provider: providerConfig.name });

    let patternsCount = 0;
    if (result.parsed && result.parsed.patterns) {
      for (const p of result.parsed.patterns) {
        try {
          await db.memoryPatterns.create({
            pattern: p.pattern,
            category: p.category || 'Corps',
            data: JSON.stringify({ source: `${provider}_sync`, campaigns: allStats.length }),
            confidence: p.confidence || 'Faible',
            sectors: p.sectors || [],
            targets: p.targets || [],
          });
          patternsCount++;
        } catch (err) {
          logger.warn('outreach-sync', 'Failed to save pattern', { error: err.message });
        }
      }
    }

    notifyUser(userId, eventName, {
      status: 'done', progress: 100,
      message: `Analyse terminée, ${patternsCount} patterns identifiés sur ${allStats.length} campagnes (${providerConfig.name})`,
      patternsCount, campaignsCount: allStats.length, provider: providerConfig.name,
    });

    return { campaigns: allStats.length, patterns: patternsCount };
  } catch (err) {
    logger.error('outreach-sync', `Error syncing ${providerConfig.name}`, { error: err.message });
    notifyUser(userId, eventName, { status: 'error', progress: 0, message: err.message, provider: providerConfig.name });
    throw err;
  }
}

module.exports = { syncOutreach, PROVIDERS };
