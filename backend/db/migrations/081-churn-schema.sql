-- Churn risk subsystem: sector weighting, outcome feedback loop, external signals.

-- Sector-based churn weighting. `sector` stores the NORMALIZED sector name (see
-- sector_normalization_cache in migration 065), not raw freeform user input.
CREATE TABLE IF NOT EXISTS sector_churn_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('own_business', 'client_industry')),
  multiplier NUMERIC NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sector, scope)
);

INSERT INTO sector_churn_weights (sector, scope, multiplier) VALUES
  ('SaaS', 'own_business', 1.0),
  ('Retail', 'own_business', 1.1),
  ('Conseil', 'own_business', 0.9),
  ('SaaS', 'client_industry', 0.9),
  ('Retail', 'client_industry', 1.2),
  ('Immobilier', 'client_industry', 1.15),
  ('Santé', 'client_industry', 0.85)
ON CONFLICT (sector, scope) DO NOTHING;

-- Churn outcome feedback loop — 3 outcome types, feeds future weight recalibration.
-- opportunity_id is the primary link (reuses the full existing client profile); client_name/
-- client_email are a fallback label ONLY for churns with no matching live CRM record.
CREATE TABLE IF NOT EXISTS churn_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT,
  client_email TEXT,
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('true_positive', 'false_positive', 'false_negative')),
  reason_category TEXT CHECK (reason_category IN ('prix', 'concurrent', 'support', 'produit_inadapte', 'budget_coupe', 'autre')),
  reason_text TEXT,
  predicted_score_at_time INT,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_outcomes_user ON churn_outcomes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_churn_outcomes_opportunity ON churn_outcomes(opportunity_id);

-- External web-signal findings for churn (separate from the prospecting `signals` table,
-- which is for finding new leads, not monitoring existing clients).
CREATE TABLE IF NOT EXISTS churn_external_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'brave_search',
  signal_type TEXT NOT NULL,
  detail TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_ext_signals_opp ON churn_external_signals(opportunity_id, detected_at DESC);
