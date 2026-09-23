const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, request, registerAndLogin } = require('./helpers');

describe('Auth routes', () => {
  before(setup);
  after(teardown);

  describe('POST /api/auth/register', () => {
    it('creates a new user and returns tokens', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'new@bakal.test', password: 'GoodPass1', name: 'Alice' },
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.token);
      assert.ok(res.body.refreshToken);
      assert.equal(res.body.user.email, 'new@bakal.test');
      assert.equal(res.body.user.name, 'Alice');
    });

    it('rejects duplicate email', async () => {
      await request('POST', '/api/auth/register', {
        body: { email: 'dup@bakal.test', password: 'GoodPass1', name: 'Bob' },
      });
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'dup@bakal.test', password: 'GoodPass1', name: 'Bob2' },
      });
      assert.equal(res.status, 409);
    });

    it('rejects weak password (no uppercase)', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'weak@bakal.test', password: 'nouppercas1', name: 'Weak' },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /uppercase/);
    });

    it('rejects short password', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'short@bakal.test', password: 'Ab1', name: 'Short' },
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /8 characters/);
    });

    it('rejects missing fields', async () => {
      const res = await request('POST', '/api/auth/register', {
        body: { email: 'missing@bakal.test' },
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => {
      await request('POST', '/api/auth/register', {
        body: { email: 'login@bakal.test', password: 'TestPass1', name: 'Login' },
      });
      const res = await request('POST', '/api/auth/login', {
        body: { email: 'login@bakal.test', password: 'TestPass1' },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.equal(res.body.user.email, 'login@bakal.test');
    });

    it('rejects wrong password', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: { email: 'login@bakal.test', password: 'WrongPass1' },
      });
      assert.equal(res.status, 401);
    });

    it('rejects unknown email', async () => {
      const res = await request('POST', '/api/auth/login', {
        body: { email: 'nobody@bakal.test', password: 'TestPass1' },
      });
      assert.equal(res.status, 401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('exchanges refresh token for new tokens', async () => {
      const { refreshToken } = await registerAndLogin({ email: 'refresh@bakal.test' });
      const res = await request('POST', '/api/auth/refresh', {
        body: { refreshToken },
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
      assert.ok(res.body.refreshToken);
    });

    it('accepte encore le token precedent pendant la periode de grace', async () => {
      const { refreshToken } = await registerAndLogin({ email: 'grace@bakal.test' });
      // Rejeu legitime : deux onglets dont l access token expire en meme temps,
      // un onglet restaure depuis le cache. La rotation seche renvoyait 401, et
      // le client traduisait ce 401 en deconnexion.
      await request('POST', '/api/auth/refresh', { body: { refreshToken } });
      const res = await request('POST', '/api/auth/refresh', { body: { refreshToken } });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
    });

    it('rejette le token precedent une fois la grace ecoulee', async () => {
      const { refreshToken } = await registerAndLogin({ email: 'rotate@bakal.test' });
      await request('POST', '/api/auth/refresh', { body: { refreshToken } });
      // On pousse l echeance de grace dans le passe plutot que d attendre 60 s.
      // Requires locaux : charger db au niveau module devance l initialisation
      // faite par setup() et casse les suites qui partagent la base.
      const db = require('../db');
      const { hashRefreshToken } = require('../middleware/auth');
      await db.refreshTokens.expireIn(hashRefreshToken(refreshToken), -1);
      const res = await request('POST', '/api/auth/refresh', { body: { refreshToken } });
      assert.equal(res.status, 401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns user info with valid token', async () => {
      const { token } = await registerAndLogin({ email: 'me@bakal.test' });
      const res = await request('GET', '/api/auth/me', { token });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, 'me@bakal.test');
    });

    it('rejects request without token', async () => {
      const res = await request('GET', '/api/auth/me');
      assert.equal(res.status, 401);
    });
  });
});
