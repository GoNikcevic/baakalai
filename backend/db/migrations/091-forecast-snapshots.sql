-- 091 — Photographies hebdomadaires du forecast (boucle de calibration)
--
-- Chaque lundi (job digest), le forecast pondéré est photographié avec le
-- détail par deal. Chaque dimanche (Memory Agent), les photos assez vieilles
-- (>= 30 j) sont comparées aux résultats réels : l'écart devient un facteur
-- de calibration stocké en mémoire (source 'forecast_calibration') et
-- appliqué aux forecasts suivants — un forecast qui apprend son propre biais.

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_days INT NOT NULL DEFAULT 90,
  commit_value NUMERIC NOT NULL DEFAULT 0,
  weighted_value NUMERIC NOT NULL DEFAULT 0,
  optimistic_value NUMERIC NOT NULL DEFAULT 0,
  calibration_applied NUMERIC NOT NULL DEFAULT 1.0,
  deals JSONB NOT NULL DEFAULT '[]',   -- [{ id, value, probability, category }]
  evaluated_at TIMESTAMPTZ             -- posé quand la photo a servi à calibrer
);

CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_user ON forecast_snapshots(user_id, taken_at DESC);
