-- 036: Team campaigns — admin launches campaigns for the sales team
CREATE TABLE IF NOT EXISTS team_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, preview, running, completed, cancelled
  target_owners UUID[] DEFAULT '{}', -- empty = all team members
  target_product_lines UUID[] DEFAULT '{}', -- empty = all
  email_prompt TEXT, -- AI prompt for email generation
  email_tone TEXT DEFAULT 'professional',
  total_contacts INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_team_campaigns_team ON team_campaigns(team_id);

-- Link nurture_emails to team campaigns
ALTER TABLE nurture_emails ADD COLUMN IF NOT EXISTS team_campaign_id UUID REFERENCES team_campaigns(id) ON DELETE SET NULL;
