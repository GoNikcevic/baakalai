/**
 * Sector Classifier
 *
 * Normalizes freeform sector text (user_profiles.sector / opportunities.data->>'sector')
 * into a canonical sector name used by sector_churn_weights, via Claude — matching an
 * existing normalized sector or proposing a new, finer-grained one. Results are cached
 * per raw-text string so the same input never re-triggers a classification call.
 *
 * Deliberately conservative: ambiguous/non-sectoral input (empty, "N/A", gibberish) is
 * classified as "non_determine" rather than fabricating a sector.
 */

const db = require('../db');
const claude = require('../api/claude');
const logger = require('./logger');

const NON_DETERMINE = 'non_determine';

async function classifySector(rawText, scope) {
  if (!rawText || !rawText.trim()) return NON_DETERMINE;

  const cached = await db.query(
    `SELECT normalized_sector FROM sector_normalization_cache WHERE lower(raw_text) = lower($1) AND scope = $2`,
    [rawText, scope]
  );
  if (cached.rows[0]) return cached.rows[0].normalized_sector;

  const existing = await db.query(
    `SELECT DISTINCT sector FROM sector_churn_weights WHERE scope = $1 ORDER BY sector`,
    [scope]
  );
  const existingSectors = existing.rows.map(r => r.sector);

  let normalized = NON_DETERMINE;
  try {
    const prompt = `Texte brut de secteur d'activité : "${rawText}"

Secteurs normalisés déjà connus (${scope}) :
${existingSectors.length > 0 ? existingSectors.join(', ') : '(aucun)'}

Rattache ce texte à un secteur normalisé existant s'il correspond clairement, ou propose un
NOUVEAU secteur normalisé plus fin si aucun ne correspond (ex: "SaaS B2B RH" plutôt que
simplement "Tech" — vise une granularité utile, pas une méga-catégorie).

Règles strictes :
- Si le texte est vide, ambigu, ou ne décrit pas un vrai secteur d'activité (ex: "N/A", un nom
  de personne, du charabia), retourne exactement "${NON_DETERMINE}". Ne fabrique jamais un
  secteur à partir d'un texte non pertinent.
- Le secteur retourné doit être un intitulé court et réutilisable, pas une phrase.

Retourne uniquement du JSON : { "sector": "..." }`;

    const result = await claude.callClaude('Retourne uniquement du JSON valide.', prompt, 200, 'sector_classifier');
    const candidate = result.parsed?.sector;
    if (typeof candidate === 'string' && candidate.trim()) {
      normalized = candidate.trim();
    }
  } catch (err) {
    logger.warn('sector-classifier', `Classification failed for "${rawText}": ${err.message}`);
  }

  // Cache the mapping (even non_determine) so repeat calls never re-hit Claude.
  await db.query(
    `INSERT INTO sector_normalization_cache (raw_text, scope, normalized_sector)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(raw_text), scope) DO NOTHING`,
    [rawText, scope, normalized]
  );

  if (normalized !== NON_DETERMINE) {
    await db.query(
      `INSERT INTO sector_churn_weights (sector, scope, multiplier) VALUES ($1, $2, 1.0)
       ON CONFLICT (sector, scope) DO NOTHING`,
      [normalized, scope]
    );
  }

  return normalized;
}

/**
 * Classify + look up the churn multiplier in one call.
 * Returns { multiplier, sector } — sector is null and multiplier is 1.0 (neutral)
 * when the input couldn't be classified.
 */
async function getSectorMultiplier(rawText, scope) {
  const normalized = await classifySector(rawText, scope);
  if (normalized === NON_DETERMINE) return { multiplier: 1.0, sector: null };

  const r = await db.query(
    `SELECT multiplier FROM sector_churn_weights WHERE sector = $1 AND scope = $2`,
    [normalized, scope]
  );
  return { multiplier: r.rows[0] ? parseFloat(r.rows[0].multiplier) : 1.0, sector: normalized };
}

module.exports = { classifySector, getSectorMultiplier, NON_DETERMINE };
