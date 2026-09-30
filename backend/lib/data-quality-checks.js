/**
 * Data Quality · Deal & Client quality checks (Strate 2 / Strate 3)
 *
 * Rule-based, read-only, no AI calls · same convention as lib/reactivation-queue.js: logic
 * lives here, routes/data-quality.js just calls it. Returns the same
 * { type, severity, contacts[], count, suggestedAction } issue shape used by
 * crm-cleaning-agent.js's scanCRM, so the frontend renders both with one card component.
 */

const db = require('../db');

// Combien de lignes sont jointes au rapport. Les problemes qui se corrigent en saisissant
// une valeur (le panneau de correction) en embarquent davantage : leur liste n'est pas une
// illustration, c'est la file de travail. Annoncer 110 et n'en donner que 50 a corriger,
// sans le dire, etait le defaut de l'onglet General avant sa refonte.
const FIXABLE_LIST_CAP = 200;
const ILLUSTRATION_LIST_CAP = 50;

const CONNECTABLE_PROVIDERS = ['pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable', 'folk'];

/**
 * Lignes écartées par l'utilisateur pour un contrôle donné (migration 129).
 *
 * Les contrôles deal et client portent sur les lignes locales sans distinction d'origine :
 * ils rangent leurs exclusions sous un pseudo-provider, le même que celui de leur cache de
 * scan, et jamais sous un vrai nom de CRM.
 *
 * Ce qui est écarté est identifié par ce que la file affiche, pas par la table sous-jacente :
 * un NOM DE SOCIÉTÉ pour le secteur (il se décide par société, pas par contact), un
 * identifiant d'affaire partout ailleurs. Écarter doit annuler exactement la ligne qu'on
 * avait sous les yeux.
 *
 * @returns {Promise<Map<string, Set<string>>>} type de problème → clés écartées
 */
async function loadIgnored(userId, scope) {
  const byType = new Map();
  try {
    const result = await db.query(
      `SELECT issue_type, crm_contact_id FROM data_quality_ignores WHERE user_id = $1 AND provider = $2`,
      [userId, scope]
    );
    for (const row of result.rows) {
      if (!byType.has(row.issue_type)) byType.set(row.issue_type, new Set());
      byType.get(row.issue_type).add(String(row.crm_contact_id).toLowerCase());
    }
  } catch {
    // Table absente (migration 129 pas encore jouée sur cet environnement) · le contrôle
    // doit continuer à tourner, simplement sans rien écarter.
  }
  return byType;
}

/** Retire d'une liste ce que l'utilisateur a écarté, selon la clé propre au contrôle. */
function withoutIgnored(ignoredByType, issueType, list, keyOf = (o) => o.id) {
  const ignored = ignoredByType.get(issueType);
  if (!ignored || ignored.size === 0) return list;
  return list.filter(o => !ignored.has(String(keyOf(o) ?? '').toLowerCase()));
}

/**
 * Deal-data quality: surfaces missing/problematic fields that degrade "Deals à relancer" and
 * churn scoring. Every issue resolves to 'review' (navigate to the client) or
 * 'configure_mapping' (deep-link /settings) · none is auto-fixable. In particular,
 * missing_won_lost_date is NOT backfilled from `updated_at`: that column is reset by a DB
 * trigger on every internal write (including churn scoring's own writes), which is exactly why
 * last_activity_at/won_date/lost_date exist as separate, trigger-immune signals · inferring a
 * close date from it would silently produce a wrong one.
 */
async function computeDealQualityIssues(userId) {
  const issues = [];

  const oppsResult = await db.query(
    `SELECT id, name, company, status, deal_value, won_date, lost_date, owner_id, crm_owner_id,
            last_activity_at, data
     FROM opportunities WHERE user_id = $1`,
    [userId]
  );
  const active = oppsResult.rows.filter(o => o.status !== 'won' && o.status !== 'lost');

  // Les lignes écartées sortent AVANT que les compteurs soient pris · écarter puis continuer
  // à compter ne réglerait ni l'affichage ni le sentiment que le contrôle ne finit jamais.
  const ignored = await loadIgnored(userId, '__deal_quality__');

  // Le secteur s'écarte par SOCIÉTÉ, parce que c'est par société qu'il se corrige.
  const missingSector = withoutIgnored(ignored, 'missing_sector', active.filter(o => !o.data?.sector), o => o.company);
  if (missingSector.length > 0) {
    issues.push({
      type: 'missing_sector',
      severity: 'low',
      contacts: missingSector.slice(0, FIXABLE_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company })),
      count: missingSector.length,
      suggestedAction: 'review',
    });
  }

  const missingDealValue = withoutIgnored(ignored, 'missing_deal_value', active.filter(o => o.deal_value === null));
  if (missingDealValue.length > 0) {
    issues.push({
      type: 'missing_deal_value',
      severity: 'low',
      contacts: missingDealValue.slice(0, FIXABLE_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company })),
      count: missingDealValue.length,
      suggestedAction: 'review',
    });
  }

  // Page-level (not per-contact): one issue per connected CRM provider that has no
  // crm_field_mappings row mapping its status/stage field to Baakalai's status concept.
  const connectedResult = await db.query(
    `SELECT provider FROM user_integrations WHERE user_id = $1 AND provider = ANY($2)`,
    [userId, CONNECTABLE_PROVIDERS]
  );
  const connectedProviders = connectedResult.rows.map(r => r.provider);
  if (connectedProviders.length > 0) {
    const mappedResult = await db.query(
      `SELECT DISTINCT crm_provider FROM crm_field_mappings
       WHERE user_id = $1 AND baakalai_field = 'status' AND crm_provider = ANY($2)`,
      [userId, connectedProviders]
    );
    const mappedSet = new Set(mappedResult.rows.map(r => r.crm_provider));
    for (const provider of connectedProviders) {
      if (mappedSet.has(provider)) continue;
      issues.push({
        type: 'stage_mapping_issue',
        severity: 'medium',
        provider,
        contacts: [],
        count: 0,
        suggestedAction: 'configure_mapping',
      });
    }
  }

  const missingWonLostDate = withoutIgnored(ignored, 'missing_won_lost_date', oppsResult.rows.filter(o =>
    (o.status === 'won' && !o.won_date) || (o.status === 'lost' && !o.lost_date)
  ));
  if (missingWonLostDate.length > 0) {
    issues.push({
      type: 'missing_won_lost_date',
      severity: 'low',
      contacts: missingWonLostDate.slice(0, FIXABLE_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company, status: o.status })),
      count: missingWonLostDate.length,
      suggestedAction: 'review',
    });
  }

  const ownerNotMapped = active.filter(o => !o.owner_id && o.crm_owner_id);
  if (ownerNotMapped.length > 0) {
    issues.push({
      type: 'owner_not_mapped',
      severity: 'medium',
      contacts: ownerNotMapped.slice(0, ILLUSTRATION_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company })),
      count: ownerNotMapped.length,
      suggestedAction: 'review',
    });
  }

  const zeroActivity = active.filter(o => !o.last_activity_at);
  if (zeroActivity.length > 0) {
    issues.push({
      type: 'zero_activity',
      severity: 'low',
      contacts: zeroActivity.slice(0, ILLUSTRATION_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company })),
      count: zeroActivity.length,
      suggestedAction: 'review',
    });
  }

  return issues;
}

/**
 * Client/upsell-data quality: surfaces missing fields that block lib/agents/upsell-detector.js
 * from ever considering a won client · chiefly, zero product-line assignments (upsell-detector
 * compares assigned vs. available product lines to find cross-sell gaps; with none assigned, a
 * client can never surface, whether or not there's real upsell potential).
 */
async function computeClientQualityIssues(userId) {
  const plCountResult = await db.query(
    `SELECT count(*) FROM product_lines
     WHERE team_id = (SELECT team_id FROM team_members WHERE user_id = $1 LIMIT 1)`,
    [userId]
  );
  if (parseInt(plCountResult.rows[0].count, 10) === 0) {
    // Nothing configured yet · don't flag every single client, guide the user to set up
    // product lines first (ProductLinesSettings, already in Settings).
    return [{
      type: 'no_product_lines_configured',
      severity: 'medium',
      contacts: [],
      count: 0,
      suggestedAction: 'configure_product_lines',
    }];
  }

  const ignored = await loadIgnored(userId, '__client_quality__');
  const missingResult = await db.query(
    `SELECT o.id, o.name, o.company FROM opportunities o
     WHERE o.user_id = $1 AND o.status = 'won'
       AND NOT EXISTS (SELECT 1 FROM opportunity_product_lines opl WHERE opl.opportunity_id = o.id)`,
    [userId]
  );
  const missing = withoutIgnored(ignored, 'missing_product_lines', missingResult.rows);
  if (missing.length === 0) return [];

  return [{
    type: 'missing_product_lines',
    severity: 'medium',
    contacts: missing.slice(0, FIXABLE_LIST_CAP).map(o => ({ id: o.id, name: o.name, company: o.company })),
    count: missing.length,
    suggestedAction: 'assign_product_line',
  }];
}

module.exports = { computeDealQualityIssues, computeClientQualityIssues };
