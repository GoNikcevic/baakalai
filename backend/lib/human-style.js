/**
 * Human style · règle produit (décision Goran 15/09/2026).
 *
 * Tout contenu rédigé par baakalai et LU PAR UN CONTACT (emails, notes et
 * messages LinkedIn, copy de séquence) ne doit jamais trahir une IA :
 * pas de tiret cadratin, pas de tournures générées reconnaissables.
 *
 * Double verrou :
 *  1. HUMAN_STYLE_RULES / HUMAN_STYLE_RULES_FR · bloc à concaténer dans les
 *     prompts de génération (qualité à la source) ;
 *  2. humanize(text) · filet déterministe appliqué aux points d'écriture et
 *     d'envoi (touchpoints, sorties de générateurs, transport email/LinkedIn) :
 *     même si le modèle déborde, rien ne part avec un · dedans.
 */

// Bloc pour les prompts rédigés en anglais.
const HUMAN_STYLE_RULES = `
WRITING STYLE, the reader must NEVER suspect an AI wrote this:
- NEVER use em dashes or en dashes (  ). Use a comma, a period or a colon instead.
- Banned openings/phrases (FR): "J'espère que vous allez bien", "J'espère que ce message vous trouve", "Je me permets de", "N'hésitez pas à", "Je reviens vers vous concernant", "dans le cadre de", "Au plaisir d'échanger".
- Banned (EN): "I hope this finds you well", "I wanted to reach out", "Just checking in", "delve", "leverage", "I trust this email".
- No triads ("simple, rapide et efficace"), no "Ce n'est pas X, c'est Y" constructions, no stacked rhetorical questions.
- Write like a busy human: short sentences, concrete facts, one idea per sentence. A slightly imperfect, direct sentence beats a polished generic one.`;

// Même bloc pour les prompts rédigés en français.
const HUMAN_STYLE_RULES_FR = `
STYLE D'ÉCRITURE, le lecteur ne doit JAMAIS soupçonner une IA :
- JAMAIS de tiret cadratin ni demi-cadratin (  ). Utiliser une virgule, un point ou deux-points.
- Tournures interdites : « J'espère que vous allez bien », « Je me permets de », « N'hésitez pas à », « Je reviens vers vous concernant », « dans le cadre de », « Au plaisir d'échanger ».
- Pas de triades (« simple, rapide et efficace »), pas de « Ce n'est pas X, c'est Y », pas de questions rhétoriques empilées.
- Écrire comme un humain pressé : phrases courtes, faits concrets, une idée par phrase.`;

/**
 * Filet déterministe : supprime les tirets cadratins/demi-cadratins d'un texte
 * généré. En début de ligne (puce), le tiret devient "- " ; ailleurs il
 * devient ", " (le repli éditorial le plus neutre). Null-safe.
 */
function humanize(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    // puce de liste : " · item" → "- item"
.replace(/^[ \t]*[  ][ \t]*/gm, '- ')
    // fin de segment : "mot · " en fin de ligne → "mot,"... un tiret suspendu
    // devient un point (fin de pensée).
.replace(/[ \t]*[  ][ \t]*$/gm, '.')
    // au milieu d'une phrase : "mot · mot" → "mot, mot"
.replace(/[ \t]*[  ][ \t]*/g, ', ')
    // nettoyage des doublons créés (", ," / ",  ")
    .replace(/,\s*,/g, ',')
    .replace(/,[ \t]+/g, ', ');
}

/** humanize() sur les champs texte d'un objet (subject, body, ...), copie superficielle. */
function humanizeFields(obj, fields) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (typeof out[f] === 'string') out[f] = humanize(out[f]);
  }
  return out;
}

module.exports = { HUMAN_STYLE_RULES, HUMAN_STYLE_RULES_FR, humanize, humanizeFields };
