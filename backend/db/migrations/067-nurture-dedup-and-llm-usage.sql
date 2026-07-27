-- 067: Déduplication réelle des emails de nurture + comptabilité des appels LLM

-- ============================================================
-- Déduplication des emails en attente
-- ============================================================
-- Les protections anti-doublon étaient toutes des *check-then-act* :
--   SELECT id FROM nurture_emails WHERE ... AND status='pending'
--   → puis INSERT si rien trouvé
-- Sans contrainte d'unicité derrière, deux exécutions concurrentes (deux
-- instances, ou les deux chaînes lancées en Promise.all sur le même contact)
-- passent toutes les deux le SELECT et insèrent chacune leur ligne.
--
-- Cet index rend la garde réelle : un seul email en attente par contact.
-- Partiel sur status='pending' — l'historique des envois reste libre.
--
-- Note : opportunity_id est NULLable, et Postgres ne fait pas conflit sur NULL.
-- Les emails sans contact rattaché ne sont donc pas contraints, ce qui est le
-- comportement voulu.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_nurture_emails_pending_per_contact
  ON nurture_emails (user_id, opportunity_id)
  WHERE status = 'pending' AND opportunity_id IS NOT NULL;

-- ============================================================
-- Comptabilité des appels LLM
-- ============================================================
-- Les tokens sont journalisés à chaque appel (api/claude.js) mais jamais
-- agrégés : aucune table d'usage, aucun budget, aucun prix calculé. Le coût
-- n'était reconstructible qu'en parsant les logs Railway — qui partent sur
-- stdout sans rétention.
--
-- Une ligne par appel. Le calcul du coût est laissé à la lecture (les tarifs
-- changent), on stocke la matière première.

CREATE TABLE IF NOT EXISTS llm_usage (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  action             TEXT,
  model              TEXT        NOT NULL,
  user_id            UUID,
  input_tokens       INTEGER     NOT NULL DEFAULT 0,
  output_tokens      INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER     NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER     NOT NULL DEFAULT 0,
  duration_ms        INTEGER,
  ok                 BOOLEAN     NOT NULL DEFAULT true,
  error_type         TEXT
);

COMMENT ON TABLE llm_usage IS
  'Une ligne par appel LLM. Alimentée par api/claude.js (écriture best-effort, '
  'ne doit jamais faire échouer un appel). Sert au suivi de coût et à la '
  'détection de dérive avant/après rallumage de l''orchestrateur.';

-- Requête type : coût par jour et par action.
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_action  ON llm_usage(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user    ON llm_usage(user_id, created_at DESC) WHERE user_id IS NOT NULL;
