-- 069 — Traçage des exécutions de crons + dead-man's switch.
--
-- POURQUOI : la variable Railway " ORCHESTRATOR_ENABLED" (espace en tête) a
-- éteint les 8 crons pendant ~3 mois sans qu'aucun signal ne le révèle. Un
-- cron qui ne se déclenche pas ne produit aucune erreur, juste une absence.
-- Cette migration donne au processus web (qui tourne indépendamment du flag
-- orchestrateur) de quoi détecter cette absence et alerter.

CREATE TABLE IF NOT EXISTS cron_runs (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,                    -- NULL = en cours (ou tué par un redeploy)
  error TEXT,
  meta JSONB
);

-- Le watchdog ne lit que « dernière exécution par job » : index couvrant.
CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs (job, started_at DESC);

-- Déduplication des alertes : une alerte par job et par 24h, pas une par
-- passage du watchdog (horaire).
CREATE TABLE IF NOT EXISTS cron_alerts (
  job TEXT PRIMARY KEY,
  last_alert_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Accès backend uniquement (service_role via pg direct) — même posture que
-- cron_locks. L'event trigger ensure_rls active RLS automatiquement, mais on
-- l'explicite pour ne pas dépendre de lui.
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cron_runs FROM anon, authenticated;
REVOKE ALL ON cron_alerts FROM anon, authenticated;
