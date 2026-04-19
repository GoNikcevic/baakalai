-- OAuth email credentials (team-level, shared across members)
-- Stores Gmail/Microsoft OAuth tokens or SMTP credentials
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- gmail, microsoft, smtp
  email_address TEXT NOT NULL,
  access_token TEXT, -- encrypted
  refresh_token TEXT, -- encrypted
  token_expiry TIMESTAMPTZ,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  smtp_pass TEXT, -- encrypted
  is_default BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active', -- active, expired, revoked
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_email_accounts_user ON email_accounts(user_id);

-- Nurture triggers — automated email rules
CREATE TABLE IF NOT EXISTS nurture_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- deal_won, deal_stagnant, inactive_contact, renewal, custom
  conditions JSONB NOT NULL DEFAULT '{}', -- { days: 30, stage: 'won', pipeline_id: ... }
  action_type TEXT NOT NULL DEFAULT 'email', -- email, sequence
  email_template JSONB, -- { subject_prompt, body_prompt, tone, ... } or null for AI-generated
  sequence_id UUID, -- reference to a sequence if action_type = 'sequence'
  mode TEXT DEFAULT 'approval', -- auto, approval
  enabled BOOLEAN DEFAULT true,
  crm_provider TEXT DEFAULT 'pipedrive',
  last_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_nurture_triggers_user ON nurture_triggers(user_id);

-- Nurture email log — tracks every email sent via nurture
CREATE TABLE IF NOT EXISTS nurture_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_id UUID REFERENCES nurture_triggers(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  email_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, approved, sent, failed, cancelled
  sent_at TIMESTAMPTZ,
  crm_activity_id TEXT, -- ID of the activity created in Pipedrive
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_nurture_emails_user ON nurture_emails(user_id);
CREATE INDEX idx_nurture_emails_status ON nurture_emails(status);
CREATE INDEX idx_nurture_emails_trigger ON nurture_emails(trigger_id);
