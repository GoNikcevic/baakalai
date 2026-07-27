-- 066: Bail d'exclusion mutuelle pour les tâches planifiées
--
-- node-cron est purement in-process : chaque instance enregistre ses propres
-- crons. Avec deux replicas Railway — ou pendant un redéploiement qui chevauche
-- un créneau — la même tâche s'exécute deux fois : double facture LLM et emails
-- envoyés en double aux contacts des clients.
--
-- ⚠️ pg_advisory_lock ne convient PAS ici. DATABASE_URL pointe sur Supavisor
-- (port 6543) en mode transaction : les advisory locks sont liés à la session
-- serveur, que le pooler ne garantit pas stable entre deux requêtes. Mesuré sur
-- cette base : le lock se pose sur une connexion, l'unlock part sur une autre,
-- échoue, et le verrou reste détenu par une connexion `idle` du pooler — donc
-- fuit définitivement et bloquerait la tâche POUR TOUJOURS.
--
-- Un bail en table s'acquiert par une instruction atomique unique
-- (INSERT ... ON CONFLICT DO UPDATE ... WHERE expires_at < now()), insensible
-- au mode de pooling, et se périme tout seul si le process meurt.

CREATE TABLE IF NOT EXISTS cron_locks (
  name        TEXT PRIMARY KEY,
  instance_id TEXT        NOT NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE cron_locks IS
  'Bail d''exclusion mutuelle des tâches planifiées. Une ligne par tâche active. '
  'Voir lib/db-lock.js — ne pas remplacer par pg_advisory_lock (pooler en mode transaction).';

-- Purge des baux périmés : utile pour l''observabilité, pas pour la correction
-- (l''acquisition écrase déjà tout bail expiré).
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires ON cron_locks(expires_at);
