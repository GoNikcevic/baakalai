/**
 * Matching défensif de noms de sociétés pour les adaptateurs financial-health.
 *
 * Contrainte : un faux match = fausse alerte churn chez un client. On préfère
 * donc rater un match (not_found) plutôt que d'accepter un résultat douteux.
 * Règle : tous les tokens significatifs du nom demandé doivent apparaître
 * dans le nom candidat (après normalisation minuscules/accents/ponctuation),
 * avec un repli sur l'inclusion des chaînes compactées (« RiteAid » ~ « Rite Aid »).
 */

// Suffixes juridiques et mots creux — ignorés pour la comparaison.
const STOPWORDS = new Set([
  'sa', 'sas', 'sasu', 'sarl', 'eurl', 'sci', 'snc', 'scop', 'scm', 'selarl',
  'ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'ag', 'kg', 'ug', 'bv', 'nv', 'srl', 'spa',
  'ab', 'oy', 'as', 'aps', 'se', 'sl', 'lda', 'group', 'groupe', 'holding', 'holdings',
  'the', 'et', 'de', 'du', 'des', 'la', 'le', 'les', 'and', 'of',
]);

/** Minuscules, sans accents ni ponctuation, espaces normalisés. */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques issus de la décomposition NFD
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tokens porteurs de sens (hors suffixes juridiques et mots d'une lettre). */
function significantTokens(name) {
  return normalizeName(name)
    .split(' ')
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Le nom candidat correspond-il au nom demandé ?
 * Tous les tokens significatifs du nom demandé doivent être présents dans le
 * candidat ; à défaut, la forme compactée du demandé doit être incluse dans
 * celle du candidat (gère « RiteAid » vs « Rite Aid »).
 */
function nameMatches(queried, candidate) {
  const queryTokens = significantTokens(queried);
  if (!queryTokens.length) return false;

  const candidateTokens = new Set(significantTokens(candidate));
  if (queryTokens.every(t => candidateTokens.has(t))) return true;

  const compactQuery = normalizeName(queried).replace(/ /g, '');
  const compactCandidate = normalizeName(candidate).replace(/ /g, '');
  return compactQuery.length >= 4 && compactCandidate.includes(compactQuery);
}

module.exports = { normalizeName, significantTokens, nameMatches };
