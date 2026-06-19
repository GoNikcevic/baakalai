-- Migration: Add instance_url column to user_integrations for Salesforce OAuth
-- Existing code queries SELECT instance_url FROM user_integrations but the column was missing.

ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS instance_url TEXT;
