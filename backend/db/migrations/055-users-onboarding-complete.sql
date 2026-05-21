-- Add onboarding_complete flag to users table (server-side tracking)
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;
