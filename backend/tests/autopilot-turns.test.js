/**
 * Tests de la profondeur de conversation de l autopilot.
 *
 * Un TOUR = une reponse ecrite par baakalai et reellement envoyee. Le nombre
 * de tours etait en dur a 5, pour les prospects froids comme pour les clients
 * qui paient. Il est desormais regle par portee (arbitrage Goran 2026-09-22).
 *
 * Ce que ces tests verrouillent : zero n est jamais une profondeur valide.
 * « Arrete-toi a la premiere reponse et rends-moi la main » s exprime en
 * eteignant la portee, pas en reglant zero tour. Deux reglages pour une meme
 * chose obligeraient l interface a les reconcilier, et l un des deux finirait
 * par mentir sur ce que le produit fait vraiment.
 */

const test = require('node:test');
const assert = require('node:assert');

const { clampTurns, TURNS_CEILING, DEFAULT_MAX_TURNS } = require('../lib/conversation-autopilot');

test('les defauts par portee refletent le risque de chaque population', () => {
  // La prospection qualifie avant de rendre la main ; cote clients, la
  // conversation appartient a l humain des que possible.
  assert.strictEqual(DEFAULT_MAX_TURNS.prospection, 3);
  assert.strictEqual(DEFAULT_MAX_TURNS.crm, 1);
});

test('un reglage absent retombe sur le defaut de la portee', () => {
  assert.strictEqual(clampTurns(undefined, 3), 3);
  assert.strictEqual(clampTurns(null, 1), 1);
  assert.strictEqual(clampTurns('', 3), 3);
  assert.strictEqual(clampTurns('bonjour', 1), 1);
});

test('zero ou negatif ne desactive pas l autopilot en douce, il vaut un tour', () => {
  // Sinon la portee resterait allumee en n ecrivant jamais : l interface
  // afficherait « actif » pour quelque chose qui ne fait rien.
  assert.strictEqual(clampTurns(0, 3), 1);
  assert.strictEqual(clampTurns(-4, 3), 1);
});

test('le plafond borne les reglages fabriques a la main', () => {
  assert.strictEqual(clampTurns(99, 3), TURNS_CEILING);
  assert.strictEqual(clampTurns(TURNS_CEILING, 3), TURNS_CEILING);
  assert.strictEqual(TURNS_CEILING, 5);
});

test('une valeur legitime est conservee telle quelle', () => {
  assert.strictEqual(clampTurns(1, 3), 1);
  assert.strictEqual(clampTurns('3', 1), 3);
  assert.strictEqual(clampTurns(4, 1), 4);
});
