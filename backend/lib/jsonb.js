/**
 * Lire une colonne JSONB, des deux côtés.
 *
 * ── Le piège ────────────────────────────────────────────────────────────────
 *
 * Postgres rend une colonne `JSONB` DÉJÀ DÉCODÉE : `row.settings.stagnant_days`
 * marche. Le miroir SQLite des tests la rend en CHAÎNE, parce que SQLite n'a pas
 * de type JSON. Le même accès y vaut donc `undefined`, sans erreur, et le code
 * retombe sur sa valeur par défaut.
 *
 * C'est la pire forme de divergence : le test passe, le défaut par défaut est
 * celui qu'on attendait, et personne n'apprend que le réglage de l'utilisateur
 * n'a jamais été lu. Constaté le 2026-10-02 sur `lib/stagnation.js`, dont
 * `getStagnantDays` rendait toujours 30 sous le miroir quelle que soit la
 * valeur enregistrée, et sur le plafond de cadence du lot 6.
 *
 * ── Pourquoi ici et pas dans l'adaptateur ───────────────────────────────────
 *
 * Faire décoder l'adaptateur demanderait de deviner quelles colonnes sont du
 * JSON, soit en testant « cette chaîne ressemble à du JSON » (et un corps
 * d'email qui contiendrait des accolades changerait de type en silence), soit
 * en déclarant les types dans le miroir et en introspectant `table_info`. La
 * seconde est la bonne réponse, mais elle touche une vingtaine de déclarations
 * et mérite son propre lot.
 *
 * En attendant, tout code qui lit une colonne JSONB passe par ici.
 */

/**
 * @param {*} value la valeur telle que le pilote la rend
 * @returns {object} l'objet, ou {} si la valeur est absente ou illisible ·
 *   jamais null, pour que l'appelant puisse chaîner sans garde.
 */
function readJsonb(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    // Un scalaire JSON valide (« 3 », « "texte" ») n'est pas un objet de
    // réglages : on rend {} plutôt qu'une valeur sur laquelle l'appelant
    // ferait un accès de propriété qui vaudrait undefined de toute facon.
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = { readJsonb };
