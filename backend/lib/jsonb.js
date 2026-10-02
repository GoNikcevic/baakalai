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
 * ── L'adaptateur décode maintenant, et ce module reste ──────────────────────
 *
 * Depuis le 2026-10-02, `db/sqlite-adapter.js` décode les colonnes JSONB
 * lui-même : il tire la liste des 38 noms du schéma réel et les reconnaît dans
 * les lignes qu'il rend. Ce module n'est donc plus le seul rempart, et
 * `getStagnantDays` lit enfin le réglage de l'utilisateur sous le miroir.
 *
 * Il reste nécessaire pour deux raisons, pas une :
 *
 *   1. DEUX noms de colonnes sont ambigus, parce que le décodage se fait par
 *      nom (un résultat de SELECT ne dit pas de quelle table vient chaque
 *      colonne). `content` est JSONB dans `autopilot_queue` et TEXT dans
 *      `chat_messages` ; `result` est JSONB dans `agent_chain_executions` et
 *      `strategic_results`, et TEXT dans `versions`. L'adaptateur les écarte
 *      volontairement, donc il faut lire ces deux-là par ici.
 *   2. Un pilote peut toujours rendre une chaîne là où on attend un objet · un
 *      JSONB passé par une couche de sérialisation, par exemple. Appeler
 *      `readJsonb` reste gratuit et ne peut pas nuire : il rend l'objet
 *      inchangé quand il en reçoit déjà un.
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
