-- Migration: Add HubSpot integration fields to opportunities table
-- Run in Supabase SQL Editor or via psql

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_deal_id TEXT;

-- Index for quick lookup by HubSpot IDs
CREATE INDEX IF NOT EXISTS idx_opportunities_hubspot_contact
  ON opportunities (hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_hubspot_deal
  ON opportunities (hubspot_deal_id)
  WHERE hubspot_deal_id IS NOT NULL;

-- Add email column to opportunities (needed for HubSpot contact matching)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS email TEXT;
