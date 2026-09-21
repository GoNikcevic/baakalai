/**
 * Tests du moteur d'envoi natif · fonctions pures uniquement.
 *
 * Le chemin principal d'une séquence conditionnelle et la substitution des
 * variables déterminent CE QUI part et À QUI : une régression ici envoie de
 * mauvais messages à de vrais prospects. Les deux sont donc verrouillés.
 */

const test = require('node:test');
const assert = require('node:assert');

const { buildMainPath, hasAcceptedBranch, parseTiming, renderTemplate } = require('../lib/native-sequence-engine');

/* ── parseTiming ── */

test('parseTiming lit J+N, tolère la casse et l\'absence de +', () => {
  assert.strictEqual(parseTiming('J+3'), 3);
  assert.strictEqual(parseTiming('j+10'), 10);
  assert.strictEqual(parseTiming('J0'), 0);
  assert.strictEqual(parseTiming(null), 0);
  assert.strictEqual(parseTiming('demain'), 0);
});

/* ── buildMainPath ── */

const tp = (id, over = {}) => ({
  id,
  parent_step_id: null,
  condition_type: null,
  sort_order: 0,
  type: 'email',
  timing: 'J+0',
  ...over,
});

test('séquence plate : racines ordonnées par sort_order avec délais', () => {
  const path = buildMainPath([
    tp('b', { sort_order: 2, timing: 'J+3' }),
    tp('a', { sort_order: 1 }),
    tp('c', { sort_order: 3, timing: 'J+4' }),
  ]);
  assert.deepStrictEqual(path.map(s => s.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(path.map(s => s.delayDays), [0, 3, 4]);
});

test('arbre conditionnel : suit les branches négatives/default, ignore les positives', () => {
  const path = buildMainPath([
    tp('root', { sort_order: 1 }),
    // Branche positive (ouverture trackée) · réservée à Lemlist, exclue du natif
    tp('opened-child', { parent_step_id: 'root', condition_type: 'opened', sort_order: 1 }),
    tp('followup', { parent_step_id: 'root', condition_type: 'not_replied', sort_order: 2, timing: 'J+3' }),
    tp('followup-2', { parent_step_id: 'followup', condition_type: 'not_replied', sort_order: 1, timing: 'J+4' }),
  ]);
  assert.deepStrictEqual(path.map(s => s.id), ['root', 'followup', 'followup-2']);
});

test('branche accepted : exclue par défaut, suivie avec { accepted: true } qui écarte not_accepted', () => {
  const tree = [
    tp('li1', { sort_order: 1, type: 'linkedin_invite' }),
    tp('lm1', { parent_step_id: 'li1', condition_type: 'accepted', sort_order: 1, timing: 'J+2', type: 'linkedin_message' }),
    tp('e2', { parent_step_id: 'li1', condition_type: 'not_accepted', sort_order: 2, timing: 'J+4' }),
  ];
  // Défaut (invitation pas acceptée) : comportement historique inchangé.
  assert.deepStrictEqual(buildMainPath(tree).map(s => s.id), ['li1', 'e2']);
  // Invitation acceptée : la branche accepted remplace la branche not_accepted.
  assert.deepStrictEqual(buildMainPath(tree, { accepted: true }).map(s => s.id), ['li1', 'lm1']);
});

test('accepted: true laisse les branches négatives ordinaires en place', () => {
  const path = buildMainPath([
    tp('root', { sort_order: 1 }),
    tp('followup', { parent_step_id: 'root', condition_type: 'not_replied', sort_order: 1, timing: 'J+3' }),
  ], { accepted: true });
  assert.deepStrictEqual(path.map(s => s.id), ['root', 'followup']);
});

test('hasAcceptedBranch détecte la présence d\'une branche accepted', () => {
  assert.strictEqual(hasAcceptedBranch([tp('a'), tp('b', { condition_type: 'accepted' })]), true);
  assert.strictEqual(hasAcceptedBranch([tp('a'), tp('b', { condition_type: 'not_accepted' })]), false);
});

test('les enfants sans condition_type font partie du chemin principal', () => {
  const path = buildMainPath([
    tp('root', { sort_order: 1 }),
    tp('child', { parent_step_id: 'root', sort_order: 1, timing: 'J+2' }),
  ]);
  assert.deepStrictEqual(path.map(s => s.id), ['root', 'child']);
  assert.strictEqual(path[1].delayDays, 2);
});

/* ── renderTemplate ── */

const prospect = {
  name: 'Marie Dupont',
  company: 'Acme SAS',
  title: 'DAF',
  personalization: { icebreaker: 'Bravo pour votre levée.' },
};

test('renderTemplate substitue toutes les variables connues', () => {
  const out = renderTemplate(
    'Bonjour {{firstName}} {{lastName}}, chez {{companyName}} en tant que {{jobTitle}}, {{icebreaker}}',
    prospect
  );
  assert.strictEqual(out, 'Bonjour Marie Dupont, chez Acme SAS en tant que DAF, Bravo pour votre levée.');
});

test('renderTemplate efface les variables inconnues ou sans valeur sans laisser de trous', () => {
  const out = renderTemplate('Salut {{firstName}}, {{unknownVar}} on se parle ?', { name: 'Marc' });
  assert.strictEqual(out, 'Salut Marc, on se parle ?');
});

test('renderTemplate tolère personalization en chaîne JSON (colonne JSONB sérialisée)', () => {
  const out = renderTemplate('{{icebreaker}}', {
    name: 'X',
    personalization: JSON.stringify({ icebreaker: 'Vu votre post.' }),
  });
  assert.strictEqual(out, 'Vu votre post.');
});
