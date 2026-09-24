/**
 * Automatisation · la liste d'étapes de l'éditeur vue par le moteur.
 *
 * L'éditeur manipule une attente comme une carte à part entière. En base,
 * l'attente n'est pas une étape : c'est le `timing` de l'étape suivante,
 * exactement comme dans une séquence de campagne. Ce choix évite d'ajouter un
 * type de touchpoint, et donc d'atteindre la branche « type inconnu » de
 * db.touchpoints.create.
 *
 * C'est une conversion à double sens, donc l'endroit exact où un contact peut
 * recevoir un email trois jours trop tôt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stepsToTouchpoints, touchpointsToSteps } = require('../routes/automations');

test('une attente devient le timing de l etape suivante', () => {
  const { touchpoints, warnings } = stepsToTouchpoints([
    { type: 'email', consigne: 'Feliciter' },
    { type: 'wait', days: 3 },
    { type: 'email', consigne: 'Relancer' },
  ]);

  assert.equal(touchpoints.length, 2);
  assert.equal(touchpoints[0].step, 'E1');
  assert.equal(touchpoints[0].timing, 'J+0');
  assert.equal(touchpoints[1].step, 'E2');
  assert.equal(touchpoints[1].timing, 'J+3');
  assert.deepEqual(warnings, []);
});

test('deux attentes consecutives s additionnent', () => {
  const { touchpoints } = stepsToTouchpoints([
    { type: 'email', consigne: 'A' },
    { type: 'wait', days: 2 },
    { type: 'wait', days: 5 },
    { type: 'email', consigne: 'B' },
  ]);
  assert.equal(touchpoints[1].timing, 'J+7');
});

test('une attente en fin de liste ne veut rien dire et est signalee', () => {
  const { touchpoints, warnings } = stepsToTouchpoints([
    { type: 'email', consigne: 'A' },
    { type: 'wait', days: 4 },
  ]);
  assert.equal(touchpoints.length, 1);
  assert.ok(warnings.includes('trailing_wait'));
});

test('une attente en tete decale le premier email', () => {
  const { touchpoints } = stepsToTouchpoints([
    { type: 'wait', days: 1 },
    { type: 'email', consigne: 'A' },
  ]);
  assert.equal(touchpoints[0].timing, 'J+1');
});

test('la consigne est le corps, et le sujet reste a generer', () => {
  // La consigne est une regle ecrite une fois pour N contacts, pas un email
  // redige pour quelqu un en particulier : le sujet est produit a l envoi.
  const { touchpoints } = stepsToTouchpoints([{ type: 'email', consigne: '  Proposer un point  ' }]);
  assert.equal(touchpoints[0].body, 'Proposer un point');
  assert.equal(touchpoints[0].subject, null);
  assert.equal(touchpoints[0].type, 'email');
});

test('une attente invalide est ecartee sans casser la liste', () => {
  const { touchpoints, warnings } = stepsToTouchpoints([
    { type: 'wait', days: 0 },
    { type: 'email', consigne: 'A' },
  ]);
  assert.equal(touchpoints.length, 1);
  assert.equal(touchpoints[0].timing, 'J+0');
  assert.ok(warnings.includes('invalid_wait'));
});

test('un type d etape inconnu est ecarte, jamais converti en autre chose', () => {
  // Precedent a ne pas rejouer : tout type inconnu tombait dans une branche
  // par defaut et partait en envoi silencieux.
  const { touchpoints, warnings } = stepsToTouchpoints([
    { type: 'linkedin_invite', consigne: 'X' },
    { type: 'email', consigne: 'A' },
  ]);
  assert.equal(touchpoints.length, 1);
  assert.equal(touchpoints[0].body, 'A');
  assert.ok(warnings.includes('unsupported_step'));
});

test('la relecture rend la liste que l editeur avait produite', () => {
  const original = [
    { type: 'email', consigne: 'A' },
    { type: 'wait', days: 3 },
    { type: 'email', consigne: 'B' },
  ];
  const { touchpoints } = stepsToTouchpoints(original);
  const back = touchpointsToSteps(touchpoints.map(tp => ({ timing: tp.timing, body: tp.body })));
  assert.deepEqual(back, original);
});

test('un premier email sans attente ne fabrique pas de carte attente fantome', () => {
  const back = touchpointsToSteps([{ timing: 'J+0', body: 'A' }]);
  assert.deepEqual(back, [{ type: 'email', consigne: 'A' }]);
});

test('chaque etape email porte le marqueur de consigne', () => {
  // Load-bearing : sans ce marqueur, advanceOneStep enverrait la consigne
  // telle quelle au contact au lieu de rediger un email a partir d elle.
  const { CONSIGNE_MARKER } = require('../lib/workflow-step-email');
  const { touchpoints } = stepsToTouchpoints([
    { type: 'email', consigne: 'A' },
    { type: 'wait', days: 2 },
    { type: 'email', consigne: 'B' },
  ]);
  assert.ok(touchpoints.every(tp => tp.subType === CONSIGNE_MARKER));
});
