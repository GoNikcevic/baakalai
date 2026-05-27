-- Add action_type to nurture_triggers and nurture_emails for LinkedIn support
-- Default 'email' for backward compatibility

ALTER TABLE nurture_triggers ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'email';
ALTER TABLE nurture_emails ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'email';

-- Index for filtering by action type
CREATE INDEX IF NOT EXISTS idx_nurture_emails_action_type ON nurture_emails (action_type);

-- Ensure prospect_activities can store LinkedIn activity types
-- (table already exists, just ensure we can store the new types)
COMMENT ON TABLE prospect_activities IS 'Tracks all outreach activities: email opens/clicks/replies + LinkedIn connect/message/visit';
