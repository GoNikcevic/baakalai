-- 015-opportunities-email-hubspot.sql
-- Add missing columns on the opportunities table.
--
-- Context (2026-04-09 incident):
-- backend/db/index.js opportunities.create() INSERTs into these 3 columns,
-- but they were never present in the initial schema. Every insert throw a
-- "column email does not exist" error, which the caller route catches and
-- silently logs as a warn — resulting in every "Ajouter à la campagne"
-- call returning { created: 0 } without visible feedback to the user.
-- First surfaced when Goran tried to add 4 revealed biocarburants
-- prospects during the BforCure beta session and saw no change in
-- "Prospects liés à la campagne (0)".
--
-- email is used by routes/campaigns.js :: launch-lemlist to filter
-- eligible prospects (p.email), so without this column no launch
-- flow can ever succeed.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_deal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunities_email ON opportunities(email);
CREATE INDEX IF NOT EXISTS idx_opportunities_campaign_email ON opportunities(campaign_id, email);

COMMENT ON COLUMN opportunities.email IS 'Contact email, used by Lemlist launch flow to filter eligible prospects';
COMMENT ON COLUMN opportunities.hubspot_contact_id IS 'Optional HubSpot contact ID for integrations';
COMMENT ON COLUMN opportunities.hubspot_deal_id IS 'Optional HubSpot deal ID for integrations';
