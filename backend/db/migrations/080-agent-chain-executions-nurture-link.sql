-- Link agent_chain_executions to the nurture_emails row it produced, replacing the
-- fragile (user_id, opportunity_id, status='pending') fuzzy match used previously.

ALTER TABLE agent_chain_executions
  ADD COLUMN IF NOT EXISTS nurture_email_id UUID REFERENCES nurture_emails(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chain_exec_nurture_email ON agent_chain_executions(nurture_email_id);
