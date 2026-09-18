/* ===============================================================================
   BAKAL · Titre d'une conversation
   Le titre était les 60 premiers caractères bruts du premier message. Deux
   conversations parties de la même suggestion portaient donc le même titre, et
   la colonne de gauche les coupait au même endroit : la liste devenait
   illisible. Ici on fabrique un libellé lisible, sans appel modèle.

   Principe : on ne touche à rien tant que le message tient dans le budget · un
   message court est déjà le meilleur titre possible, le charcuter ne ferait que
   lui enlever du sens. Ce n'est que lorsqu'il déborde qu'on retire les amorces
   génériques (politesse, interrogatif, verbe à l'impératif, article) pour
   libérer de la place au profit de la partie distinctive : le nom du deal, le
   chiffre, le sujet réel.

   Limite assumée : deux conversations lancées depuis le MÊME bouton de
   suggestion produisent le même texte, donc le même titre. Rien dans le premier
   message ne permet de les distinguer. La liste affiche l'heure dans ce cas
   (frontend) et le renommage manuel sert de dernier recours.
   =============================================================================== */

const MAX_LEN = 60;

// En deçà, un titre n'apprend rien (« Salut ! », « Voici mon fichier. ») : on
// continue de lire le message pour lui donner un sujet.
const MIN_USEFUL_LEN = 25;

// Verbes conjugués qui suivent un interrogatif dans une inversion sujet-verbe.
// « Quels sont les deals » ampute en « Sont les deals » : l'interrogatif se
// garde dans ce cas, il porte la phrase.
const INVERTED_VERB = /^(sont|est|[ée]tait|sera|seront|ont|avait|avaient|aura|auront|a|as|ai|avez|avons|peut|peuvent|peux|pouvez|doit|doivent|dois|va|vont|fait|font|are|is|was|were|do|does|did|can|could|will|would|should|has|have|had)\b/i;

// Amorces retirées, dans l'ordre, tant que le titre déborde. Chaque motif est
// ancré en tête : on ne retire jamais un mot au milieu d'une phrase. Dans les
// alternances, la forme la plus longue passe en premier (« une » avant « un »)
// et \b interdit de manger la moitié d'un mot.
const LEAD_INS = [
  // Politesse et formules d'attaque
  { re: /^(?:bonjour|salut|hello|hi|hey|coucou|yo)\b\s*[,!.:]*\s*/i },
  { re: /^(?:s'?il te pla[iî]t|s'?il vous pla[iî]t|stp|svp|please)\b\s*,?\s*/i },
  { re: /^(?:merci de|merci d'|thanks for)\s+/i },
  // Tournures de requête
  { re: /^est-?ce que (?:tu|vous) (?:peux|pouvez|pourrais|pourriez)\s+/i },
  { re: /^(?:peux-tu|pourrais-tu|pouvez-vous|pourriez-vous|can you|could you|would you)\s+/i },
  { re: /^(?:j'?aimerais|je voudrais|je souhaite|je veux|il me faut|il faut|i would like|i'?d like|i want|i need)\s+(?:que\s+(?:tu|vous)\s+)?(?:to\s+)?/i },
  // Pronom complément laissé par la tournure de requête (« peux-tu me donner »)
  { re: /^(?:me|m'|moi|nous|te|t')\s*/i },
  // Interrogatifs · gardés si une inversion sujet-verbe suit
  { re: /^est-?ce qu[e']\s*/i },
  {
    re: /^(?:quelles|quels|quelle|quel|lesquelles|lesquels|combien de|combien|qui|quand|o[uù]|pourquoi|comment|which|what|how many|how much|how|when|where|why|who)\b\s*/i,
    keepIf: INVERTED_VERB,
  },
  // Impératifs courants, FR puis EN
  { re: /^(?:pr[ée]pare|r[ée]dige|[ée]cri|cr[ée]e|g[ée]n[èe]re|analyse|trouve|cherche|liste|montre|affiche|donne|explique|propose|envoie|r[ée]sume|compare|calcule|v[ée]rifie|corrige|am[ée]liore|optimise|aide|sugg[èe]re|identifie|classe|parle|dis|fais|faites)(?:s|z|r|ts)?\b\s*(?:-\s*moi|\s+moi)?\s*/i },
  { re: /^(?:write|draft|prepare|create|generate|analyse|analyze|find|search|list|show|give|explain|suggest|send|summarise|summarize|compare|check|fix|improve|optimise|optimize|help|tell|make|build|identify)\b\s*(?:me\s+)?/i },
  // Déterminants de tête, forme longue d'abord
  { re: /^(?:cette|cet|ces|une|des|les|los|mon|mes|ma|notre|nos|votre|vos|leur|leurs|the|these|this|my|our|your|an|a)\b\s*/i },
  { re: /^(?:un|le|la|du|ce)\b\s*/i },
  { re: /^(?:de la|de l'|l'|d')\s*/i },
  // Prépositions laissées par le déterminant
  { re: /^(?:sur|pour|about|on|for|de|d')\b\s*/i },
];

/**
 * Texte de départ : les premières lignes du message, jusqu'à en avoir assez pour
 * dire quelque chose. Une première ligne courte (« Voici mon fichier. ») est un
 * préambule, pas un sujet · le vrai sujet est sur la suivante.
 */
function leadText(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let out = '';
  for (const line of lines) {
    out = out ? `${out} ${line}` : line;
    if (out.length >= MIN_USEFUL_LEN) break;
  }
  // Coupe sur une interrogation ou une exclamation seulement. Le point est
  // écarté volontairement : il sert aussi aux abréviations (« M. Dupont ») et
  // aux décimales, et un message long sera tronqué de toute façon.
  const cut = out.match(/^[\s\S]{3,}?[?!]/);
  const sentence = (cut ? cut[0] : out).trim();
  return sentence.length >= MIN_USEFUL_LEN || sentence.length === out.length ? sentence : out;
}

/** Retire le balisage et les guillemets qui ne veulent rien dire dans une liste. */
function clean(text) {
  return String(text || '')
    .replace(/[`*_#>]+/g, ' ')
    .replace(/^["'«»“”\s]+|["'«»“”\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coupe au dernier mot entier qui tient dans la limite, ellipse comprise. */
function truncate(text, max = MAX_LEN) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  // Un mot unique plus long que la limite : on coupe dedans, sinon on rendrait
  // une chaîne vide.
  const body = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return body.replace(/[\s,;:.!?]+$/, '') + '…';
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Titre lisible pour une conversation, à partir de son premier message.
 * @param {string} message
 * @returns {string} titre non vide (60 caractères au plus)
 */
function buildThreadTitle(message) {
  let title = clean(leadText(message));
  if (!title) return 'Nouvelle conversation';

  // Le message tient : il EST le meilleur titre, on n'y touche pas.
  if (title.length <= MAX_LEN) return capitalize(title);

  // Il déborde : on gagne de la place sur les amorces, une passe par motif.
  for (const { re, keepIf } of LEAD_INS) {
    if (title.length <= MAX_LEN) break;
    if (!re.test(title)) continue;
    const stripped = clean(title.replace(re, ''));
    // Une amorce qui viderait le titre, ou qui laisse une phrase bancale,
    // n'en était pas une.
    if (stripped.length < 3) continue;
    if (keepIf && keepIf.test(stripped)) continue;
    title = stripped;
  }

  return capitalize(truncate(title));
}

module.exports = { buildThreadTitle, MAX_LEN };
