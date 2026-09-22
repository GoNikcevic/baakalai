/**
 * Tests du diagnostic OAuth Microsoft.
 *
 * POURQUOI CE TEST EXISTE
 * -----------------------
 * Les deux callbacks Outlook ne lisaient pas `req.query.error`. Quand Azure
 * refusait, ils partaient échanger un code d'autorisation inexistant, et
 * l'utilisateur recevait « Échec de connexion, veuillez réessayer » alors que
 * réessayer ne pouvait pas marcher : tant que baakal.ai n'est pas éditeur
 * vérifié, la plupart des tenants exigent un administrateur. Le message de
 * Microsoft, qui disait exactement quoi faire, était jeté, y compris des logs.
 *
 * Les charges utiles reproduisent ce qu'Azure AD renvoie réellement.
 */

const test = require('node:test');
const assert = require('node:assert');

const graph = require('../lib/microsoft-graph');

test('un refus faute de consentement admin est reconnu comme tel', () => {
  const v = graph.classifyCallback({
    error: 'access_denied',
    error_description: 'AADSTS90094: The grant requires admin permission.',
  });
  assert.strictEqual(v.kind, 'admin_consent_required');
  assert.strictEqual(v.code, 'AADSTS90094');
});

test('le code « pas encore consenti » mene aussi a l administrateur', () => {
  const v = graph.classifyCallback({
    error: 'consent_required',
    error_description: 'AADSTS65001: The user or administrator has not consented to use the application.',
  });
  assert.strictEqual(v.kind, 'admin_consent_required');
  assert.strictEqual(v.code, 'AADSTS65001');
});

test('consent_required sans code AADSTS penche vers l administrateur', () => {
  // Azure ne joint pas toujours de code. C'est de loin le cas le plus frequent
  // tant qu'on n'est pas verifie, donc on oriente vers l'admin plutot que vers
  // un « reessayez » qui ne menerait nulle part.
  const v = graph.classifyCallback({ error: 'consent_required' });
  assert.strictEqual(v.kind, 'admin_consent_required');
  assert.strictEqual(v.code, null);
});

test('un refus explicite de l utilisateur n est pas un probleme d administrateur', () => {
  const v = graph.classifyCallback({
    error: 'access_denied',
    error_description: 'AADSTS65004: User declined to consent to access the app.',
  });
  assert.strictEqual(v.kind, 'user_declined');
});

test('un retour normal avec code ne declenche aucun diagnostic', () => {
  assert.strictEqual(graph.classifyCallback({ code: 'abc123' }).kind, 'ok');
});

test('le retour de consentement administrateur est un succes, pas une erreur', () => {
  // Azure renvoie admin_consent=True et AUCUN code. Sans ce cas, ce retour
  // parfaitement reussi partait dans la branche d'erreur.
  const v = graph.classifyCallback({ admin_consent: 'True', tenant: 't-1', state: 's' });
  assert.strictEqual(v.kind, 'admin_consent_granted');

  // Insensible a la casse : Azure a ecrit « True » et « true » selon les flux.
  assert.strictEqual(graph.classifyCallback({ admin_consent: 'true' }).kind, 'admin_consent_granted');
});

test('un administrateur qui refuse ne passe pas pour un succes', () => {
  assert.strictEqual(graph.classifyCallback({ admin_consent: 'False' }).kind, 'user_declined');
});

test('une erreur Azure sans rapport reste inconnue plutot que mal rangee', () => {
  const v = graph.classifyCallback({
    error: 'server_error',
    error_description: 'AADSTS50011: The redirect URI does not match.',
  });
  assert.strictEqual(v.kind, 'unknown');
  // Le code est quand meme extrait : c'est lui qu'on veut dans les logs.
  assert.strictEqual(v.code, 'AADSTS50011');
});

test('un callback vide ne passe pas pour un succes', () => {
  assert.strictEqual(graph.classifyCallback({}).kind, 'unknown');
  assert.strictEqual(graph.classifyCallback().kind, 'unknown');
});

test('l URL de consentement admin porte le client et la redirection', () => {
  const avant = process.env.MICROSOFT_CLIENT_ID;
  process.env.MICROSOFT_CLIENT_ID = 'client-de-test';
  try {
    const url = graph.adminConsentUrl({
      redirectUri: 'https://app.baakal.ai/api/nurture/email-accounts/callback/microsoft',
      state: 'etat-1',
    });
    assert.ok(url.startsWith('https://login.microsoftonline.com/common/adminconsent?'));
    const params = new URL(url).searchParams;
    assert.strictEqual(params.get('client_id'), 'client-de-test');
    assert.strictEqual(params.get('state'), 'etat-1');
    assert.strictEqual(
      params.get('redirect_uri'),
      'https://app.baakal.ai/api/nurture/email-accounts/callback/microsoft'
    );
  } finally {
    if (avant === undefined) delete process.env.MICROSOFT_CLIENT_ID;
    else process.env.MICROSOFT_CLIENT_ID = avant;
  }
});
