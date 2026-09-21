-- lib/agent-chains.js has always written a `metadata` JSONB column on nurture_emails
-- (chain type, trigger context) but no migration ever created it — likely added directly
-- on production out-of-band, the same kind of drift as users.password_hash. Adding it here
-- properly since the new approval-queue tabs depend on filtering by metadata->>'chain'.

ALTER TABLE nurture_emails ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
