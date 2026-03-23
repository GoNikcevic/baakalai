CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  popularity INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'static',
  source_campaign_id UUID REFERENCES campaigns(id),
  sequence JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_sector ON templates(sector);
CREATE INDEX IF NOT EXISTS idx_templates_source ON templates(source);
