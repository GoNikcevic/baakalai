-- 054: Update touchpoints.type CHECK to include 'call' and 'sms'
-- Previous: ('email', 'linkedin', 'linkedin_visit', 'linkedin_invite', 'linkedin_message')
-- New: adds 'call' and 'sms' while keeping all existing subtypes valid

ALTER TABLE touchpoints DROP CONSTRAINT IF EXISTS touchpoints_type_check;
ALTER TABLE touchpoints ADD CONSTRAINT touchpoints_type_check
  CHECK (type IN ('email', 'linkedin', 'linkedin_visit', 'linkedin_invite', 'linkedin_message', 'call', 'sms'));
