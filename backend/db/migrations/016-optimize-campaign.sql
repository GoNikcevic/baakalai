-- Campaign optimization feature: track the last time an optimization was run
-- to enforce a 7-day cooldown between optimizations on the same campaign.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_optimized_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast lookups when checking the cooldown
CREATE INDEX IF NOT EXISTS idx_campaigns_last_optimized
  ON campaigns(last_optimized_at)
  WHERE last_optimized_at IS NOT NULL;
