/**
 * Tests des intentions de réponse.
 *
 * La liste vivait en double : énumérée dans le prompt d'analyse, rejouée dans
 * l'autopilot sous forme de deux tableaux et d'un switch. Une intention ajoutée
 * d'un côté seulement tombait dans la branche par défaut — « continue la
 * conversation » — soit l'inverse de l'effet recherché. Ces tests verrouillent
 * la source unique.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  INTENTS, INTENT_KEYS, FALLBACK_INSTRUCTION,
  intentEnumForPrompt, isKnownIntent, outcomeOf, instructionFor,
} = require('../lib/reply-intents');

test('les trois issues historiques sont preservees', () => {
  assert.strictEqual(outcomeOf('meeting_request'), 'success');
  assert.strictEqual(outcomeOf('not_interested'), 'stop');
  assert.strictEqual(outcomeOf('unsubscribe'), 'stop');
  assert.strictEqual(outcomeOf('interested'), 'continue');
  assert.strictEqual(outcomeOf('question'), 'continue');
  assert.strictEqual(outcomeOf('not_now'), 'continue');
});

test('une intention inconnue poursuit l echange, sans jamais conclure', () => {
  // Ne jamais clore une piste ni annoncer un RDV sur une valeur non reconnue :
  // l'analyse est un appel LLM, elle peut renvoyer autre chose que la liste.
  assert.strictEqual(outcomeOf('totalement_inconnue'), 'continue');
  assert.strictEqual(outcomeOf(undefined), 'continue');
  assert.strictEqual(instructionFor('totalement_inconnue'), FALLBACK_INSTRUCTION);
  assert.strictEqual(isKnownIntent('totalement_inconnue'), false);
});

test('le prompt enumere exactement la liste declaree', () => {
  const enumeration = intentEnumForPrompt();
  for (const key of INTENT_KEYS) {
    assert.ok(enumeration.includes(`"${key}"`), `${key} absente du prompt`);
  }
  assert.strictEqual(enumeration.split('|').length, INTENT_KEYS.length);
});

test('chaque intention declare une issue valide', () => {
  for (const intent of INTENTS) {
    assert.ok(['stop', 'success', 'continue'].includes(intent.outcome),
      `${intent.key} : issue invalide (${intent.outcome})`);
  }
});

test('toute intention qui poursuit l echange porte sa propre instruction', () => {
  // L'invariant qui compte : ajouter une entree suffit a la cabler. Une
  // intention 'continue' sans instruction retomberait sur le repli generique
  // sans que rien ne le signale.
  for (const intent of INTENTS.filter(i => i.outcome === 'continue')) {
    assert.ok(intent.instruction, `${intent.key} : instruction manquante`);
    assert.notStrictEqual(instructionFor(intent.key), FALLBACK_INSTRUCTION,
      `${intent.key} retombe sur l'instruction de repli`);
  }
});

test('l intention de succes porte l instruction de proposition de creneaux', () => {
  const success = INTENTS.filter(i => i.outcome === 'success');
  assert.strictEqual(success.length, 1, 'une seule issue de succes attendue');
  assert.match(instructionFor(success[0].key), /time slots/i);
});

test('aucune cle en double', () => {
  assert.strictEqual(new Set(INTENT_KEYS).size, INTENT_KEYS.length);
});
