-- 034: Add churn prediction scoring to opportunities
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS churn_score INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS churn_factors JSONB;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS churn_scored_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_opportunities_churn ON opportunities(user_id, churn_score DESC) WHERE churn_score IS NOT NULL;
