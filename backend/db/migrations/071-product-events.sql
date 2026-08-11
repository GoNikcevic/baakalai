-- 071 — Instrumentation du funnel d'activation.
--
-- POURQUOI : on ne sait pas où les beta testers décrochent entre le signup et
-- la première valeur (deals dormants affichés). Aucun outil tiers : une table
-- maison, écrite en best-effort par le backend (lib/track.js) et par le
-- frontend via POST /api/events. Lecture : scripts/funnel-report.js.

CREATE TABLE IF NOT EXISTS product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,                  -- pas de FK : on garde les événements même si
                                 -- l'utilisateur est supprimé (funnel agrégé)
  event TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Le funnel se lit par événement et par fenêtre de temps.
CREATE INDEX IF NOT EXISTS idx_product_events_event_created
  ON product_events (event, created_at DESC);

-- Parcours d'un utilisateur donné (debug d'un beta tester précis).
CREATE INDEX IF NOT EXISTS idx_product_events_user
  ON product_events (user_id, created_at DESC);

-- Accès backend uniquement (service_role via pg direct) — même posture que
-- cron_runs (069).
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_events FROM anon, authenticated;
