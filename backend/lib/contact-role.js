/**
 * Qui est qui dans un compte · lot 3 (migration 125).
 *
 * Deux questions, et elles ne se répondent pas pareil :
 *
 *   1. quel RÔLE joue ce contact · décidé par le CRM quand il le dit, déduit de
 *      l'intitulé de poste sinon ;
 *   2. qui est l'interlocuteur PRINCIPAL du compte · une élection, un seul
 *      gagnant, et un résultat qui ne doit pas changer sans raison.
 *
 * ── L'heuristique est calibrée pour des PME, pas pour des grands comptes ────
 *
 * L'ICP de baakalai, ce sont des entreprises de 5 à 200 personnes. Dans une
 * boîte de trente personnes, un « Directeur Marketing » signe. Dans un groupe
 * de dix mille, non. La même liste de mots donnerait donc des résultats
 * opposés selon la taille, et c'est le petit bout qui est optimisé ici : un
 * directeur ou un responsable est traité comme un décideur.
 *
 * C'est un choix assumé et il produira des faux positifs sur les grosses
 * structures. Le remède n'est pas d'allonger la liste, c'est que le rôle du
 * CRM passe devant dès qu'il existe, et que la correction manuelle tienne.
 */

/**
 * Intitulés qui décident. En français et en anglais, sans accents ni
 * ponctuation : la comparaison se fait sur une forme normalisée.
 *
 * Les formes courtes (pdg, dg, ceo, cto) sont comparées comme des MOTS entiers,
 * les autres en sous-chaîne · sinon « dg » se déclencherait sur « budget » et
 * « ceo » sur « ceost ».
 */
const DECIDEURS_MOTS = [
  'pdg', 'dg', 'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cro', 'cio', 'dsi', 'vp', 'svp', 'evp',
];
const DECIDEURS_EXPRESSIONS = [
  'president', 'directeur', 'directrice', 'director', 'gerant', 'gerante',
  'fondateur', 'fondatrice', 'founder', 'owner', 'proprietaire',
  'associe', 'associee', 'partner', 'head of', 'responsable',
  'vice president', 'managing', 'general manager', 'chief',
];

/**
 * Intitulés qui pèsent sans trancher · ils portent le dossier en interne mais
 * ne signent pas. Testés APRÈS les décideurs, sinon « directeur de projet »
 * tomberait ici.
 */
const INFLUENCEURS_EXPRESSIONS = [
  'manager', 'chef de', 'chargee de', 'charge de', 'lead', 'consultant',
  'architecte', 'architect', 'expert', 'specialiste', 'specialist',
  'acheteur', 'acheteuse', 'buyer', 'procurement', 'achats',
];

/** Minuscules, sans accents, ponctuation réduite à des espaces. */
function normalize(texte) {
  if (!texte || typeof texte !== 'string') return '';
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Rôle déduit du seul intitulé de poste.
 *
 * Renvoie null quand l'intitulé est absent : « on ne sait pas » n'est pas
 * « opérationnel ». Ranger par défaut tous les contacts sans titre dans la
 * dernière catégorie donnerait une majorité d'opérationnels qui n'en sont pas,
 * et l'élection du principal s'appuierait dessus.
 *
 * @param {string|null} titre
 * @returns {'decision_maker'|'influencer'|'operational'|null}
 */
function roleFromTitle(titre) {
  const t = normalize(titre);
  if (!t) return null;

  const mots = t.split(' ');
  if (mots.some(m => DECIDEURS_MOTS.includes(m))) return 'decision_maker';
  if (DECIDEURS_EXPRESSIONS.some(e => t.includes(e))) return 'decision_maker';
  if (INFLUENCEURS_EXPRESSIONS.some(e => t.includes(e))) return 'influencer';
  return 'operational';
}

/**
 * Rôle Salesforce normalisé vers les quatre valeurs du produit.
 *
 * La liste de valeurs d'OpportunityContactRole est modifiable par chaque org :
 * on reconnaît les libellés standards et on range le reste dans 'other' plutôt
 * que de laisser passer une valeur que la contrainte de la migration
 * refuserait.
 *
 * @returns {'decision_maker'|'influencer'|'operational'|'other'|null}
 */
function roleFromCrm(role) {
  const r = normalize(role);
  if (!r) return null;
  if (r.includes('decision') || r.includes('economic buyer') || r.includes('executive sponsor')) return 'decision_maker';
  if (r.includes('influencer') || r.includes('evaluator') || r.includes('technical buyer')) return 'influencer';
  if (r.includes('business user') || r.includes('end user')) return 'operational';
  return 'other';
}

/**
 * Élit l'interlocuteur principal d'un compte.
 *
 * L'ordre des critères est le fond de l'affaire :
 *
 *   1. un choix de l'utilisateur ne se rediscute pas ;
 *   2. ce que le CRM déclare passe avant ce que baakalai déduit ;
 *   3. à égalité, le décideur le plus récemment actif · un décideur muet depuis
 *      deux ans n'est pas le bon interlocuteur, même s'il est le bon titre ;
 *   4. faute de décideur, le contact le plus récemment actif ;
 *   5. et l'identifiant pour départager, afin que deux passes sur les mêmes
 *      données donnent le MÊME principal. Sans ce dernier critère, l'élu
 *      changerait au gré de l'ordre de lecture, et avec lui la personne que le
 *      produit relance.
 *
 * @param {Array} contacts · lignes d'opportunities d'un même compte
 * @returns {object|null} le contact élu
 */
function electPrimary(contacts) {
  const liste = (contacts || []).filter(Boolean);
  if (liste.length === 0) return null;

  const rang = (c) => {
    if (c.role_source === 'user' && c.is_primary_contact) return 0;
    if (c.role_source === 'crm' && c.account_role === 'decision_maker') return 1;
    if (c.account_role === 'decision_maker') return 2;
    if (c.account_role === 'influencer') return 3;
    return 4;
  };
  const recence = (c) => {
    const d = c.last_activity_at ? Date.parse(c.last_activity_at) : NaN;
    // Number.MIN_SAFE_INTEGER et non -Infinity : deux contacts sans activité
    // donneraient -Infinity - (-Infinity) = NaN, et un comparateur qui renvoie
    // NaN rend le tri instable selon le moteur.
    return Number.isFinite(d) ? d : Number.MIN_SAFE_INTEGER;
  };

  return [...liste].sort((a, b) =>
    (rang(a) - rang(b))
    || (recence(b) - recence(a))
    || String(a.id).localeCompare(String(b.id))
  )[0];
}

module.exports = {
  DECIDEURS_MOTS,
  DECIDEURS_EXPRESSIONS,
  INFLUENCEURS_EXPRESSIONS,
  normalize,
  roleFromTitle,
  roleFromCrm,
  electPrimary,
};
