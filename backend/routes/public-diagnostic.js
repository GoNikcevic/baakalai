/**
 * Diagnostic CRM public · lead magnet sans compte.
 *
 * POST /api/public/diagnostic      { provider, apiToken, lang } → { id, report }
 * GET  /api/public/diagnostic/:id  → { report (anonymisé), lang, createdAt }
 *
 * La clé API n'est JAMAIS stockée : elle sert à un seul fetch, seul le
 * rapport agrégé est conservé (purge 30 jours, lib/retention-cleanup.js).
 * La vue partagée (GET) ne révèle jamais les noms de deals/sociétés.
 */

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const logger = require('../lib/logger');
const { track } = require('../lib/track');
const pipedrive = require('../api/pipedrive');
const hubspot = require('../api/hubspot');
const crmOauth = require('../lib/crm-oauth');
const oauthStates = require('../lib/oauth-states');

const APP_URL = process.env.APP_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'http://localhost:5173');
const LANDING_URL = process.env.LANDING_URL || 'https://baakal.ai';

const PROVIDERS = {
  pipedrive: pipedrive.listDealsForDiagnostic,
  hubspot: hubspot.listDealsForDiagnostic,
};
const { publicDiagLimiter } = require('../middleware/rate-limit');

const router = express.Router();

/** Nombre d'opportunités nommées offertes avant le mur. Le reste est compté,
 *  jamais détaillé : l'audit prouve la valeur, le produit la localise. */
const FREE_TOP_COUNT = 3;

/**
 * Rapport public · le Hidden Revenue Score calculé sur une lecture directe du
 * CRM, puis réduit à ce que l'audit a le droit de montrer.
 *
 * Le score vient du moteur du produit (lib/hidden-revenue), pas d'un calcul
 * maison : l'audit et l'application doivent annoncer le même chiffre pour le
 * même CRM. Un écart entre la page qui convainc et le produit qu'on découvre
 * juste après serait la pire chose à faire à ce moment précis.
 */
function computeReport(deals, { snapshotAt = new Date() } = {}) {
  const { computeFromDeals } = require('../lib/hidden-revenue/from-deals');
  const r = computeFromDeals(deals, { snapshotAt });

  const top = r.candidates.slice(0, FREE_TOP_COUNT).map(c => ({
    name: c.name,
    company: c.company,
    expectedValue: c.expectedValue,
    qualifiedValue: c.qualifiedValue,
    valueEstimated: c.valueEstimated,
    daysInactive: c.daysQuiet,
    dimension: c.dimension,
    reasonCodes: c.reasonCodes,
    recommendedAction: c.recommendedAction,
  }));

  // Sous-scores seuls, sans les montants par dimension : ceux-ci formeraient
  // une carte du trésor assez précise pour se passer du produit.
  const dimensions = {};
  for (const [key, d] of Object.entries(r.dimensions)) {
    dimensions[key] = d.evaluated
      ? { evaluated: true, subScore: d.subScore, count: d.count }
      : { evaluated: false };
  }

  return {
    scoreVersion: r.scoreVersion,
    snapshotAt: r.snapshotAt,
    hrs: r.hrs,
    scoreBand: r.scoreBand,
    confidence: r.confidence,
    confidenceBand: r.confidenceBand,
    quantifiable: r.quantifiable,
    expectedValue: r.expectedValue,
    expectedLow: r.expectedLow,
    expectedHigh: r.expectedHigh,
    qualifiedValue: r.qualifiedValue,
    opportunityCount: r.opportunityCount,
    lockedCount: Math.max(0, r.opportunityCount - top.length),
    dimensions,
    top,
    context: {
      dealsRead: r.context.dealsRead,
      stagnantDays: r.context.stagnantDays,
      winRate: r.context.winRate,
      historyMonths: r.context.historyMonths,
      countWithoutValue: r.context.countWithoutValue,
      countEstimatedValue: r.context.countEstimatedValue,
      truncated: r.context.truncated,
    },
  };
}

// GET /oauth/:provider/start · diagnostic sans compte via le bouton OAuth.
// Réutilise le callback produit (/api/crm/:provider/callback, seul redirect
// enregistré chez les fournisseurs) avec un state marqué diagnostic:true.
// Salesforce passe par l'app centrale Baakalai (org DE) et le scope api
// seul : une lecture, pas de refresh token à demander.
router.get('/oauth/:provider(hubspot|pipedrive|salesforce)/start', publicDiagLimiter, (req, res) => {
  const { provider } = req.params;
  const sf = provider === 'salesforce';
  const sfCreds = sf ? crmOauth.salesforceCredentials(null) : null;
  if (sf ? !sfCreds : !crmOauth.isConfigured(provider)) {
    return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=unavailable`);
  }
  if (oauthStates.size >= 1000) {
    return res.redirect(`${LANDING_URL}/diagnostic?oauth_error=busy`);
  }
  const state = crypto.randomBytes(16).toString('hex');
  const stateData = {
    provider,
    diagnostic: true,
    lang: req.query.lang === 'en' ? 'en' : 'fr',
    expiresAt: Date.now() + 600000,
  };
  if (sf) {
    stateData.codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(stateData.codeVerifier).digest('base64url');
    oauthStates.set(state, stateData);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: sfCreds.clientId,
      redirect_uri: `${APP_URL}/api/crm/salesforce/callback`,
      scope: 'api',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return res.redirect(`https://login.salesforce.com/services/oauth2/authorize?${params}`);
  }
  oauthStates.set(state, stateData);
  res.redirect(crmOauth.authorizeUrl(provider, {
    redirectUri: `${APP_URL}/api/crm/${provider}/callback`,
    state,
  }));
});

// Appelé par le callback OAuth (routes/crm.js) pour un state diagnostic :
// une seule lecture avec le token, puis il est jeté · seul le rapport reste.
// owner_key distingue la vue propriétaire (redirect ?r=&k=) de la vue
// partagée anonymisée.
async function runOauthDiagnostic(provider, tokens, lang) {
  const salesforceApi = require('../api/salesforce');
  const token = provider === 'pipedrive'
    ? { oauth: true, accessToken: tokens.access_token, apiDomain: tokens.api_domain }
    : provider === 'salesforce'
      ? { accessToken: tokens.access_token, instanceUrl: tokens.instance_url }
      : tokens.access_token;
  // Salesforce n'est pas dans PROVIDERS : pas de chemin clé API (le POST
  // public ne peut pas fournir l'instance_url), OAuth uniquement.
  const listDeals = provider === 'salesforce' ? salesforceApi.listDealsForDiagnostic : PROVIDERS[provider];
  const deals = await listDeals(token);
  const report = computeReport(deals);
  const saved = await db.query(
    `INSERT INTO public_diagnostics (provider, lang, report) VALUES ($1, $2, $3) RETURNING id, owner_key`,
    [provider, lang === 'en' ? 'en' : 'fr', JSON.stringify(report)]
  );
  track(null, 'diagnostic_public_done', {
    provider,
    oauth: true,
    deals: report.context.dealsRead,
    opportunities: report.opportunityCount,
    hrs: report.hrs,
    confidence: report.confidence,
    expected: report.expectedValue,
  });
  return { id: saved.rows[0].id, ownerKey: saved.rows[0].owner_key };
}

router.post('/', publicDiagLimiter, async (req, res, next) => {
  try {
    const { provider, apiToken, lang } = req.body || {};
    const listDeals = PROVIDERS[provider];
    if (!listDeals) return res.status(400).json({ error: 'provider_not_supported' });
    if (typeof apiToken !== 'string' || apiToken.trim().length < 8 || apiToken.length > 300) {
      return res.status(400).json({ error: 'invalid_token' });
    }

    let deals;
    try {
      deals = await listDeals(apiToken.trim());
    } catch (err) {
      logger.warn('public-diagnostic', `fetch ${provider} échoué: ${err.message}`);
      return res.status(400).json({ error: 'invalid_token' });
    }

    const report = computeReport(deals);
    const saved = await db.query(
      `INSERT INTO public_diagnostics (provider, lang, report) VALUES ($1, $2, $3) RETURNING id`,
      [provider, lang === 'en' ? 'en' : 'fr', JSON.stringify(report)]
    );

    track(null, 'diagnostic_public_done', {
      provider,
      deals: report.context.dealsRead,
      opportunities: report.opportunityCount,
      hrs: report.hrs,
      confidence: report.confidence,
      expected: report.expectedValue,
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
       RETURNING report, lang, created_at, owner_key`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });

    // Vue propriétaire (arrivée par le redirect OAuth ?r=&k=) : rapport
    // complet. Vue partagée : jamais les noms de deals/sociétés d'autrui.
    const report = r.rows[0].report;
    const isOwner = typeof req.query.k === 'string' && req.query.k === r.rows[0].owner_key;
    if (!isOwner) {
      report.top = (report.top || []).map(d => ({
        expectedValue: d.expectedValue,
        daysInactive: d.daysInactive,
        dimension: d.dimension,
        reasonCodes: d.reasonCodes,
      }));
      track(null, 'diagnostic_public_shared_view', null);
    }

    // Rapport d'avant le moteur de score : il n'a aucun des champs que la page
    // affiche désormais. Plutôt que de faire cohabiter deux rendus, on le
    // signale et on invite à relancer, l'analyse ne coûte qu'un clic.
    if (!report.scoreVersion) {
      return res.json({ legacy: true, lang: r.rows[0].lang, createdAt: r.rows[0].created_at, isOwner });
    }

    res.json({ report, lang: r.rows[0].lang, createdAt: r.rows[0].created_at, isOwner });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.computeReport = computeReport;
module.exports.runOauthDiagnostic = runOauthDiagnostic;
