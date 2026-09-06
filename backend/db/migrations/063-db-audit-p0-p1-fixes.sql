-- 063: DB Audit P0 + P1 fixes
-- P0-B: CASCADE on recommendation_feedback
-- P0-C: nurture_triggers default NULL
-- P1-A/D: Composite indexes on opportunities
-- P2-B/C/F/I: Functional indexes + CHECK constraint

-- P0-B: Add ON DELETE CASCADE to recommendation_feedback
ALTER TABLE recommendation_feedback DROP CONSTRAINT IF EXISTS recommendation_feedback_user_id_fkey;
ALTER TABLE recommendation_feedback ADD CONSTRAINT recommendation_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE recommendation_feedback DROP CONSTRAINT IF EXISTS recommendation_feedback_pattern_id_fkey;
ALTER TABLE recommendation_feedback ADD CONSTRAINT recommendation_feedback_pattern_id_fkey
  FOREIGN KEY (pattern_id) REFERENCES memory_patterns(id) ON DELETE SET NULL;

-- P0-C: Change nurture_triggers.crm_provider default from 'pipedrive' to NULL
ALTER TABLE nurture_triggers ALTER COLUMN crm_provider DROP DEFAULT;

-- P1-A: Composite index for multi-CRM queries
CREATE INDEX IF NOT EXISTS idx_opportunities_user_crm ON opportunities(user_id, crm_provider);

-- P1-D: Composite index for dashboard status queries
CREATE INDEX IF NOT EXISTS idx_opportunities_user_status ON opportunities(user_id, status);

-- P2-C: Functional index for LOWER(email) queries
CREATE INDEX IF NOT EXISTS idx_opportunities_email_lower ON opportunities(user_id, LOWER(email));

-- P2-F: Partial index for pending nurture emails
CREATE INDEX IF NOT EXISTS idx_nurture_emails_user_pending ON nurture_emails(user_id, created_at DESC) WHERE status = 'pending';

-- P2-I: Index for stagnant deals queries
CREATE INDEX IF NOT EXISTS idx_opportunities_user_activity ON opportunities(user_id, last_activity_at DESC) WHERE last_activity_at IS NOT NULL;

-- P2-B: CHECK constraint on active_crm_provider
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_active_crm_check
    CHECK (active_crm_provider IS NULL OR active_crm_provider IN ('pipedrive','hubspot','salesforce','odoo','notion','airtable','folk'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
