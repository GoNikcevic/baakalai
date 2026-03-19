/* ===============================================================================
   BAKAL — CRM Auto-Sync & Analysis
   Background task: pulls deals/contacts from the user's CRM (HubSpot, Salesforce,
   or Pipedrive), analyzes with Claude, and populates memory_patterns table.
   =============================================================================== */

const { getUserKey } = require('../config');
const claude = require('../api/claude');
const db = require('../db');
const { notifyUser } = require('../socket');

/**
 * Sync deals from the user's CRM and analyze them with Claude.
 * Runs in background — emits socket progress events throughout.
 *
 * @param {string} userId - The user's UUID
 * @returns {{ deals: number, patterns: number }}
 */
async function syncCRM(userId) {
  try {
    notifyUser(userId, 'crm:sync', { status: 'starting', progress: 0 });

    // Detect CRM provider
    let provider = null;
    let apiKey = null;
    for (const p of ['hubspot', 'salesforce', 'pipedrive']) {
      const key = await getUserKey(userId, p);
      if (key) { provider = p; apiKey = key; break; }
    }
    if (!provider) throw new Error('Aucun CRM configuré');

    notifyUser(userId, 'crm:sync', {
      status: 'fetching',
      progress: 10,
      message: `Connexion à ${provider}...`,
    });

    // Fetch deals based on provider
    let deals = [];
    if (provider === 'hubspot') {
      const res = await fetch(
        'https://api.hubapi.com/crm/v3/objects/deals?limit=100&properties=dealname,amount,dealstage,closedate,pipeline',
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!res.ok) throw new Error('HubSpot API error: ' + res.status);
      const data = await res.json();
      deals = (data.results || []).map(d => ({
        name: d.properties?.dealname || '',
        amount: d.properties?.amount || 0,
        stage: d.properties?.dealstage || '',
        closedAt: d.properties?.closedate || '',
      }));
    } else if (provider === 'pipedrive') {
      const res = await fetch(
        `https://api.pipedrive.com/v1/deals?api_token=${apiKey}&limit=100&status=all_not_deleted`
      );
      if (!res.ok) throw new Error('Pipedrive API error: ' + res.status);
      const data = await res.json();
      deals = (data.data || []).map(d => ({
        name: d.title || '',
        amount: d.value || 0,
        stage: d.stage_id ? `Stage ${d.stage_id}` : '',
        status: d.status || '',
        closedAt: d.close_time || d.won_time || '',
      }));
    } else if (provider === 'salesforce') {
      // Salesforce requires instance URL — simplified version using login.salesforce.com
      const soql = encodeURIComponent(
        'SELECT Name, Amount, StageName, CloseDate FROM Opportunity LIMIT 100'
      );
      const res = await fetch(
        `https://login.salesforce.com/services/data/v62.0/query?q=${soql}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!res.ok) throw new Error('Salesforce API error: ' + res.status);
      const data = await res.json();
      deals = (data.records || []).map(d => ({
        name: d.Name || '',
        amount: d.Amount || 0,
        stage: d.StageName || '',
        closedAt: d.CloseDate || '',
      }));
    }

    notifyUser(userId, 'crm:sync', {
      status: 'fetching',
      progress: 40,
      message: `${deals.length} deals récupérés`,
    });

    if (deals.length === 0) {
      notifyUser(userId, 'crm:sync', {
        status: 'done',
        progress: 100,
        message: 'Aucun deal trouvé dans le CRM',
        patternsCount: 0,
      });
      return { deals: 0, patterns: 0 };
    }

    // Claude analysis
    notifyUser(userId, 'crm:sync', {
      status: 'analyzing',
      progress: 60,
      message: 'Claude analyse vos deals...',
    });

    const analysisInput = deals.map(d =>
      `Deal "${d.name}": montant ${d.amount}\u20AC, stage ${d.stage}, ${d.status || ''} ${d.closedAt ? `fermé le ${d.closedAt}` : ''}`
    ).join('\n');

    const systemPrompt = `Tu es un expert en prospection B2B. Analyse l'historique CRM ci-dessous et identifie les patterns de conversion.

Pour chaque pattern identifié, donne:
- pattern: ce qui caractérise les deals gagnés vs perdus
- category: "Cible" | "Secteur" | "Timing" | "Montant" | "Pipeline"
- confidence: "Haute" | "Moyenne" | "Faible"
- sectors: secteurs concernés (tableau)
- targets: profils cibles (tableau)

Identifie aussi:
- Le profil type qui convertit le mieux
- Le cycle de vente moyen
- Les stages où les deals stagnent

Retourne un JSON: { "patterns": [...], "idealProfile": { "title": "...", "sector": "...", "companySize": "..." }, "avgCycleDays": number }
Sois spécifique et actionnable.`;

    const result = await claude.callClaude(systemPrompt, analysisInput, 4000);

    notifyUser(userId, 'crm:sync', {
      status: 'saving',
      progress: 85,
      message: 'Sauvegarde des insights...',
    });

    // Save patterns
    let patternsCount = 0;
    if (result.parsed && result.parsed.patterns) {
      for (const p of result.parsed.patterns) {
        try {
          await db.memoryPatterns.create({
            pattern: p.pattern,
            category: p.category || 'Cible',
            data: JSON.stringify({
              source: 'crm_sync',
              provider,
              deals: deals.length,
              idealProfile: result.parsed.idealProfile,
            }),
            confidence: p.confidence || 'Faible',
            sectors: p.sectors || [],
            targets: p.targets || [],
          });
          patternsCount++;
        } catch (err) {
          console.warn('[crm-sync] Failed to save pattern:', err.message);
        }
      }
    }

    // Done — notify
    notifyUser(userId, 'crm:sync', {
      status: 'done',
      progress: 100,
      message: `Analyse terminée — ${patternsCount} patterns identifiés sur ${deals.length} deals (${provider})`,
      patternsCount,
      dealsCount: deals.length,
      provider,
    });

    return { deals: deals.length, patterns: patternsCount };
  } catch (err) {
    console.error('[crm-sync] Error:', err.message);
    notifyUser(userId, 'crm:sync', {
      status: 'error',
      progress: 0,
      message: err.message,
    });
    throw err;
  }
}

module.exports = { syncCRM };
