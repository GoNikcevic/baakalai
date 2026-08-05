/* ===============================================================================
   BAKAL — CRM Auto-Sync & Analysis
   Background task: pulls deals/contacts from the user's CRM (HubSpot, Salesforce,
   or Pipedrive), analyzes with Claude, and populates memory_patterns table.
   =============================================================================== */

const { getUserCrmToken } = require('./crm-token');
const claude = require('../api/claude');
const db = require('../db');
const { notifyUser } = require('../socket');
const { extractActivityDate } = require('./crm-activity-date');

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

    // Detect CRM provider — prefer user's active_crm_provider
    let provider = null;
    let apiKey = null;
    const userRow = await db.query('SELECT active_crm_provider FROM users WHERE id = $1', [userId]);
    const activeCrm = userRow.rows[0]?.active_crm_provider;
    if (activeCrm) {
      const key = await getUserCrmToken(userId, activeCrm);
      if (key) { provider = activeCrm; apiKey = key; }
    }
    if (!provider) {
      for (const p of ['hubspot', 'salesforce', 'pipedrive', 'odoo', 'notion', 'airtable']) {
        const key = await getUserCrmToken(userId, p);
        if (key) { provider = p; apiKey = key; break; }
      }
    }
    if (!provider) throw new Error('No CRM configured');

    notifyUser(userId, 'crm:sync', {
      status: 'fetching',
      progress: 10,
      message: `Connecting to ${provider}...`,
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
      // Salesforce requires instance URL for API calls
      const integration = await db.userIntegrations.get(userId, 'salesforce');
      const instanceUrl = integration?.instance_url;
      if (!instanceUrl) throw new Error('Salesforce instance URL not configured. Go to Settings to add it.');
      const soql = encodeURIComponent(
        'SELECT Name, Amount, StageName, CloseDate FROM Opportunity LIMIT 100'
      );
      const res = await fetch(
        `${instanceUrl}/services/data/v58.0/query?q=${soql}`,
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

      // Also pull Contacts (orgs like AOM may not use Opportunities)
      try {
        const contactSoql = encodeURIComponent(
          'SELECT Id, FirstName, LastName, Email, Phone, Account.Name, Title, CreatedDate, LastModifiedDate FROM Contact WHERE Email != null LIMIT 500'
        );
        const contactRes = await fetch(
          `${instanceUrl}/services/data/v58.0/query?q=${contactSoql}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (contactRes.ok) {
          const contactData = await contactRes.json();
          let contactsImported = 0;
          for (const c of (contactData.records || [])) {
            const email = c.Email;
            if (!email) continue;
            try {
              const existing = await db.opportunities.findByEmail(userId, email);
              if (existing) continue;
              await db.opportunities.create({
                userId,
                name: `${c.FirstName || ''} ${c.LastName || ''}`.trim() || 'Unknown',
                email,
                title: c.Title || null,
                company: c.Account?.Name || null,
                phone: c.Phone || null,
                status: 'imported',
                crmProvider: 'salesforce',
                crmContactId: c.Id,
                // LastModifiedDate était déjà demandée dans le SOQL ci-dessus
                // mais jamais exploitée.
                lastActivityAt: extractActivityDate('salesforce', c),
              });
              contactsImported++;
            } catch { /* skip individual failures */ }
          }
          console.log(`[crm-sync] Salesforce: imported ${contactsImported} new contacts`);
        }
      } catch (contactErr) {
        console.warn('[crm-sync] Salesforce contact pull failed:', contactErr.message);
      }
    } else if (provider === 'notion' || provider === 'airtable' || provider === 'odoo') {
      // For Notion/Airtable/Odoo: use already-imported opportunities as deals
      const iso = v => (v ? new Date(v).toISOString().slice(0, 10) : '');
      const opps = await db.opportunities.listByUser(userId, 500);
      // N'analyser que les lignes de CE CRM : les imports CSV historiques
      // (crm_provider NULL, montants vides, stage 'imported') noyaient
      // l'analyse et faisaient conclure « pipeline uniformément à 0€ ».
      deals = opps.filter(o => o.crm_provider === provider).map(o => ({
        name: o.name || '',
        amount: o.deal_value || 0,
        stage: o.status || '',
        status: o.status || '',
        // updated_at est réécrit en masse par chaque import : le prendre pour
        // date de clôture faisait conclure « tous les deals fermés le même
        // jour ». Seules won_date/lost_date sont de vraies clôtures.
        closedAt: iso(o.won_date || o.lost_date),
        lastActivityAt: iso(o.last_activity_at),
        company: o.company || '',
      }));
    }

    notifyUser(userId, 'crm:sync', {
      status: 'fetching',
      progress: 40,
      message: `${deals.length} deals fetched`,
    });

    if (deals.length === 0) {
      notifyUser(userId, 'crm:sync', {
        status: 'done',
        progress: 100,
        message: 'No deals found in CRM',
        patternsCount: 0,
      });
      return { deals: 0, patterns: 0 };
    }

    // Claude analysis
    notifyUser(userId, 'crm:sync', {
      status: 'analyzing',
      progress: 60,
      message: 'Claude is analyzing your deals...',
    });

    const analysisInput = deals.map(d =>
      `Deal "${d.name}"${d.company ? ` (${d.company})` : ''}: montant ${d.amount}\u20AC, stage ${d.stage}, ${d.status || ''}${d.closedAt ? ` fermé le ${d.closedAt}` : ''}${d.lastActivityAt ? ` dernière activité le ${d.lastActivityAt}` : ''}`
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
      message: 'Saving insights...',
    });

    // Save patterns
    let patternsCount = 0;
    if (result.parsed && result.parsed.patterns) {
      for (const p of result.parsed.patterns) {
        try {
          await db.memoryPatterns.create({
            pattern: p.pattern,
            category: p.category || 'Cible',
            // source au niveau colonne (migration 068) : c'est elle qui permet
            // la purge ciblée des patterns dérivés quand le dataset change.
            source: 'crm_sync',
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
      message: `Analysis complete — ${patternsCount} patterns identified from ${deals.length} deals (${provider})`,
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
