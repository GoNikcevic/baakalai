-- Conversation Autopilot: scheduled reply queue + opportunity flag

CREATE TABLE IF NOT EXISTS autopilot_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  to_name TEXT,
  channel TEXT NOT NULL DEFAULT 'email',
  content JSONB NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autopilot_queue_pending ON autopilot_queue (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_autopilot_queue_user ON autopilot_queue (user_id);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS autopilot_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
