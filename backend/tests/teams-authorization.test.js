/**
 * Cloisonnement des equipes.
 *
 * ── Le defaut que ces tests tiennent ───────────────────────────────────────
 *
 * Les trois routes de gestion d'equipe verifiaient que l'appelant est admin
 * DE SON EQUIPE, puis operaient sur `req.params.id`, c'est-a-dire sur une
 * equipe qui pouvait etre une autre. Un admin de l'equipe A qui connait deux
 * identifiants pouvait donc changer les roles dans l'equipe B, en retirer des
 * membres, ou regenerer son lien d'invitation. Le role etait verifie, jamais
 * l'appartenance.
 *
 * Aucun test ne couvrait ces routes, et elles n'etaient meme pas montees dans
 * le harnais : une requete vers /api/teams retombait sur le 404 du
 * gestionnaire d'erreurs. Un test ecrit sans monter la route aurait vu ce 404
 * et conclu au refus.
 *
 * Les cas negatifs ne suffisent pas seuls : un garde qui refuse tout les
 * ferait tous passer. Le cas positif ci-dessous est la pour ca.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

describe('Cloisonnement des equipes', () => {
  let adminA, membreA, adminB;
  let equipeA, equipeB;

  before(async () => {
    await setup();

    // Equipe A : son createur, plus un membre pour avoir une cible a attaquer.
    adminA = await registerAndLogin({ email: `admin-a-${Date.now()}@bakal.test` });
    const creationA = await request('POST', '/api/teams', {
      token: adminA.token,
      body: { name: 'Equipe A' },
    });
    assert.strictEqual(creationA.status, 201, 'equipe A non creee');
    equipeA = creationA.body.team;

    // Le membre est ajoute par le DAO, et non par POST /join/:code : le miroir
    // SQLite des tests ne reproduit pas le defaut Postgres de `invite_code`
    // (`encode(gen_random_bytes(6), 'hex')`), la colonne y sort a null et le
    // code d'invitation serait introuvable. Ce qui est sous test ici est le
    // garde d'admin, pas l'adhesion. `db` se charge APRES setup(), qui vide le
    // cache de modules et reinitialise la base.
    membreA = await registerAndLogin({ email: `membre-a-${Date.now()}@bakal.test` });
    const db = require('../db');
    await db.teams.addMember(equipeA.id, membreA.user.id, 'viewer');

    // Equipe B : un admin parfaitement legitime... chez lui.
    adminB = await registerAndLogin({ email: `admin-b-${Date.now()}@bakal.test` });
    const creationB = await request('POST', '/api/teams', {
      token: adminB.token,
      body: { name: 'Equipe B' },
    });
    assert.strictEqual(creationB.status, 201, 'equipe B non creee');
    equipeB = creationB.body.team;
  });

  after(teardown);

  it('un admin ne change pas un role dans une equipe qui n est pas la sienne', async () => {
    const res = await request('PATCH', `/api/teams/${equipeA.id}/members/${membreA.user.id}`, {
      token: adminB.token,
      body: { role: 'admin' },
    });

    assert.strictEqual(res.status, 403, 'le changement de role a travers les equipes est passe');

    // Et le role n'a pas bouge : un 403 rendu APRES l'ecriture ne vaudrait rien.
    const membres = await request('GET', `/api/teams/${equipeA.id}/members`, { token: adminA.token });
    const cible = membres.body.members.find(m => m.user_id === membreA.user.id);
    assert.strictEqual(cible.role, 'viewer', 'le role a change malgre le refus');
  });

  it('un admin ne retire pas un membre d une equipe qui n est pas la sienne', async () => {
    const res = await request('DELETE', `/api/teams/${equipeA.id}/members/${membreA.user.id}`, {
      token: adminB.token,
    });

    assert.strictEqual(res.status, 403, 'la suppression a travers les equipes est passee');

    const membres = await request('GET', `/api/teams/${equipeA.id}/members`, { token: adminA.token });
    assert.ok(
      membres.body.members.some(m => m.user_id === membreA.user.id),
      'le membre a ete retire malgre le refus'
    );
  });

  it('un admin ne regenere pas le lien d invitation d une autre equipe', async () => {
    // Le lien est le secret qui fait entrer dans l'equipe : le regenerer
    // coupe l'acces de tous ceux qui detenaient l'ancien.
    const res = await request('POST', `/api/teams/${equipeA.id}/regenerate-invite`, {
      token: adminB.token,
    });

    assert.strictEqual(res.status, 403, 'la regeneration a travers les equipes est passee');
  });

  it('une equipe inconnue est refusee, pas une erreur serveur', async () => {
    // Avant le garde, `db.teams.get(:id)` rendait undefined et la lecture de
    // `created_by` partait en 500. Un 500 renseigne un attaquant sur
    // l'existence de l'identifiant ; un 403 ne dit rien.
    const res = await request('PATCH', '/api/teams/00000000-0000-0000-0000-000000000000/members/'
      + membreA.user.id, {
      token: adminB.token,
      body: { role: 'viewer' },
    });

    assert.strictEqual(res.status, 403, `attendu 403, recu ${res.status}`);
  });

  it('le garde ne bloque pas l admin legitime de sa propre equipe', async () => {
    // Le controle negatif des quatre tests precedents. Sans celui-ci, un garde
    // qui refuserait tout le monde les ferait tous passer.
    const res = await request('PATCH', `/api/teams/${equipeA.id}/members/${membreA.user.id}`, {
      token: adminA.token,
      body: { role: 'prospection' },
    });

    assert.strictEqual(res.status, 200, `l admin legitime a ete refuse : ${JSON.stringify(res.body)}`);

    const membres = await request('GET', `/api/teams/${equipeA.id}/members`, { token: adminA.token });
    const cible = membres.body.members.find(m => m.user_id === membreA.user.id);
    assert.strictEqual(cible.role, 'prospection', 'le role n a pas ete applique');
  });
});
