const { Router } = require('express');
const db = require('../db');

const router = Router();

// ─── CSV Export ───

function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function campaignsToCsv(campaigns) {
  const headers = [
    'Campagne', 'Client', 'Statut', 'Canal', 'Secteur', 'Cible',
    'Prospects', 'Taux ouverture (%)', 'Taux reponse (%)',
    'Taux acceptation LK (%)', 'Interesses', 'RDV', 'Iteration', 'Date debut',
  ];

  const rows = campaigns.map(c => [
    c.name, c.client, c.status, c.channel, c.sector || '', c.position || '',
    c.nb_prospects || 0, c.open_rate || '', c.reply_rate || '',
    c.accept_rate_lk || '', c.interested || 0, c.meetings || 0,
    c.iteration || 1, c.start_date || '',
  ]);

  const csvLines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    csvLines.push(row.map(escapeCsv).join(','));
  }
  return csvLines.join('\n');
}

function sequenceToCsv(campaign, touchpoints) {
  const headers = ['Campagne', 'Step', 'Type', 'Label', 'Timing', 'Objet', 'Corps'];

  const rows = touchpoints.map(tp => [
    campaign.name, tp.step, tp.type, tp.label || '', tp.timing || '',
    tp.subject || '', (tp.body || '').replace(/\n/g, ' '),
  ]);

  const csvLines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    csvLines.push(row.map(escapeCsv).join(','));
  }
  return csvLines.join('\n');
}

// GET /api/export/campaigns/csv — export all campaigns as CSV
router.get('/campaigns/csv', async (req, res, next) => {
  try {
    const campaigns = await db.campaigns.list({ userId: req.user.id });
    const csv = campaignsToCsv(campaigns);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bakal-campagnes.csv"');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (err) {
    next(err);
  }
});

// GET /api/export/campaigns/:id/csv — export a single campaign + sequence as CSV
router.get('/campaigns/:id/csv', async (req, res, next) => {
  try {
    const campaign = await db.campaigns.get(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.user_id && campaign.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const touchpoints = await db.touchpoints.listByCampaign(campaign.id);
    const csv = sequenceToCsv(campaign, touchpoints);

    const filename = `bakal-${campaign.name.replace(/[^a-zA-Z0-9]/g, '-')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
});

// ─── PDF Export (HTML-based, lightweight) ───

function campaignsToPdfHtml(campaigns, kpis) {
  const rows = campaigns.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.status)}</td>
      <td>${esc(c.channel)}</td>
      <td>${c.nb_prospects || 0}</td>
      <td>${c.open_rate != null ? c.open_rate + '%' : '—'}</td>
      <td>${c.reply_rate != null ? c.reply_rate + '%' : '—'}</td>
      <td>${c.interested || 0}</td>
      <td>${c.meetings || 0}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Rapport Bakal</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 40px; color: #1a1a2e; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
    .kpi-grid { display: flex; gap: 16px; margin-bottom: 32px; }
    .kpi { background: #f8f9fa; border-radius: 8px; padding: 16px 20px; flex: 1; }
    .kpi-value { font-size: 24px; font-weight: 700; }
    .kpi-label { font-size: 11px; color: #666; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: #f0f0f5; border-bottom: 2px solid #ddd; font-size: 11px; text-transform: uppercase; color: #555; }
    td { padding: 8px 12px; border-bottom: 1px solid #eee; }
    tr:hover { background: #f8f8fb; }
    .footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
    @media print { body { margin: 20px; } .kpi-grid { gap: 8px; } }
  </style>
</head>
<body>
  <h1>Rapport de performance — Bakal</h1>
  <div class="subtitle">Genere le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-value">${kpis.active_campaigns || 0}</div>
      <div class="kpi-label">Campagnes actives</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${kpis.total_contacts || 0}</div>
      <div class="kpi-label">Prospects contactes</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${kpis.avg_open_rate ? kpis.avg_open_rate + '%' : '—'}</div>
      <div class="kpi-label">Taux ouverture moy.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${kpis.avg_reply_rate ? kpis.avg_reply_rate + '%' : '—'}</div>
      <div class="kpi-label">Taux reponse moy.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${kpis.total_meetings || 0}</div>
      <div class="kpi-label">RDV obtenus</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Campagne</th><th>Statut</th><th>Canal</th><th>Prospects</th>
        <th>Ouverture</th><th>Reponse</th><th>Interesses</th><th>RDV</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    Bakal — Rapport genere automatiquement. Donnees en date du ${new Date().toLocaleDateString('fr-FR')}.
  </div>
</body>
</html>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// GET /api/export/report/pdf — generate a printable HTML report (save as PDF via browser)
router.get('/report/pdf', async (req, res, next) => {
  try {
    const campaigns = await db.campaigns.list({ userId: req.user.id });
    const kpis = await db.dashboardKpis(req.user.id);
    const html = campaignsToPdfHtml(campaigns, kpis);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// GET /api/export/opportunities/csv — export all opportunities with scores
router.get('/opportunities/csv', async (req, res, next) => {
  try {
    const opps = await db.opportunities.list(req.user.id);
    const headers = [
      'Nom', 'Titre', 'Entreprise', 'Taille', 'Statut',
      'Score', 'Engagement', 'Fit', 'Campagne', 'Date creation',
    ];

    const rows = opps.map(o => {
      const breakdown = typeof o.score_breakdown === 'string'
        ? JSON.parse(o.score_breakdown || '{}')
        : (o.score_breakdown || {});
      return [
        o.name, o.title || '', o.company || '', o.company_size || '', o.status,
        o.score || 0, breakdown.engagement || 0, breakdown.fit || 0,
        o.campaign_name || '', o.created_at || '',
      ];
    });

    const csvLines = [headers.map(escapeCsv).join(',')];
    for (const row of rows) {
      csvLines.push(row.map(escapeCsv).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bakal-opportunities.csv"');
    res.send('\uFEFF' + csvLines.join('\n'));
  } catch (err) {
    next(err);
  }
});

// GET /api/export/crm-report/pdf — CRM analytics PDF report
router.get('/crm-report/pdf', async (req, res, next) => {
  try {
    const campaigns = await db.campaigns.list({ userId: req.user.id });
    const opps = await db.opportunities.list(req.user.id);
    const kpis = await db.dashboardKpis(req.user.id);

    // Pipeline breakdown
    const stages = {};
    for (const o of opps) {
      stages[o.status] = (stages[o.status] || 0) + 1;
    }

    // Per-campaign attribution
    const campaignMap = {};
    for (const c of campaigns) {
      campaignMap[c.id] = { name: c.name, channel: c.channel, prospects: c.nb_prospects || 0, meetings: c.meetings || 0, interested: c.interested || 0 };
    }

    const stageLabels = { new: 'Nouveau', interested: 'Intéressé', meeting: 'RDV', negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu' };
    const stageRows = Object.entries(stages).map(([k, v]) => `<tr><td>${esc(stageLabels[k] || k)}</td><td>${v}</td></tr>`).join('');
    const campRows = campaigns.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.channel)}</td><td>${c.nb_prospects || 0}</td><td>${c.interested || 0}</td><td>${c.meetings || 0}</td></tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>CRM Report — Bakal</title>
<style>
body { font-family: 'Segoe UI', sans-serif; margin: 40px; color: #1a1a2e; }
h1 { font-size: 22px; margin-bottom: 4px; }
h2 { font-size: 16px; margin-top: 32px; margin-bottom: 12px; color: #333; }
.subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
.kpi-grid { display: flex; gap: 16px; margin-bottom: 32px; }
.kpi { background: #f8f9fa; border-radius: 8px; padding: 16px 20px; flex: 1; }
.kpi-value { font-size: 24px; font-weight: 700; }
.kpi-label { font-size: 11px; color: #666; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
th { text-align: left; padding: 8px 12px; background: #f0f0f5; border-bottom: 2px solid #ddd; font-size: 11px; text-transform: uppercase; color: #555; }
td { padding: 8px 12px; border-bottom: 1px solid #eee; }
.footer { margin-top: 40px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 12px; }
@media print { body { margin: 20px; } }
</style></head><body>
<h1>Rapport CRM — Bakal</h1>
<div class="subtitle">Généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
<div class="kpi-grid">
  <div class="kpi"><div class="kpi-value">${opps.length}</div><div class="kpi-label">Opportunités totales</div></div>
  <div class="kpi"><div class="kpi-value">${stages.won || 0}</div><div class="kpi-label">Deals gagnés</div></div>
  <div class="kpi"><div class="kpi-value">${stages.meeting || 0}</div><div class="kpi-label">En RDV</div></div>
  <div class="kpi"><div class="kpi-value">${kpis.total_meetings || 0}</div><div class="kpi-label">RDV obtenus (total)</div></div>
</div>
<h2>Pipeline par étape</h2>
<table><thead><tr><th>Étape</th><th>Nombre</th></tr></thead><tbody>${stageRows}</tbody></table>
<h2>Attribution par campagne</h2>
<table><thead><tr><th>Campagne</th><th>Canal</th><th>Prospects</th><th>Intéressés</th><th>RDV</th></tr></thead><tbody>${campRows}</tbody></table>
<div class="footer">Bakal — Rapport CRM généré automatiquement. Données au ${new Date().toLocaleDateString('fr-FR')}.</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
