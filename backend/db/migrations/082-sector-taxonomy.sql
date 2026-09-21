-- Maps raw freeform sector text (from user_profiles.sector / opportunities.data->>'sector')
-- to a normalized sector name, so sector_churn_weights can join on a canonical value instead
-- of exact-matching arbitrary user input. Populated lazily by lib/sector-classifier.js.

CREATE TABLE IF NOT EXISTS sector_normalization_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_text TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('own_business', 'client_industry')),
  normalized_sector TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sector_norm_cache_unique
  ON sector_normalization_cache (lower(raw_text), scope);
