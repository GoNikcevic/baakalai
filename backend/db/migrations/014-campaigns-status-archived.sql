-- Allow 'archived' (and 'completed') as valid campaign statuses.
-- The legacy CHECK only permitted active/prep/terminated/optimizing, which
-- silently rejected the archive PATCH from the dashboard.

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('active', 'prep', 'terminated', 'optimizing', 'archived', 'completed'));
