-- A/B testing: add variant B fields to touchpoints
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS subject_b TEXT;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS body_b TEXT;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS open_rate_b REAL;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS reply_rate_b REAL;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS accept_rate_b REAL;
