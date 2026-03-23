CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  pattern_id UUID REFERENCES memory_patterns(id),
  pattern_text TEXT NOT NULL,
  feedback TEXT NOT NULL CHECK (feedback IN ('useful', 'not_useful')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reco_feedback_user ON recommendation_feedback(user_id);
