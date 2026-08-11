const { getUserKey } = require('../config');
const { getUserCrmToken } = require('./crm-token');
const db = require('../db');
const logger = require('./logger');

function buildContactData(o) {
  return {
    firstName: (o.name || '').split(' ')[0] || '',
    lastName: (o.name || '').split(' ').slice(1).join(' ') || '',
    company: o.company || '',
    title: o.title || '',
    score: o.score,
    status: o.status || '',
  };
}

async function exportScoresToHubSpot(userId, opportunities) {
  // crm-token gère le refresh des tokens OAuth (30 min chez HubSpot).
  const { getUserCrmToken } = require('./crm-token');
  const apiKey = await getUserCrmToken(userId, 'hubspot');
  if (!apiKey) throw new Error('HubSpot non configuré');

  const results = [];
  for (const o of opportunities.filter(o => o.score != null)) {
    const c = buildContactData(o);
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: {
          firstname: c.firstName, lastname: c.lastName,
          company: c.company, jobtitle: c.title,
          bakal_score: String(c.score), bakal_status: c.status,
        }}),
      });
      results.push({ name: o.name, status: res.ok ? 'created' : res.status === 409 ? 'exists' : 'error' });
    } catch (err) {
      results.push({ name: o.name, status: 'error', message: err.message });
    }
  }
  return { exported: results.length, provider: 'hubspot', results };
}

async function exportScoresToSalesforce(userId, opportunities) {
  const apiKey = await getUserCrmToken(userId, 'salesforce');
  if (!apiKey) throw new Error('Salesforce non configuré');

  // Salesforce needs instance URL from DB
  const integration = await db.userIntegrations.get(userId, 'salesforce');
  const instanceUrl = integration?.instance_url;
  if (!instanceUrl) throw new Error('Salesforce instance URL not configured. Please reconnect Salesforce.');

  const results = [];
  for (const o of opportunities.filter(o => o.score != null)) {
    const c = buildContactData(o);
    try {
      const res = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/Contact`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          FirstName: c.firstName, LastName: c.lastName || 'Unknown',
          Title: c.title, Company: c.company,
          Description: `Baakal Score: ${c.score}/100 | Status: ${c.status}`,
        }),
      });
      results.push({ name: o.name, status: res.ok ? 'created' : 'error', code: res.status });
    } catch (err) {
      results.push({ name: o.name, status: 'error', message: err.message });
    }
  }
  return { exported: results.length, provider: 'salesforce', results };
}

async function exportScoresToPipedrive(userId, opportunities) {
  // getUserCrmToken (et non getUserKey) : gère aussi les connexions OAuth,
  // où le token est un Bearer sur le domaine société, pas un api_token.
  const { getUserCrmToken } = require('./crm-token');
  const auth = await getUserCrmToken(userId, 'pipedrive');
  if (!auth) throw new Error('Pipedrive non configuré');
  const isOauth = typeof auth === 'object';
  const pdUrl = (path) => isOauth
    ? `${(auth.apiDomain || 'https://api.pipedrive.com').replace(/\/$/, '')}/api/v1${path}`
    : `https://api.pipedrive.com/v1${path}?api_token=${auth}`;
  const pdHeaders = isOauth ? { Authorization: `Bearer ${auth.accessToken}` } : {};

  const results = [];
  for (const o of opportunities.filter(o => o.score != null)) {
    const c = buildContactData(o);
    try {
      const res = await fetch(pdUrl('/persons'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...pdHeaders },
        body: JSON.stringify({
          name: `${c.firstName} ${c.lastName}`.trim(),
          org_id: null,
          job_title: c.title,
          visible_to: 3,
          // Add score as note since Pipedrive doesn't have custom fields via basic API
        }),
      });
      if (!res.ok) {
        results.push({ name: o.name, status: 'error', code: res.status });
        continue;
      }
      const data = await res.json();
      // Add a note with the score
      if (data.success && data.data?.id) {
        await fetch(pdUrl('/notes'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...pdHeaders },
          body: JSON.stringify({
            content: `Baakal Score: ${c.score}/100\nEngagement: ${o.score_breakdown?.engagement || '?'}/50\nFit ICP: ${o.score_breakdown?.fit || '?'}/50\nStatut: ${c.status}\nEntreprise: ${c.company}`,
            person_id: data.data.id,
          }),
        });
      }
      results.push({ name: o.name, status: data.success ? 'created' : 'error' });
    } catch (err) {
      results.push({ name: o.name, status: 'error', message: err.message });
    }
  }
  return { exported: results.length, provider: 'pipedrive', results };
}

/**
 * Auto-detect which CRM is configured and export to it
 */
async function exportScoresToCRM(userId, opportunities) {
  // Try each CRM in order
  for (const [provider, exportFn] of [
    ['hubspot', exportScoresToHubSpot],
    ['salesforce', exportScoresToSalesforce],
    ['pipedrive', exportScoresToPipedrive],
  ]) {
    const key = await getUserKey(userId, provider);
    if (key) {
      logger.info('crm-export', `Exporting ${opportunities.length} scores to ${provider}`);
      return exportFn(userId, opportunities);
    }
  }
  throw new Error('Aucun CRM configuré');
}

async function exportScoresToCSV(opportunities) {
  const headers = ['Nom', 'Titre', 'Entreprise', 'Taille', 'Statut', 'Score', 'Engagement', 'Fit'];
  const rows = opportunities
    .filter(o => o.score != null)
    .map(o => [
      o.name || '',
      o.title || '',
      o.company || '',
      o.company_size || '',
      o.status || '',
      o.score || 0,
      o.score_breakdown?.engagement || 0,
      o.score_breakdown?.fit || 0,
    ]);

  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  return csv;
}

module.exports = { exportScoresToCRM, exportScoresToHubSpot, exportScoresToSalesforce, exportScoresToPipedrive, exportScoresToCSV };
