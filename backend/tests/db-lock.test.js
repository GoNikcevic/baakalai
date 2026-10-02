/**
 * Le bail d'exclusion mutuelle des taches planifiees (lib/db-lock.js).
 *
 * ── Pourquoi ce fichier n'existait pas ──────────────────────────────────────
 *
 * Deux raisons cumulees, et aucune n'etait visible : la table `cron_locks`
 * n'etait pas dans le miroir SQLite, et la requete d'acquisition utilise
 * `now() + ($3 || ' seconds')::interval`, que le miroir ne traduisait pas.
 *
 * Le resultat etait silencieux et pire que l'absence de test : `withLock`
 * attrape l'echec d'acquisition et, par prudence deliberee, LAISSE LA TACHE
 * S'EXECUTER sans verrou. Sous le miroir, toute tache tournait donc sans
 * protection, et un test qui l'aurait appelee aurait vu `ran: true` en croyant
 * verifier le verrou.
 *
 * C'est le verrou qui serialise les ecritures de memoire (regle 3 du CLAUDE.md,
 * qui interdit `pg_advisory_lock` parce que le pooler est en mode transaction).
 */

const test = require('node:test');
const assert = require('node:assert');
const { setup, teardown } = require('./helpers');

test('la premiere acquisition execute la section critique', async (t) => {
  await setup();
  t.after(teardown);

  const { withLock } = require('../lib/db-lock');
  let passages = 0;

  const r = await withLock('test:unique', async () => { passages++; return 'fait'; });

  assert.strictEqual(r.ran, true);
  assert.strictEqual(r.result, 'fait');
  assert.strictEqual(passages, 1);
});

test('un bail tenu fait SAUTER la seconde execution, il ne la met pas en attente', async (t) => {
  await setup();
  t.after(teardown);

  const { withLock } = require('../lib/db-lock');
  let dehors = 0;
  let dedans = 0;

  // Le second appel est fait DEPUIS la section critique du premier : le bail est
  // donc tenu et non expire. C'est la seule facon de verifier l'exclusion sans
  // dependre d'un ordonnancement.
  const r = await withLock('test:tenu', async () => {
    dehors++;
    const imbrique = await withLock('test:tenu', async () => { dedans++; });
    // `ran: false` et non une attente : une tache planifiee qui patiente
    // s'empile, une tache qui saute reviendra au prochain tour.
    assert.strictEqual(imbrique.ran, false);
    assert.strictEqual(imbrique.skipped, 'locked');
  });

  assert.strictEqual(r.ran, true);
  assert.strictEqual(dehors, 1);
  assert.strictEqual(dedans, 0, 'la section critique ne doit PAS avoir tourne deux fois');
});

test('le bail est rendu a la fin, donc le tour suivant passe', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { withLock } = require('../lib/db-lock');

  await withLock('test:rendu', async () => 'premier');
  const restant = await db.query('SELECT COUNT(*) AS n FROM cron_locks WHERE name = $1', ['test:rendu']);
  assert.strictEqual(Number(restant.rows[0].n), 0, 'le bail doit etre supprime en sortant');

  const second = await withLock('test:rendu', async () => 'second');
  assert.strictEqual(second.ran, true);
  assert.strictEqual(second.result, 'second');
});

test('le bail est rendu MEME si la section critique echoue', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { withLock } = require('../lib/db-lock');

  await assert.rejects(
    withLock('test:echec', async () => { throw new Error('boum'); }),
    /boum/
  );

  // Sans le `finally`, une tache qui plante bloquerait toutes les suivantes
  // jusqu'a l'expiration du bail, soit 30 minutes par defaut.
  const restant = await db.query('SELECT COUNT(*) AS n FROM cron_locks WHERE name = $1', ['test:echec']);
  assert.strictEqual(Number(restant.rows[0].n), 0);
});

test('un bail PERIME est reprenable par une autre instance', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { withLock } = require('../lib/db-lock');

  // Une instance morte a laisse son bail derriere elle. Sans la reprise, la
  // tache ne repartirait jamais.
  await db.query(
    `INSERT INTO cron_locks (name, instance_id, locked_at, expires_at)
     VALUES ($1, 'instance-morte', $2, $3)`,
    ['test:perime', new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() - 3600000).toISOString()]
  );

  const r = await withLock('test:perime', async () => 'repris');
  assert.strictEqual(r.ran, true, 'un bail expire ne doit pas bloquer eternellement');
  assert.strictEqual(r.result, 'repris');
});

test('on ne retire que SON bail, jamais celui d une autre instance', async (t) => {
  await setup();
  t.after(teardown);

  const db = require('../db');
  const { withLock } = require('../lib/db-lock');

  // Scenario reel : notre bail expire pendant la tache, une autre instance le
  // reprend, et en sortant nous ne devons PAS le lui retirer · sinon deux
  // instances se croisent sur la section critique.
  await withLock('test:vole', async () => {
    await db.query(
      `UPDATE cron_locks SET instance_id = 'autre-instance' WHERE name = $1`,
      ['test:vole']
    );
  });

  const r = await db.query('SELECT instance_id FROM cron_locks WHERE name = $1', ['test:vole']);
  assert.strictEqual(r.rows.length, 1, 'le bail de l autre instance doit survivre');
  assert.strictEqual(r.rows[0].instance_id, 'autre-instance');
});
