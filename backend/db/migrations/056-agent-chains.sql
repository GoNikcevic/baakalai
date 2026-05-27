-- Agent Chains — autonomous action chains triggered by agent outputs
-- Supports: deal_reactivation, auto_upsell (more to come)

CREATE TABLE IF NOT EXISTS agent_chain_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_type TEXT NOT NULL,
  trigger_agent TEXT NOT NULL,
  trigger_data JSONB DEFAULT '{}',
  steps_completed TEXT[] DEFAULT '{}',
  result JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ,
  CONSTRAINT chain_type_check CHECK (chain_type IN ('deal_reactivation', 'auto_upsell', 'adaptive_prospection')),
  CONSTRAINT chain_status_check CHECK (status IN ('pending', 'approved', 'executed', 'blocked', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_chain_exec_user ON agent_chain_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_exec_status ON agent_chain_executions(status) WHERE status = 'pending';

-- Per-user chain configuration (stored in user_settings if exists, else standalone)
-- Using a dedicated table to avoid schema dependency on user_settings
CREATE TABLE IF NOT EXISTS agent_chain_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deal_reactivation JSONB NOT NULL DEFAULT '{"enabled": false, "approval_required": true, "max_per_day": 3, "min_stagnant_days": 14, "exclude_above_value": null}',
  auto_upsell JSONB NOT NULL DEFAULT '{"enabled": false, "approval_required": true, "max_per_day": 2, "min_score": 50}',
  adaptive_prospection JSONB NOT NULL DEFAULT '{"enabled": false, "approval_required": false, "max_per_day": 5}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
