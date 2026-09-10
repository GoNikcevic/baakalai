/**
 * Intentions de réponse — définition unique, partagée par l'analyse et l'autopilot.
 *
 * La liste vivait en double : énumérée dans le prompt d'analyse
 * (response-analysis-agent.js) et rejouée dans l'autopilot sous forme de deux
 * tableaux et d'un switch. Une intention ajoutée d'un côté seulement tombait
 * silencieusement dans la branche par défaut du switch — « continue la
 * conversation » — c'est-à-dire le contraire de ce qu'on voulait en l'ajoutant.
 *
 * Tout se déclare donc ici. Ajouter une intention = ajouter une entrée : le
 * prompt l'énumère automatiquement et l'autopilot sait quoi en faire.
 *
 * Chaque entrée porte :
 *   key         l'identifiant renvoyé par l'analyse
 *   outcome     'stop'     → l'autopilot s'arrête, la piste est close
 *               'success'  → objectif atteint (RDV), on propose des créneaux puis on s'arrête
 *               'continue' → l'échange se poursuit, avec l'instruction ci-dessous
 *   instruction ce qu'on demande au rédacteur quand outcome vaut 'continue'
 *
 * Ce que ce fichier ne porte pas : les effets de bord. `not_now` planifie une
 * relance à trois semaines, et cette écriture reste dans l'autopilot — la
 * déclarer ici demanderait d'y loger du code, ce qui rendrait le fichier moins
 * lisible qu'il ne le doit. Une nouvelle intention qui agit sur la base
 * demandera donc aussi une ligne dans conversation-autopilot.js.
 */

const INTENTS = [
  {
    key: 'meeting_request',
    outcome: 'success',
    instruction: 'The prospect wants a meeting. Propose 2-3 specific time slots this week or next week. Be enthusiastic but professional.',
  },
  {
    key: 'not_interested',
    outcome: 'stop',
  },
  {
    key: 'unsubscribe',
    outcome: 'stop',
  },
  {
    key: 'interested',
    outcome: 'continue',
    instruction: 'The prospect is interested. Ask a qualifying question about their needs/timeline, and subtly steer toward a meeting. Do NOT propose a meeting yet if this is turn 1-2.',
  },
  {
    key: 'question',
    outcome: 'continue',
    instruction: 'The prospect has a question. Answer it concisely and professionally based on context. Then ask a follow-up question to keep the conversation going.',
  },
  {
    key: 'not_now',
    outcome: 'continue',
    instruction: 'The prospect says not now. Acknowledge respectfully, offer to follow up in a few weeks, and ask when would be a better time.',
  },
];

/** Instruction de repli — intention inconnue, ou absente de la réponse d'analyse. */
const FALLBACK_INSTRUCTION =
  'Continue the conversation naturally. Be helpful and professional. Try to understand their needs and move toward a meeting.';

const BY_KEY = new Map(INTENTS.map(i => [i.key, i]));

/** Les clés, dans l'ordre de déclaration. */
const INTENT_KEYS = INTENTS.map(i => i.key);

/** L'énumération telle qu'elle doit apparaître dans le prompt d'analyse. */
function intentEnumForPrompt() {
  return INTENT_KEYS.map(k => `"${k}"`).join(' | ');
}

function isKnownIntent(intent) {
  return BY_KEY.has(intent);
}

/** 'stop' | 'success' | 'continue'. Une intention inconnue poursuit l'échange :
 *  ne jamais clore une piste ni annoncer un RDV sur une valeur qu'on ne
 *  reconnaît pas. */
function outcomeOf(intent) {
  return BY_KEY.get(intent)?.outcome ?? 'continue';
}

function instructionFor(intent) {
  return BY_KEY.get(intent)?.instruction ?? FALLBACK_INSTRUCTION;
}

module.exports = {
  INTENTS,
  INTENT_KEYS,
  FALLBACK_INSTRUCTION,
  intentEnumForPrompt,
  isKnownIntent,
  outcomeOf,
  instructionFor,
};
