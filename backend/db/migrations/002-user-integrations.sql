-- Migration: Per-user integration credentials
-- Each Bakal client stores their own HubSpot (and future CRM) tokens here.
-- Replaces the global hubspot_access_token from the settings table.

CREATE TABLE IF NOT EXISTS user_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'hubspot', 'pipedrive', 'salesforce', 'folk', etc.
  access_token TEXT NOT NULL,        -- encrypted token
  refresh_token TEXT,                -- encrypted, for OAuth flows
  metadata JSONB DEFAULT '{}',       -- portal_id, scopes, extra provider info
  expires_at TIMESTAMPTZ,            -- token expiration (if applicable)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- Fast lookup by user + provider
CREATE INDEX IF NOT EXISTS idx_user_integrations_user_provider
  ON user_integrations (user_id, provider);

-- Migrate existing global HubSpot token to first admin user (if any)
-- Run this manually if needed:
-- INSERT INTO user_integrations (user_id, provider, access_token)
--   SELECT u.id, 'hubspot', s.value
--   FROM settings s, users u
--   WHERE s.key = 'hubspot_access_token' AND u.role = 'admin'
--   LIMIT 1;
