/**
 * L'état de santé d'une connexion CRM (migration 122).
 *
 * LE BUG D'ORIGINE : « connecté » voulait dire « on a un token en base qui se
 * déchiffre ». C'est une vérification purement locale, qui ne prouve que la
 * lisibilité du token, jamais sa validité. Le 2026-09-29 la connexion
 * Salesforce de production était morte depuis cinq jours (Salesforce répondant
 * « invalid_grant · expired access/refresh token ») et l'écran des Réglages
 * affichait toujours « ✓ Connecté », pendant que toutes les synchros
 * échouaient en silence.
 *
 * DEUX GARDE-FOUS SE JOUENT ICI :
 *
 * 1. On ne marque une connexion invalide QUE sur un refus du CRM. Une clé
 *    applicative absente côté serveur est notre problème : demander un nouvel
 *    OAuth ne réparerait rien, et une invitation à reconnecter qui ne répare
 *    rien détruit la confiance dans l'alerte.
 *
 * 2. Une seule alerte par panne. La synchro réessaie en boucle ; sans le
 *    garde-fou de transition, l'utilisateur recevrait une notification par
 *    tentative.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbPath = require.resolve('../db');
const cryptoPath = require.resolve('../config/crypto');
const notifyPath = require.resolve('../lib/notify');

const state = { updates: [], rowCount: 1, notifications: [] };

const fakeDb = {
  async query(sql, params) {
    state.updates.push({ sql, params });
    if (/SET invalid_since = now\(\)/.test(sql)) {
      return { rows: state.rowCount ? [{ id: 'x' }] : [], rowCount: state.rowCount };
    }
    return { rows: [], rowCount: 0 };
  },
};

// Le vrai crypto exigerait ENCRYPTION_SECRET : on ne teste pas le chiffrement
// ici, seulement la lecture d'état qui s'appuie dessus.
const fakeCrypto = {
  encrypt: (s) => s,
  decrypt: (s) => {
    if (s === 'illisible') throw new Error('Invalid encrypted format');
    return s === 'vide' ? '' : 'token-en-clair';
  },
  maskKey: () => '***',
};

const fakeNotify = {
  async createNotification(userId, opts) {
    state.notifications.push({ userId, ...opts });
  },
};

function stub(p, exports) {
  require.cache[p] = { id: p, filename: p, path: path.dirname(p), loaded: true, children: [], paths: [], exports };
}
stub(dbPath, fakeDb);
stub(cryptoPath, fakeCrypto);
stub(notifyPath, fakeNotify);

const {
  connectionState, markInvalid, markValid,
  STATE_ABSENT, STATE_CONNECTED, STATE_NEEDS_RECONNECT,
} = require('../lib/crm-connection-state');

test('connectionState · pas de ligne, pas de connexion', () => {
  assert.equal(connectionState(null), STATE_ABSENT);
  assert.equal(connectionState({}), STATE_ABSENT);
});

test('connectionState · un token illisible reste absent, pas « à reconnecter »', () => {
  // Choix délibéré, aligné sur getValidatedIntegrations : les lignes semées à
  // la main en base ne doivent pas produire d'invitation à reconnecter.
  assert.equal(connectionState({ access_token: 'illisible' }), STATE_ABSENT);
  assert.equal(connectionState({ access_token: 'vide' }), STATE_ABSENT);
});

test('connectionState · token lisible et jamais refusé, donc connecté', () => {
  assert.equal(connectionState({ access_token: 'ok', invalid_since: null }), STATE_CONNECTED);
});

test('connectionState · token lisible mais refusé par le CRM, c est le cas qui manquait', () => {
  assert.equal(
    connectionState({ access_token: 'ok', invalid_since: '2026-09-24T09:00:00Z' }),
    STATE_NEEDS_RECONNECT
  );
});

test('markInvalid · le premier refus marque la connexion et alerte une fois', async () => {
  state.updates = []; state.notifications = []; state.rowCount = 1;
  await markInvalid('user-1', 'salesforce');

  assert.equal(state.updates.length, 1);
  assert.match(state.updates[0].sql, /invalid_since IS NULL/);
  assert.deepEqual(state.updates[0].params, ['user-1', 'salesforce', 'refresh_rejected']);

  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].type, 'crm_connection_lost');
  assert.equal(state.notifications[0].metadata.provider, 'salesforce');
  assert.match(state.notifications[0].title, /Salesforce/);
});

test('markInvalid · une panne déjà signalée ne réalerte pas', async () => {
  state.updates = []; state.notifications = []; state.rowCount = 0; // WHERE invalid_since IS NULL ne matche plus
  await markInvalid('user-1', 'salesforce');

  assert.equal(state.updates.length, 1, 'la tentative de marquage a bien lieu');
  assert.equal(state.notifications.length, 0, 'mais aucune seconde alerte');
});

test('markInvalid · une panne de base ne fait jamais échouer l appelant', async () => {
  const saved = fakeDb.query;
  fakeDb.query = async () => { throw new Error('base injoignable'); };
  await assert.doesNotReject(() => markInvalid('user-1', 'salesforce'));
  fakeDb.query = saved;
});

test('markValid · efface le drapeau et horodate la dernière vérification', async () => {
  state.updates = [];
  await markValid('user-1', 'salesforce');

  assert.equal(state.updates.length, 1);
  assert.match(state.updates[0].sql, /invalid_since = NULL/);
  assert.match(state.updates[0].sql, /last_verified_at = now\(\)/);
  assert.deepEqual(state.updates[0].params, ['user-1', 'salesforce']);
});
