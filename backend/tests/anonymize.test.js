/**
 * Tests de l'anonymisation des patterns mémoire.
 *
 * Le lexique est construit à la main ici : ces tests ne doivent dépendre ni
 * d'une base ni du réseau. Les entités choisies sont celles réellement
 * trouvées en production au moment de l'audit (2026-07-29).
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  buildLexicon,
  redactText,
  redactJson,
  detectResidual,
  anonymizePattern,
} = require('../lib/anonymize');

/** Parse en signalant clairement ce qui a ete produit quand c'est illisible. */
function parseOrFail(value) {
  try {
    return JSON.parse(value);
  } catch (err) {
    assert.fail(`data non parsable (${err.message}) — valeur produite : ${value}`);
  }
}

const LEX = buildLexicon({
  companies: ['LVMH', 'TotalEnergies', 'Sanofi', 'Dassault Systèmes', 'Qonto', 'Memo Bank'],
  contacts: ['Marie Dupont', 'Jean-Pierre Martin'],
  campaigns: ['Beer_UK_1'],
  titles: ['Dirigeant', 'Head of Growth', 'Responsable R&D'],
});

// ─────────────────────────────────────────────────────────────
// Passe structurelle
// ─────────────────────────────────────────────────────────────

test('redige les emails, URLs et telephones sans lexique', () => {
  const { text } = redactText('Ecrire a marie.dupont@acme.com ou https://acme.com/x, tel 06 12 34 56 78');
  assert.match(text, /\[EMAIL\]/);
  assert.match(text, /\[URL\]/);
  assert.match(text, /\[TEL\]/);
  assert.doesNotMatch(text, /marie\.dupont/);
  assert.doesNotMatch(text, /acme\.com/);
});

test('ne prend pas les pourcentages ni les tailles d echantillon pour des telephones', () => {
  const { text } = redactText('Taux de reponse 11.3% sur 240 envois, +7pts vs 2026');
  assert.strictEqual(text, 'Taux de reponse 11.3% sur 240 envois, +7pts vs 2026');
});

// ─────────────────────────────────────────────────────────────
// Passe lexicale
// ─────────────────────────────────────────────────────────────

test('redige les noms d entreprises connus', () => {
  const { text } = redactText('Portefeuille : LVMH, TotalEnergies et Sanofi', LEX);
  assert.strictEqual(text, 'Portefeuille : [ENTREPRISE], [ENTREPRISE] et [ENTREPRISE]');
});

test('tolere les accents manquants — cas mesure en production', () => {
  // En base : « Dassault Systèmes ». Dans le texte produit par le LLM :
  // « Dassault Systemes ». Sans tolerance aux accents, la fuite passe.
  const { text } = redactText('Doublons averes (Dassault Systemes x2)', LEX);
  assert.strictEqual(text, 'Doublons averes ([ENTREPRISE] x2)');
});

test('consomme le terme le plus long en premier', () => {
  // « Dassault Systèmes » ne doit pas se degrader en « [X] Systèmes ».
  const { text } = redactText('Le compte Dassault Systèmes progresse', LEX);
  assert.strictEqual(text, 'Le compte [ENTREPRISE] progresse');
});

test('ne redige pas un mot courant meme si une entite porte ce nom', () => {
  const lex = buildLexicon({ companies: ['Formation', 'Conseil'] });
  const { text } = redactText('La formation des equipes et le conseil client', lex);
  assert.strictEqual(text, 'La formation des equipes et le conseil client');
});

test('respecte les bornes de mot', () => {
  const { text } = redactText('Sanofia nest pas Sanofi', LEX);
  assert.strictEqual(text, 'Sanofia nest pas [ENTREPRISE]');
});

// ─────────────────────────────────────────────────────────────
// Garde sur le partage
// ─────────────────────────────────────────────────────────────

test('une majuscule en debut de phrase n est pas une entite', () => {
  assert.deepStrictEqual(detectResidual('Les emails du mardi performent mieux'), []);
  assert.deepStrictEqual(detectResidual('Presence de doublons averes'), []);
});

test('le vocabulaire metier n est pas une entite', () => {
  assert.deepStrictEqual(detectResidual('Les questions ouvertes en CTA convertissent mieux'), []);
  assert.deepStrictEqual(detectResidual('Sur LinkedIn, le taux d acceptation monte'), []);
});

test('un intitule de poste connu n est pas une entite', () => {
  const r = anonymizePattern({ pattern: 'Le segment Dirigeant a un taux de reponse de 11.3%' }, LEX);
  assert.deepStrictEqual(r.residual, []);
  assert.strictEqual(r.safeToShare, true);
});

test('detecte une entite absente du lexique', () => {
  assert.ok(detectResidual('Le deal avec Zephyrix a ete signe').includes('Zephyrix'));
});

test('detecte un sigle inconnu meme en tete de phrase', () => {
  const r = detectResidual('SNCF et EDF repondent mieux au mardi');
  assert.ok(r.includes('SNCF'));
  assert.ok(r.includes('EDF'));
});

test('ne signale pas ses propres placeholders', () => {
  assert.deepStrictEqual(detectResidual('Le compte [ENTREPRISE] progresse'), []);
});

// ─────────────────────────────────────────────────────────────
// Contrat de anonymizePattern
// ─────────────────────────────────────────────────────────────

test('partageable seulement si le lexique a ete charge', () => {
  // Sans lexique, seule la passe structurelle tourne : « LVMH » passerait.
  // Le partage doit donc etre refuse par principe.
  const r = anonymizePattern({ pattern: 'Un texte parfaitement neutre' });
  assert.strictEqual(r.safeToShare, false);
});

test('partageable apres redaction reussie', () => {
  const r = anonymizePattern({ pattern: 'Portefeuille : LVMH et Sanofi' }, LEX);
  assert.strictEqual(r.pattern, 'Portefeuille : [ENTREPRISE] et [ENTREPRISE]');
  assert.strictEqual(r.redacted, 2);
  assert.strictEqual(r.safeToShare, true);
});

test('non partageable si une entite resiste', () => {
  const r = anonymizePattern({ pattern: 'Campagne Beer_UK_1 sur le compte Zephyrix' }, LEX);
  assert.strictEqual(r.safeToShare, false);
  assert.ok(r.residual.length > 0);
});

test('redige le champ data et retire les identifiants de tenant', () => {
  const r = anonymizePattern({
    pattern: 'Analyse',
    data: JSON.stringify({ userId: 'abc-123', subject: 'Relance LVMH', nested: { company: 'Sanofi' } }),
  }, LEX);
  const data = parseOrFail(r.data);
  assert.strictEqual(data.userId, undefined, 'userId doit disparaitre');
  assert.strictEqual(data.subject, 'Relance [ENTREPRISE]');
  assert.strictEqual(data.nested.company, '[ENTREPRISE]');
});

test('redactJson accepte un objet et ignore les cycles trop profonds', () => {
  const out = redactJson({ a: { b: { c: 'Contact LVMH' } } }, LEX);
  assert.strictEqual(out.a.b.c, 'Contact [ENTREPRISE]');
});

test('tolere les entrees vides ou non textuelles', () => {
  assert.deepStrictEqual(redactText(null).text, null);
  assert.deepStrictEqual(redactText('').text, '');
  assert.deepStrictEqual(detectResidual(null), []);
  const r = anonymizePattern({}, LEX);
  assert.strictEqual(r.pattern, '');
});
