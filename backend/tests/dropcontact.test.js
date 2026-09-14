/**
 * Tests du client DropContact — fonctions pures uniquement.
 *
 * buildEnrichInput décide quels leads partent en recherche (donc ce qui peut
 * être facturé) ; parseBatchEntry décide ce qui compte comme « trouvé et
 * vérifié » (donc ce qui EST facturé). Les deux sont verrouillés.
 */

const test = require('node:test');
const assert = require('node:assert');

const { buildEnrichInput, parseBatchEntry } = require('../api/dropcontact');

/* ── buildEnrichInput ── */

test('lead complet : prénom + nom + entreprise passent tels quels', () => {
  const input = buildEnrichInput({ firstName: 'Jean', lastName: 'Dupont', company: 'CHU Lyon' });
  assert.deepStrictEqual(input, { first_name: 'Jean', last_name: 'Dupont', company: 'CHU Lyon' });
});

test('nom complet seul : découpé en prénom + nom (multi-mots)', () => {
  const input = buildEnrichInput({ name: 'Marie de la Tour', company: 'Acme' });
  assert.strictEqual(input.first_name, 'Marie');
  assert.strictEqual(input.last_name, 'de la Tour');
});

test('companyDomain nettoyé en website (protocole et slash final retirés)', () => {
  const input = buildEnrichInput({
    firstName: 'A', lastName: 'B', company: 'C',
    companyDomain: 'https://acme.fr/',
  });
  assert.strictEqual(input.website, 'acme.fr');
});

test('inputs insuffisants : null (pas de soumission, pas de facturation)', () => {
  assert.strictEqual(buildEnrichInput({ firstName: 'Jean', company: 'Acme' }), null);
  assert.strictEqual(buildEnrichInput({ name: 'Prince', company: 'Acme' }), null);
  assert.strictEqual(buildEnrichInput({ firstName: 'Jean', lastName: 'Dupont' }), null);
});

/* ── parseBatchEntry ── */

test('email vérifié : is_verified true', () => {
  const r = parseBatchEntry({ email: [{ email: 'j@acme.fr', is_verified: true }] });
  assert.deepStrictEqual(r, { email: 'j@acme.fr', verified: true });
});

test('qualification nominative@pro vaut vérifié', () => {
  const r = parseBatchEntry({ email: [{ email: 'j@acme.fr', qualification: 'nominative@pro' }] });
  assert.strictEqual(r.verified, true);
});

test('email trouvé mais non vérifié : verified false', () => {
  const r = parseBatchEntry({ email: [{ email: 'j@acme.fr', qualification: 'catch_all@pro' }] });
  assert.deepStrictEqual(r, { email: 'j@acme.fr', verified: false });
});

test('aucun email : chaîne vide, jamais vérifié', () => {
  assert.deepStrictEqual(parseBatchEntry({ email: [] }), { email: '', verified: false });
  assert.deepStrictEqual(parseBatchEntry({}), { email: '', verified: false });
});
