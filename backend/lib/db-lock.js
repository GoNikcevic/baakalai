/**
 * Verrou d'exclusion mutuelle pour les tâches planifiées.
 *
 * ── Pourquoi PAS pg_advisory_lock ─────────────────────────────────────────────
 * C'est le réflexe naturel, et c'est un piège ici. `DATABASE_URL` pointe sur
 * Supavisor (port 6543) en **mode transaction** : le pooler multiplexe les
 * clients sur un petit nombre de connexions serveur, et rien ne garantit que
 * deux requêtes successives — même via `pool.connect()` — atterrissent sur la
 * même session serveur.
 *
 * Or un advisory lock appartient à la SESSION. Concrètement, mesuré sur cette
 * base : `pg_try_advisory_lock` se pose sur la connexion serveur X,
 * `pg_advisory_unlock` part sur la connexion Y, renvoie `false`, et le verrou
 * reste détenu par X — une connexion `idle` du pooler que plus personne ne
 * pilote.
 *
 * Conséquence : le verrou fuit définitivement, `pg_try_advisory_lock` renvoie
 * `false` pour toujours, et la tâche ne s'exécute PLUS JAMAIS. Un verrou fuité
 * est strictement pire que pas de verrou du tout.
 *
 * ── L'approche retenue : un bail en table ─────────────────────────────────────
 * Un `INSERT ... ON CONFLICT DO UPDATE ... WHERE expires_at < now()` est une
 * **instruction atomique unique**, donc insensible au mode de pooling. Le bail
 * porte une expiration : si le process meurt sans libérer, le verrou se périme
 * tout seul et la tâche repart au créneau suivant.
 */

const db = require('../db');
const logger = require('./logger');

/** Marge de sécurité par défaut : au-delà, on considère le détenteur mort. */
const DEFAULT_TTL_SECONDS = 30 * 60;

/** Identifiant de l'instance — sert à ne libérer que son propre bail. */
const INSTANCE_ID =
  process.env.RAILWAY_DEPLOYMENT_ID ||
  `${process.env.HOSTNAME || 'local'}:${process.pid}`;

/**
 * Exécute `fn` en s'assurant qu'une seule instance le fait à la fois.
 *
 * @param {string} name             identifiant logique (ex: 'cron:crm-agent')
 * @param {Function} fn             section critique
 * @param {object} [opts]
 * @param {number} [opts.ttlSeconds] durée du bail (défaut 30 min)
 * @returns {Promise<{ran: boolean, skipped?: string, result?: any}>}
 */
async function withLock(name, fn, opts = {}) {
  const ttl = opts.ttlSeconds || DEFAULT_TTL_SECONDS;

  let acquired = false;
  try {
    const res = await db.query(
      `INSERT INTO cron_locks (name, instance_id, locked_at, expires_at)
       VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
       ON CONFLICT (name) DO UPDATE
         SET instance_id = EXCLUDED.instance_id,
             locked_at   = EXCLUDED.locked_at,
             expires_at  = EXCLUDED.expires_at
         WHERE cron_locks.expires_at < now()
       RETURNING name`,
      [name, INSTANCE_ID, String(ttl)]
    );
    acquired = res.rows.length > 0;
  } catch (err) {
    // Si la table n'existe pas encore (migration non jouée), on préfère laisser
    // la tâche s'exécuter plutôt que de la bloquer silencieusement.
    logger.warn('db-lock', `lock acquisition failed, running unguarded: ${err.message}`, { name });
    return { ran: true, result: await fn() };
  }

  if (!acquired) {
    return { ran: false, skipped: 'locked' };
  }

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      // On ne supprime que SON bail : si le nôtre a expiré et qu'une autre
      // instance l'a repris entre-temps, on ne doit pas le lui retirer.
      await db.query('DELETE FROM cron_locks WHERE name = $1 AND instance_id = $2', [name, INSTANCE_ID]);
    } catch (err) {
      // Non bloquant : le bail expirera de lui-même.
      logger.warn('db-lock', `lock release failed: ${err.message}`, { name });
    }
  }
}

/** Compteur local : distingue deux acquisitions concurrentes du même process. */
let _seq = 0;

/** Libération inerte — sert quand le bail n'a pas été obtenu. */
const NOOP_RELEASE = async () => {};

/**
 * Variante impérative de `withLock`, pour les sections critiques à sorties
 * multiples qu'on ne peut pas envelopper dans un callback.
 *
 * Contrat en cas de contention : `acquire` ATTEND, mais de façon BORNÉE
 * (`waitMs`, 5 s par défaut). Passé ce délai il renvoie une libération inerte
 * et laisse l'appelant continuer sans garde.
 *
 * Ce choix vient d'une mesure : sans attente du tout, trois écritures
 * concurrentes du même pattern produisaient trois lignes — exactement
 * l'explosion que la déduplication doit empêcher. Avec une attente non bornée
 * (le `pg_advisory_lock` d'origine), un bail bloqué figeait l'écriture plus de
 * deux minutes. L'attente bornée sérialise le cas courant sans jamais pouvoir
 * bloquer indéfiniment.
 *
 * @returns {Promise<Function>} fonction de libération, toujours sûre à appeler
 */
async function acquire(name, opts = {}) {
  const ttl = opts.ttlSeconds || DEFAULT_TTL_SECONDS;
  const waitMs = opts.waitMs ?? 5000;
  const pollMs = opts.pollMs ?? 50;
  const holder = `${INSTANCE_ID}#${++_seq}`;
  const deadline = Date.now() + waitMs;

  for (;;) {
    try {
      const res = await db.query(
        `INSERT INTO cron_locks (name, instance_id, locked_at, expires_at)
         VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
         ON CONFLICT (name) DO UPDATE
           SET instance_id = EXCLUDED.instance_id,
               locked_at   = EXCLUDED.locked_at,
               expires_at  = EXCLUDED.expires_at
           WHERE cron_locks.expires_at < now()
         RETURNING name`,
        [name, holder, String(ttl)]
      );
      if (res.rows.length > 0) break; // bail obtenu
    } catch (err) {
      logger.warn('db-lock', `acquire impossible, section non gardee: ${err.message}`, { name });
      return NOOP_RELEASE;
    }

    if (Date.now() >= deadline) {
      // Le détenteur est anormalement long ou mort sans libérer. On préfère
      // une écriture non gardée (au pire un doublon) à un blocage.
      logger.warn('db-lock', `bail non obtenu apres ${waitMs}ms, section non gardee`, { name });
      return NOOP_RELEASE;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }

  return async () => {
    try {
      // Ne libérer que SON bail : si le nôtre a expiré et qu'un autre l'a
      // repris, on ne doit pas le lui retirer.
      await db.query('DELETE FROM cron_locks WHERE name = $1 AND instance_id = $2', [name, holder]);
    } catch (err) {
      logger.warn('db-lock', `release impossible, le bail expirera seul: ${err.message}`, { name });
    }
  };
}

module.exports = { withLock, acquire, INSTANCE_ID, DEFAULT_TTL_SECONDS };
