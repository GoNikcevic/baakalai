const { getUserKey } = require('../config');

async function exportScoresToHubSpot(userId, opportunities) {
  const apiKey = await getUserKey(userId, 'hubspot');
  if (!apiKey) throw new Error('HubSpot non configure');

  // Build contact inputs from scored opportunities
  const inputs = opportunities
    .filter(o => o.score != null)
    .map(o => ({
      properties: {
        firstname: (o.name || '').split(' ')[0] || '',
        lastname: (o.name || '').split(' ').slice(1).join(' ') || '',
        company: o.company || '',
        jobtitle: o.title || '',
        bakal_score: String(o.score),
        bakal_status: o.status || '',
      },
      id: o.name,
    }));

  // Create contacts one by one (will fail if already exists, that's ok)
  const results = [];
  for (const input of inputs) {
    try {
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: input.properties }),
      });
      if (res.ok) {
        results.push({ name: input.id, status: 'created' });
      } else if (res.status === 409) {
        results.push({ name: input.id, status: 'exists' });
      } else {
        results.push({ name: input.id, status: 'error', code: res.status });
      }
    } catch (err) {
      results.push({ name: input.id, status: 'error', message: err.message });
    }
  }

  return { exported: results.length, results };
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

module.exports = { exportScoresToHubSpot, exportScoresToCSV };
