-- 018-opportunities-linkedin-url.sql
-- Add linkedin_url to opportunities table.
--
-- Context: the bulk email reveal feature (ProspectsTab) needs the LinkedIn
-- URL to call Lemlist's enrichment API. Without it, the validation
-- (linkedinUrl OR firstName+lastName+companyName+companyDomain) fails
-- for every prospect that doesn't have all 4 name+company+domain fields.
-- LinkedIn URL is the most reliable enrichment path.
--
-- The URL is now saved during POST /campaigns/:id/prospects (add to campaign)
-- from the original Lemlist search results which include lead_linkedin_url.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
CREATE INDEX IF NOT EXISTS idx_opportunities_linkedin_url ON opportunities(linkedin_url) WHERE linkedin_url IS NOT NULL;
