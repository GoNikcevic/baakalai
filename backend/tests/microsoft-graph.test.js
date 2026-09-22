/**
 * Tests du consentement de lecture Outlook.
 *
 * L envoi Microsoft marchait depuis toujours, la detection des reponses non :
 * une sequence continuait de tourner alors que le prospect avait repondu. Le
 * correctif demande un SECOND consentement, parce qu Azure AD ne delivre un
 * jeton que pour une ressource a la fois (outlook.office365.com pour l envoi,
 * graph.microsoft.com pour la lecture).
 *
 * Ce que ces tests verrouillent : le perimetre demande a l utilisateur. Un
 * scope qui s elargit en silence sur la boite mail de quelqu un est le genre de
 * changement qui doit casser un test avant d arriver en production.
 */

const test = require('node:test');
const assert = require('node:assert');

const graph = require('../lib/microsoft-graph');

test('on demande la lecture, jamais l ecriture ni l envoi', () => {
  assert.ok(graph.GRAPH_SCOPES.includes('https://graph.microsoft.com/Mail.Read'));
  // baakalai lit les reponses, il ne touche pas a la boite : ni suppression,
  // ni deplacement, ni envoi depuis cette autorisation-la.
  assert.ok(!graph.GRAPH_SCOPES.includes('Mail.ReadWrite'));
  assert.ok(!graph.GRAPH_SCOPES.includes('Mail.Send'));
  assert.ok(!graph.GRAPH_SCOPES.includes('full_access'));
});

test('offline_access est demande, sinon le consentement meurt en une heure', () => {
  // Sans lui, pas de refresh token : la detection s arreterait au bout d une
  // heure et personne ne comprendrait pourquoi.
  assert.ok(graph.GRAPH_SCOPES.includes('offline_access'));
});

test('un compte sans consentement de lecture est reconnu comme tel', () => {
  assert.strictEqual(graph.hasReadGrant(null), false);
  assert.strictEqual(graph.hasReadGrant({}), false);
  assert.strictEqual(graph.hasReadGrant({ graph_refresh_token: null }), false);
  assert.strictEqual(graph.hasReadGrant({ graph_refresh_token: 'chiffre' }), true);
});

test('sans consentement, aucun appel reseau n est tente', async () => {
  // getReadToken est appele a chaque passage du moteur, pour tout le monde :
  // il doit sortir immediatement sur un compte qui n a jamais autorise.
  const token = await graph.getReadToken({ id: 'x', email_address: 'a@b.c' });
  assert.strictEqual(token, null);
});

test('l URL d autorisation porte l etat et la ressource Graph', () => {
  process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'test-client-id';
  const url = graph.authorizeUrl({ state: 'abc123', redirectUri: 'https://app.baakal.ai/cb' });
  assert.ok(url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?'));
  assert.ok(url.includes('state=abc123'));
  assert.ok(url.includes(encodeURIComponent('https://graph.microsoft.com/Mail.Read')));
  // L utilisateur a deja consenti l envoi : sans prompt=consent, Azure peut
  // renvoyer un jeton sans Mail.Read et la detection echouerait en silence.
  assert.ok(url.includes('prompt=consent'));
});
