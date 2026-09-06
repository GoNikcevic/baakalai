/**
 * Financial Health Orchestrator — santé financière des sociétés clientes via les
 * registres officiels, par pays (pattern adaptateur, comme les providers CRM).
 *
 * FR : recherche-entreprises + BODACC (gratuit, sans clé)
 * GB : Companies House (gratuit, COMPANIES_HOUSE_API_KEY)
 * US : CourtListener faillites fédérales (gratuit, COURTLISTENER_API_TOKEN optionnel)
 * EU : OpenCorporates (OPENCORPORATES_API_KEY, quota 50/j — désactivé sans clé)
 *
 * Les correspondances nom → registre sont mises en cache GLOBAL 7 jours
 * (company_registry_matches, migration 087). Les signaux détectés sont émis dans
 * churn_external_signals avec source 'registry_*' — le facteur 9 du scoring churn
 * les lit séparément des signaux Brave (source 'brave_search', facteur 8).
 */

const db = require('../../db');
const logger = require('../logger');
const fr = require('./fr');
const uk = require('./uk');
const us = require('./us');
const eu = require('./eu');

const REFRESH_MS = 7 * 24 * 3600 * 1000;

// TLD → tentative(s) de registre. Les TLD génériques (.com, .io…) ne disent rien :
// on tente le domestique d'abord (produit FR, les PME vendent surtout chez elles),
// puis les faillites US — les deux sont gratuits et tolèrent un miss.
const EU_JURISDICTIONS = ['be', 'de', 'nl', 'es', 'it', 'lu', 'at', 'ie', 'pt', 'dk', 'se', 'fi', 'pl', 'ch'];

function detectAttempts(email) {
  const domain = (email || '').split('@')[1] || '';
  const tld = domain.split('.').pop()?.toLowerCase();
  if (tld === 'fr') return [{ adapter: fr, cacheCountry: 'FR' }];
  if (tld === 'uk') return [{ adapter: uk, cacheCountry: 'GB' }];
  if (tld === 'us') return [{ adapter: us, cacheCountry: 'US' }];
  if (EU_JURISDICTIONS.includes(tld)) {
    return [{ adapter: eu, cacheCountry: `EU-${tld.toUpperCase()}`, jurisdiction: tld }];
  }
  return [
    { adapter: fr, cacheCountry: 'FR' },
    { adapter: us, cacheCountry: 'US' },
  ];
}

// Clé de cache uniquement — pas un matching : minuscules, accents et espaces normalisés.
function normalizeName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Vérifie une société contre son/ses registres probables, cache 7 jours.
 * Retourne { cacheCountry, status, registryId, signals } ou null si aucun match.
 */
async function checkCompany(companyName, email) {
  const normalized = normalizeName(companyName);
  if (!normalized) return null;

  for (const attempt of detectAttempts(email)) {
    if (!attempt.adapter.available()) continue;

    const cached = await db.query(
      `SELECT registry_id, registry_status, raw, checked_at FROM company_registry_matches
       WHERE normalized_name = $1 AND country = $2`,
      [normalized, attempt.cacheCountry]
    );
    const row = cached.rows[0];
    if (row && Date.now() - new Date(row.checked_at).getTime() < REFRESH_MS) {
      if (row.registry_status === 'not_found' || row.registry_status === 'unknown') continue;
      return {
        cacheCountry: attempt.cacheCountry,
        status: row.registry_status,
        registryId: row.registry_id,
        signals: row.raw?.signals || [],
      };
    }

    let result;
    try {
      result = await attempt.adapter.lookup(companyName, { jurisdiction: attempt.jurisdiction });
    } catch (err) {
      // Quota/réseau : on n'écrit pas le cache (pour réessayer au prochain run) et
      // on ne tente pas les registres suivants pour cette société — throw remonté
      // en erreur de rapport par l'appelant, le scan continue sur les autres.
      throw Object.assign(err, { registryCountry: attempt.cacheCountry });
    }

    await db.query(
      `INSERT INTO company_registry_matches (normalized_name, country, registry_id, registry_status, raw, checked_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (normalized_name, country)
       DO UPDATE SET registry_id = $3, registry_status = $4, raw = $5, checked_at = now()`,
      [normalized, attempt.cacheCountry, result.registryId,
       result.matched ? result.status : 'not_found',
       JSON.stringify({ ...result.raw, signals: result.signals })]
    );

    if (result.matched) {
      return {
        cacheCountry: attempt.cacheCountry,
        status: result.status,
        registryId: result.registryId,
        signals: result.signals,
      };
    }
  }
  return null;
}

/**
 * Scan hebdo pour un utilisateur : toutes ses sociétés clientes (won) puis les
 * deals ouverts, une vérification par société, signaux émis pour chaque
 * opportunité rattachée. Dédup 7 jours par (opportunité, type) comme le scan Brave.
 */
async function scanFinancialHealthForUser(userId, { maxCompanies = 150 } = {}) {
  const report = { companiesChecked: 0, cacheHits: 0, signalsFound: 0, errors: [] };

  const opps = await db.query(
    `SELECT id, company, email, status FROM opportunities
     WHERE user_id = $1 AND company IS NOT NULL AND company <> '' AND status IN ('won', 'open')
     ORDER BY (status = 'won') DESC, deal_value DESC NULLS LAST`,
    [userId]
  );

  // Une vérification par société — mais les signaux vont à toutes ses opportunités.
  const byCompany = new Map();
  for (const opp of opps.rows) {
    const key = normalizeName(opp.company);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, []);
    byCompany.get(key).push(opp);
  }

  let checked = 0;
  for (const [, companyOpps] of byCompany) {
    if (checked >= maxCompanies) break;
    checked++;
    const ref = companyOpps[0];

    let result;
    try {
      result = await checkCompany(ref.company, ref.email);
    } catch (err) {
      report.errors.push(`${ref.company} (${err.registryCountry || '?'}): ${err.message}`);
      continue;
    }
    report.companiesChecked++;
    if (!result || result.signals.length === 0) continue;

    const source = `registry_${result.cacheCountry.toLowerCase()}`;
    for (const opp of companyOpps) {
      for (const signal of result.signals) {
        const recent = await db.query(
          `SELECT 1 FROM churn_external_signals
           WHERE opportunity_id = $1 AND signal_type = $2 AND source = $3
             AND detected_at > now() - interval '7 days' LIMIT 1`,
          [opp.id, signal.signal_type, source]
        );
        if (recent.rows.length > 0) continue;
        await db.query(
          `INSERT INTO churn_external_signals (opportunity_id, user_id, source, signal_type, detail)
           VALUES ($1, $2, $3, $4, $5)`,
          [opp.id, userId, source, signal.signal_type, signal.detail]
        );
        report.signalsFound++;
      }
    }
  }

  logger.info('financial-health',
    `User ${userId}: ${report.companiesChecked} sociétés vérifiées, ${report.signalsFound} signaux, ${report.errors.length} erreurs`);
  return report;
}

module.exports = { scanFinancialHealthForUser, checkCompany, detectAttempts, normalizeName };
