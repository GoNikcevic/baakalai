-- 062: Reactivation tracking — attribute won deals to reactivation emails
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS reactivated_from_email_id UUID;

CREATE INDEX IF NOT EXISTS idx_opps_reactivated ON opportunities(user_id, reactivated_at) WHERE reactivated_at IS NOT NULL;
