-- Add source column to distinguish activities from different providers
ALTER TABLE prospect_activities ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'lemlist';
CREATE INDEX IF NOT EXISTS idx_prospect_activities_source ON prospect_activities(source);
