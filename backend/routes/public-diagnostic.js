/**
 * Diagnostic CRM public — lead magnet sans compte.
 *
 * POST /api/public/diagnostic      { provider, apiToken, lang } → { id, report }
 * GET  /api/public/diagnostic/:id  → { report (anonymisé), lang, createdAt }
 *
 * La clé API n'est JAMAIS stockée : elle sert à un seul fetch, seul le
 * rapport agrégé est conservé (purge 30 jours, lib/retention-cleanup.js).
 * La vue partagée (GET) ne révèle jamais les noms de deals/sociétés.
 */

const express = require('express');
const db = require('../db');
const logger = require('../lib/logger');
const { track } = require('../lib/track');
const { listDealsForDiagnostic } = require('../api/pipedrive');
const { publicDiagLimiter } = require('../middleware/rate-limit');

const router = express.Router();

const DAY_MS = 86400000;
const DORMANT_DAYS = 30;
// Benchmark marché : 20-40 % des pipelines audités sont dormants (sources
// citées sur la page). Projection : taux de réactivation prudent de 10 %.
const BENCHMARK = { low: 20, high: 40 };
const REACTIVATION_RATE = 0.10;

function computeReport(deals) {
  const now = Date.now();
  const open = deals.filter(d => d.status === 'open');
  const lastTouch = d => new Date(d.lastActivity || d.addTime).getTime();
  const isDormant = d => (now - lastTouch(d)) / DAY_MS >= DORMANT_DAYS;

  const dormant = open.filter(d => isDormant(d) && d.value > 0);
  const dormantNoValue = open.filter(d => isDormant(d) && !(d.value > 0));
  const openValue = open.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
  const dormantValue = dormant.reduce((s, d) => s + d.value, 0);

  // Même tri que le reading-summary interne : valeur × ancienneté.
  const top = dormant
    .map(d => ({ ...d, daysInactive: Math.floor((now - lastTouch(d)) / DAY_MS) }))
    .sort((a, b) => b.value * Math.max(1, b.daysInactive) - a.value * Math.max(1, a.daysInactive))
    .slice(0, 3)
    .map(d => ({ name: d.name, company: d.company, dealValue: d.value, daysInactive: d.daysInactive }));

  // Score de santé CRM /100 — « l'audit qu'un RevOps ferait » : complétude
  // des trois champs qui conditionnent l'exploitabilité de la base. Donne de
  // la valeur même aux CRM jeunes, là où le volet réactivation est maigre.
  const n = deals.length;
  const pct = (count) => (n > 0 ? Math.round((count / n) * 100) : 0);
  const pctValue = pct(deals.filter(d => d.value > 0).length);
  const pctActivity = pct(deals.filter(d => d.lastActivity).length);
  const pctCompany = pct(deals.filter(d => d.company && String(d.company).trim()).length);
  const healthScore = n > 0
    ? Math.round(0.40 * pctValue + 0.35 * pctActivity + 0.25 * pctCompany)
    : null;

  return {
    totalDeals: deals.length,
    openDeals: open.length,
    openValue,
    dormant: {
      count: dormant.length,
      value: dormantValue,
      noValueCount: dormantNoValue.length,
      sharePct: openValue > 0 ? Math.round((dormantValue / openValue) * 100) : null,
      top,
    },
    dataGaps: {
      missingValue: deals.filter(d => !(d.value > 0)).length,
    },
    health: healthScore == null ? null : {
      score: healthScore,
      pctValue,
      pctActivity,
      pctCompany,
    },
    benchmark: BENCHMARK,
    projection: { rate: REACTIVATION_RATE, value: Math.round(dormantValue * REACTIVATION_RATE) },
    dormantDays: DORMANT_DAYS,
  };
}

router.post('/', publicDiagLimiter, async (req, res, next) => {
  try {
    const { provider, apiToken, lang } = req.body || {};
    if (provider !== 'pipedrive') return res.status(400).json({ error: 'provider_not_supported' });
    if (typeof apiToken !== 'string' || apiToken.trim().length < 8 || apiToken.length > 300) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    let deals;
    try {
      deals = await listDealsForDiagnostic(apiToken.trim());
    } catch (err) {
      logger.warn('public-diagnostic', `fetch pipedrive échoué: ${err.message}`);
      return res.status(400).json({ error: 'invalid_token' });
    }

    const report = computeReport(deals);
    const saved = await db.query(
      `INSERT INTO public_diagnostics (provider, lang, report) VALUES ($1, $2, $3) RETURNING id`,
      ['pipedrive', lang === 'en' ? 'en' : 'fr', JSON.stringify(report)]
    );

    track(null, 'diagnostic_public_done', {
      deals: report.totalDeals,
      dormant: report.dormant.count,
      noValue: report.dormant.noValueCount,
    });

    res.json({ id: saved.rows[0].id, report });
  } catch (err) { next(err); }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const r = await db.query(
      `UPDATE public_diagnostics SET views = views + 1
       WHERE id = $1 AND expires_at > NOW()
       RETURNING report, lang, created_at`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });

    // Vue partagée : jamais les noms de deals/sociétés du CRM d'autrui.
    const report = r.rows[0].report;
    report.dormant.top = (report.dormant.top || []).map(d => ({
      dealValue: d.dealValue,
      daysInactive: d.daysInactive,
    }));

    track(null, 'diagnostic_public_shared_view', null);
    res.json({ report, lang: r.rows[0].lang, createdAt: r.rows[0].created_at });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.computeReport = computeReport;
