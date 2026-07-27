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

module.exports = { withLock, INSTANCE_ID, DEFAULT_TTL_SECONDS };
