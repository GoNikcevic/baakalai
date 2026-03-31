-- Conditional/branching sequence support
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS parent_step_id UUID REFERENCES touchpoints(id);
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS condition_type TEXT; -- 'opened', 'replied', 'clicked', 'not_opened', 'not_replied', 'accepted', 'not_accepted', 'default'
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS condition_value TEXT; -- optional custom value
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS branch_label TEXT; -- human-readable label like "Si ouvert", "Si pas répondu"
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS is_root BOOLEAN DEFAULT true; -- true for top-level steps, false for branch children

CREATE INDEX IF NOT EXISTS idx_touchpoints_parent ON touchpoints(parent_step_id);
