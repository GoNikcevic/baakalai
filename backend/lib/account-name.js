/**
 * Réduire un nom de société à ce qui l'identifie.
 *
 * Sert à une seule chose : décider si « Atelier Kerveil SARL » et « atelier
 * kerveil » sont la même entreprise. C'est la clé de dédoublonnage des comptes
 * (migration 124), et donc ce qui évite de créer trois comptes là où il y en a
 * un.
 *
 * ── Pourquoi c'est volontairement modeste ───────────────────────────────────
 *
 * Mesuré sur la production le 29/09 : 226 comptes après normalisation, et
 * **zéro variante de nom**. Le risque numéro un du plan (§7.1, « le tueur
 * silencieux de qualité ») est empiriquement nul sur les données réelles. Un
 * moteur de fusion avec distance d'édition serait du travail contre un problème
 * qui ne se pose pas, et il fusionnerait à tort des sociétés réellement
 * distinctes (« Groupe Martin » et « Groupe Martini »).
 *
 * La règle est donc : on retire ce qui n'identifie rien (casse, accents,
 * ponctuation, forme juridique), on ne devine jamais au-delà. Deux noms qui
 * diffèrent encore après ça sont deux entreprises.
 */

/**
 * Formes juridiques retirées quand elles sont en fin de nom.
 *
 * Uniquement en FIN : « SA Comptoir du Textile » garde son SA, parce qu'un nom
 * qui commence par ces lettres ne les utilise pas comme forme juridique. Et
 * jamais au milieu, sinon « Sarl du Pont » perdrait son début.
 */
const FORMES_JURIDIQUES = [
  'sarl', 'sas', 'sasu', 'sa', 'sci', 'snc', 'eurl', 'scop', 'sem', 'gie',
  'ltd', 'limited', 'llc', 'inc', 'corp', 'corporation', 'plc', 'gmbh', 'ag',
  'bv', 'nv', 'spa', 'srl', 'ab', 'oy', 'as', 'aps',
];

/**
 * Nom réduit à sa forme comparable, ou null si rien d'identifiant ne reste.
 *
 * null et non chaîne vide : un compte sans nom exploitable ne doit pas se
 * dédoublonner avec tous les autres comptes sans nom.
 *
 * @param {string|null|undefined} nom
 * @returns {string|null}
 */
function normalizeAccountName(nom) {
  if (!nom || typeof nom !== 'string') return null;

  let out = nom
    .normalize('NFD')
    // Diacritiques · « Sté Générale » et « Ste Generale » sont le même compte.
    // Échappements explicites et non les caractères eux-mêmes : des marques
    // combinantes écrites en clair dans une source ne survivent pas à tous les
    // éditeurs ni à tous les encodages.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Ponctuation et liaisons remplacées par une espace, pas supprimées :
    // « saint-martin » et « saint martin » se rejoignent, « abc » et « a.b.c »
    // aussi, mais « martindupont » ne devient pas « martin dupont ».
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!out) return null;

  // Forme juridique en fin de nom, éventuellement répétée (« ... sas sa »).
  let mots = out.split(' ');
  while (mots.length > 1 && FORMES_JURIDIQUES.includes(mots[mots.length - 1])) {
    mots.pop();
  }
  // Espaces retirés EN DERNIER, après le dépouillement qui, lui, raisonne sur
  // les mots. « A.B.C. » et « ABC » deviennent alors le même compte, ce qui est
  // bien la même société, et « Le Bon Coin » rejoint « Lebon Coin ». Aucune
  // fusion à tort en échange : « Groupe Martin » et « Groupe Martini » restent
  // distincts, c'est la seule chose qui compte.
  //
  // La valeur stockée devient moins lisible qu'un nom. C'est assumé : `name`
  // porte le nom affichable, `name_normalized` n'est qu'une clé technique.
  out = mots.join('');

  return out || null;
}

/**
 * Vrai quand deux noms désignent la même société.
 *
 * Aucune tolérance au-delà de la normalisation, et c'est délibéré : voir
 * l'en-tête. Une faute de frappe reste deux comptes, que le user pourra
 * fusionner à la main le jour où l'écran existera.
 */
function isSameAccount(a, b) {
  const na = normalizeAccountName(a);
  const nb = normalizeAccountName(b);
  return na !== null && na === nb;
}

module.exports = { FORMES_JURIDIQUES, normalizeAccountName, isSameAccount };
