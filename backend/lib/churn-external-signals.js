/**
 * Churn External Signals Scanner
 *
 * Weekly, cost-controlled web search (via Brave Search) for churn-risk signals about
 * existing clients — scoped to opportunities ALREADY at medium+ risk from free CRM-only
 * signals (churn_score >= 50), never the whole client base, to keep API cost bounded.
 *
 * Deliberately separate from the prospecting `signals`/`signal_configs` tables (migration
 * 044), which are about finding new leads, not monitoring the health of existing clients.
 */

const db = require('../db');
const braveSearch = require('../api/brave-search');
const logger = require('./logger');

const SIGNAL_KEYWORDS = [
  { type: 'layoffs', terms: ['licenciement', 'plan social', 'suppression de postes'] },
  { type: 'financial_distress', terms: ['liquidation', 'redressement judiciaire', 'faillite', 'difficultés financières'] },
  { type: 'acquisition', terms: ['rachat', 'acquisition par', 'fusion'] },
  { type: 'leadership_change', terms: ['nouveau directeur', 'nouveau PDG', 'change de direction'] },
];

function classifySnippets(results) {
  const found = [];
  for (const r of results) {
    const text = `${r.title} ${r.description}`.toLowerCase();
    for (const { type, terms } of SIGNAL_KEYWORDS) {
      if (terms.some(term => text.includes(term))) {
        found.push({ signal_type: type, detail: r.title, source_url: r.url });
        break;
      }
    }
  }
  return found;
}

/**
 * Scan external web signals for one user's at-risk opportunities.
 * Skips opportunities already scanned within the last 7 days.
 */
async function scanExternalSignalsForUser(userId) {
  const report = { scanned: 0, skipped: 0, signalsFound: 0, errors: [] };

  const atRisk = await db.query(
    `SELECT id, name, company FROM opportunities WHERE user_id = $1 AND churn_score >= 50`,
    [userId]
  );
  if (atRisk.rows.length === 0) return report;

  for (const opp of atRisk.rows) {
    if (!opp.company) { report.skipped++; continue; }

    const recent = await db.query(
      `SELECT 1 FROM churn_external_signals WHERE opportunity_id = $1 AND detected_at > now() - interval '7 days' LIMIT 1`,
      [opp.id]
    );
    if (recent.rows.length > 0) { report.skipped++; continue; }

    try {
      const results = await braveSearch.webSearch(
        `"${opp.company}" licenciement OR liquidation OR rachat OR "difficultés financières"`,
        5
      );
      const signals = classifySnippets(results);
      report.scanned++;

      for (const s of signals) {
        await db.query(
          `INSERT INTO churn_external_signals (opportunity_id, user_id, source, signal_type, detail)
           VALUES ($1, $2, 'brave_search', $3, $4)`,
          [opp.id, userId, s.signal_type, s.detail]
        );
        report.signalsFound++;
      }
    } catch (err) {
      // Brave failures (missing key, rate limit, network) shouldn't block the rest of the loop
      report.errors.push(`${opp.company}: ${err.message}`);
      logger.warn('churn-external-signals', `Scan failed for ${opp.company}: ${err.message}`);
    }
  }

  if (report.scanned > 0) {
    logger.info('churn-external-signals', `User ${userId}: scanned ${report.scanned}, found ${report.signalsFound} signal(s)`);
  }

  return report;
}

module.exports = { scanExternalSignalsForUser };
