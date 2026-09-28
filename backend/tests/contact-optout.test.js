/**
 * Désinscription d'un contact (migration 120).
 *
 * Ce que ces tests protègent, par ordre de gravité si ça casse :
 *
 *  1. Un contact désinscrit ne reçoit RIEN. C'est l'obligation légale, et le
 *     blocage est au transport, donc aucun appelant ne peut l'oublier.
 *  2. L'adresse email ne circule JAMAIS dans l'URL de désinscription. Un lien
 *     part dans un email et finit dans des journaux de serveurs.
 *  3. Le jeton est infalsifiable. Sans ça, n'importe qui désinscrit n'importe
 *     qui, et le nuisible n'est pas le destinataire mais un concurrent.
 *  4. La désinscription est idempotente : un lien reste valable pour toujours,
 *     et recliquer ne doit ni casser ni dupliquer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'test-secret-pour-les-jetons-de-desinscription';
process.env.APP_URL = 'https://app.example.test';

const dbPath = require.resolve('../db');

// Base simulée : une table d'oppositions en mémoire, contrainte d'unicité
// comprise, pour que l'idempotence soit réellement exercée.
const state = { optouts: [], users: [{ id: 'u1', language: 'fr' }] };

const fakeDb = {
  async query(sql, params = []) {
    if (/SELECT 1 FROM contact_optouts/.test(sql)) {
      const [userId, hash] = params;
      return { rows: state.optouts.filter(o => o.user_id === userId && o.email_hash === hash).slice(0, 1) };
    }
    if (/SELECT email_hash FROM contact_optouts/.test(sql)) {
      const [userId, hashes] = params;
      return { rows: state.optouts.filter(o => o.user_id === userId && hashes.includes(o.email_hash)) };
    }
    if (/INSERT INTO contact_optouts/.test(sql)) {
      const [user_id, email, email_hash, source, user_agent, ip_hash] = params;
      const existing = state.optouts.find(o => o.user_id === user_id && o.email_hash === email_hash);
      if (existing) {
        // ON CONFLICT DO UPDATE SET email = COALESCE(EXCLUDED.email, ...)
        existing.email = email || existing.email;
        return { rows: [] };
      }
      state.optouts.push({ user_id, email, email_hash, source, user_agent, ip_hash });
      return { rows: [] };
    }
    if (/SELECT language FROM users/.test(sql)) {
      return { rows: state.users.filter(u => u.id === params[0]) };
    }
    return { rows: [] };
  },
};

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, path: path.dirname(dbPath),
  loaded: true, children: [], paths: [], exports: fakeDb,
};

const optout = require('../lib/contact-optout');

test('l adresse email n apparait jamais dans l URL de desinscription', () => {
  const email = 'marie.dupont@acme-industries.fr';
  const url = optout.unsubscribeUrl('u1', email);

  assert.ok(!url.includes(email), 'adresse en clair dans l URL');
  assert.ok(!url.includes('marie.dupont'), 'partie locale en clair dans l URL');
  assert.ok(!url.includes('acme-industries'), 'domaine en clair dans l URL');

  // Et pas davantage sous une forme simplement encodée : c'est le piège
  // évident, une base64 de l'adresse se décode en une seconde.
  const token = url.split('token=')[1];
  const payload = Buffer.from(token.split('.')[0], 'base64url').toString();
  assert.ok(!payload.includes('@'), 'adresse décodable depuis le jeton');
  assert.ok(!payload.toLowerCase().includes('marie'), 'adresse décodable depuis le jeton');
});

test('le jeton est verifiable et rend le bon utilisateur', () => {
  const token = optout.makeToken('u1', 'Contact@Exemple.FR');
  const parsed = optout.verifyToken(token);
  assert.equal(parsed.userId, 'u1');
  assert.equal(parsed.emailHash, optout.hashEmail('contact@exemple.fr'));
});

test('la casse et les espaces ne changent pas l identite de l adresse', () => {
  assert.equal(optout.hashEmail('  Contact@Exemple.FR  '), optout.hashEmail('contact@exemple.fr'));
});

test('un jeton altere est rejete', () => {
  const token = optout.makeToken('u1', 'contact@exemple.fr');
  const [payload, signature] = token.split('.');

  assert.equal(optout.verifyToken(`${payload}.${signature.slice(0, -1)}x`), null, 'signature modifiée acceptée');
  assert.equal(optout.verifyToken(`${Buffer.from('u2:abc').toString('base64url')}.${signature}`), null, 'charge utile remplacée acceptée');
  assert.equal(optout.verifyToken(payload), null, 'jeton sans signature accepté');
  assert.equal(optout.verifyToken(''), null);
  assert.equal(optout.verifyToken(null), null);
  assert.equal(optout.verifyToken(undefined), null);
  assert.equal(optout.verifyToken({}), null);
});

test('un jeton signe avec un autre secret est rejete', () => {
  const token = optout.makeToken('u1', 'contact@exemple.fr');
  const vrai = process.env.ENCRYPTION_SECRET;
  try {
    process.env.ENCRYPTION_SECRET = 'un-autre-secret-totalement-different';
    // Le module relit le secret à chaque appel, donc le changement prend effet.
    assert.equal(optout.verifyToken(token), null);
  } finally {
    process.env.ENCRYPTION_SECRET = vrai;
  }
});

test('enregistrer puis verifier : le contact est bloque', async () => {
  state.optouts.length = 0;
  assert.equal(await optout.isOptedOut('u1', 'stop@exemple.fr'), false);

  await optout.recordOptOut('u1', { email: 'stop@exemple.fr', source: 'link' });
  assert.equal(await optout.isOptedOut('u1', 'stop@exemple.fr'), true);

  // Même adresse, casse différente : c'est la même personne.
  assert.equal(await optout.isOptedOut('u1', 'STOP@Exemple.FR'), true);
});

test('l opposition vaut par utilisateur, pas globalement', async () => {
  state.optouts.length = 0;
  await optout.recordOptOut('u1', { email: 'commun@exemple.fr' });

  assert.equal(await optout.isOptedOut('u1', 'commun@exemple.fr'), true);
  // u2 a sa propre relation avec ce contact : elle n'est pas rompue par
  // l'opposition exprimée auprès de u1.
  assert.equal(await optout.isOptedOut('u2', 'commun@exemple.fr'), false);
});

test('recliquer un vieux lien ne duplique rien et ne casse pas', async () => {
  state.optouts.length = 0;
  await optout.recordOptOut('u1', { email: 'repete@exemple.fr', source: 'link' });
  await optout.recordOptOut('u1', { email: 'repete@exemple.fr', source: 'one_click' });
  await optout.recordOptOut('u1', { email: 'repete@exemple.fr', source: 'link' });

  assert.equal(state.optouts.length, 1);
  assert.equal(await optout.isOptedOut('u1', 'repete@exemple.fr'), true);
});

test('une opposition par jeton connait le hache sans l adresse, et l adresse peut la completer ensuite', async () => {
  state.optouts.length = 0;
  const hash = optout.hashEmail('anonyme@exemple.fr');

  // Cas du clic : la route ne dispose que du haché.
  await optout.recordOptOut('u1', { emailHash: hash, source: 'one_click' });
  assert.equal(state.optouts[0].email, null);
  assert.equal(await optout.isOptedOut('u1', 'anonyme@exemple.fr'), true);

  // L'utilisateur saisit ensuite l'adresse à la main : la ligne s'enrichit
  // au lieu d'être écrasée par NULL.
  await optout.recordOptOut('u1', { email: 'anonyme@exemple.fr', source: 'manual' });
  assert.equal(state.optouts.length, 1);
  assert.equal(state.optouts[0].email, 'anonyme@exemple.fr');
});

test('recordOptOut refuse un appel sans rien pour identifier le contact', async () => {
  await assert.rejects(() => optout.recordOptOut('u1', {}), /requires userId and an email or emailHash/);
  await assert.rejects(() => optout.recordOptOut(null, { email: 'x@y.fr' }), /requires userId/);
});

test('les en-tetes RFC 8058 sont complets', () => {
  const headers = optout.unsubscribeHeaders('u1', 'contact@exemple.fr');
  // Les chevrons sont exigés par la RFC : sans eux Gmail ignore l'en-tête.
  assert.match(headers['List-Unsubscribe'], /^<https:\/\/app\.example\.test\/api\/public\/unsubscribe\?token=.+>$/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(!headers['List-Unsubscribe'].includes('contact@exemple.fr'));
});

test('le pied de message porte le lien, dans les deux langues', () => {
  const fr = optout.footerText('u1', 'contact@exemple.fr', 'fr');
  const en = optout.footerText('u1', 'contact@exemple.fr', 'en');

  assert.match(fr, /ne souhaitez plus/);
  assert.match(en, /Don't want to hear/);
  for (const footer of [fr, en]) {
    assert.match(footer, /https:\/\/app\.example\.test\/api\/public\/unsubscribe\?token=/);
    assert.ok(!footer.includes('contact@exemple.fr'));
  }

  const html = optout.footerHtml('u1', 'contact@exemple.fr', 'fr');
  assert.match(html, /<a href="https:\/\/app\.example\.test\/api\/public\/unsubscribe\?token=/);
  assert.ok(!html.includes('contact@exemple.fr'));
});

test('aucun tiret cadratin ni demi-cadratin dans les pieds de message', () => {
  // Règle de style 8 : ces pieds partent dans des emails lus par des contacts.
  //
  // Le motif est construit par code de caractère, et non écrit en clair ni en
  // séquence d'échappement : le dépôt est tenu à zéro tiret cadratin, y compris
  // dans les tests, et un fichier qui contient l'aiguille qu'il cherche fait
  // remonter un faux positif à chaque contrôle.
  const tirets = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  for (const lang of ['fr', 'en']) {
    assert.ok(!tirets.test(optout.footerText('u1', 'c@e.fr', lang)));
    assert.ok(!tirets.test(optout.footerHtml('u1', 'c@e.fr', lang)));
  }
});
