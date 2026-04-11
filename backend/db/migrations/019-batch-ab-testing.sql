-- 019-batch-ab-testing.sql
-- Batch support for progressive A/B testing on large lists (500+ contacts).
-- Instead of pushing all contacts at once, split into batches of ~100.
-- Each batch runs an A/B test, winner carries to next batch.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS batch_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_size INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS current_batch INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_batches INTEGER DEFAULT 0;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS batch_number INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_opportunities_batch
  ON opportunities(campaign_id, batch_number);
