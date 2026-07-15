-- Add active_crm_provider to users table
-- When multiple CRMs are connected, this determines which one the CRM agent syncs from
-- and which one is shown as "primary" in the UI.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_crm_provider TEXT;
