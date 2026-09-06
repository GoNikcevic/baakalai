-- 073 — Historique des résultats d'agents stratégiques.
--
-- POURQUOI : Deal Coach et Upsell Detector ne persistaient rien — le dashboard
-- relançait jusqu'à 10 appels Claude à chaque affichage (DealCoachCard), et
-- aucun historique ne permettait de mesurer la justesse des suggestions.
-- Écrit par lib/agents/strategic-orchestrator.js (runOne/runAll), lu par
-- GET /api/strategic/results/:agent. Purge 90 jours dans le cron
-- strategic-daily.

CREATE TABLE IF NOT EXISTS strategic_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,           -- clé AGENTS : deal_coach, upsell, copy_optimizer, …
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lecture type : dernier résultat d'un agent pour un utilisateur.
CREATE INDEX IF NOT EXISTS idx_strategic_results_latest
  ON strategic_results (user_id, agent, created_at DESC);

-- Accès backend uniquement (service_role via pg direct) — même posture que
-- product_events (071).
ALTER TABLE strategic_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON strategic_results FROM anon, authenticated;
