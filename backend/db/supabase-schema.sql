-- =============================================
-- Bakal — Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- Users
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  company         TEXT,
  role            TEXT NOT NULL DEFAULT 'client'
                  CHECK (role IN ('admin', 'client')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================
-- Projects
-- =============================================
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  client          TEXT,
  description     TEXT,
  color           TEXT DEFAULT 'var(--blue)',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

-- =============================================
-- Campaigns
-- =============================================
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id),
  project_id      UUID REFERENCES projects(id),
  name            TEXT NOT NULL,
  client          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'prep'
                  CHECK (status IN ('active', 'prep', 'terminated', 'optimizing')),
  channel         TEXT NOT NULL DEFAULT 'email'
                  CHECK (channel IN ('email', 'linkedin', 'multi')),
  sector          TEXT,
  sector_short    TEXT,
  position        TEXT,
  size            TEXT,
  angle           TEXT,
  zone            TEXT,
  tone            TEXT DEFAULT 'Pro décontracté',
  formality       TEXT DEFAULT 'Vous',
  length          TEXT DEFAULT 'Standard',
  cta             TEXT,
  start_date      DATE,
  lemlist_id      TEXT,
  iteration       INTEGER DEFAULT 1,
  nb_prospects    INTEGER DEFAULT 0,
  sent            INTEGER DEFAULT 0,
  planned         INTEGER DEFAULT 0,
  open_rate       DECIMAL,
  reply_rate      DECIMAL,
  accept_rate_lk  DECIMAL,
  reply_rate_lk   DECIMAL,
  interested      INTEGER DEFAULT 0,
  meetings        INTEGER DEFAULT 0,
  stops           DECIMAL,
  last_collected  TIMESTAMPTZ,
  notion_page_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_lemlist ON campaigns(lemlist_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id);

-- =============================================
-- Touchpoints (sequence steps)
-- =============================================
CREATE TABLE IF NOT EXISTS touchpoints (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('email', 'linkedin')),
  label           TEXT,
  sub_type        TEXT,
  timing          TEXT,
  subject         TEXT,
  body            TEXT,
  max_chars       INTEGER,
  open_rate       DECIMAL,
  reply_rate      DECIMAL,
  stop_rate       DECIMAL,
  accept_rate     DECIMAL,
  interested      INTEGER DEFAULT 0,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_touchpoints_campaign ON touchpoints(campaign_id);

-- =============================================
-- Diagnostics (AI analysis results)
-- =============================================
CREATE TABLE IF NOT EXISTS diagnostics (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  date_analyse    DATE DEFAULT CURRENT_DATE,
  diagnostic      TEXT NOT NULL,
  priorities      TEXT[],
  nb_to_optimize  INTEGER DEFAULT 0,
  notion_page_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_campaign ON diagnostics(campaign_id);

-- =============================================
-- Versions (campaign iteration history)
-- =============================================
CREATE TABLE IF NOT EXISTS versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  date            DATE DEFAULT CURRENT_DATE,
  messages_modified TEXT[],
  hypotheses      TEXT,
  result          TEXT DEFAULT 'testing'
                  CHECK (result IN ('testing', 'improved', 'degraded', 'neutral')),
  notion_page_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_versions_campaign ON versions(campaign_id);

-- =============================================
-- Cross-Campaign Memory (pattern library)
-- =============================================
CREATE TABLE IF NOT EXISTS memory_patterns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern         TEXT NOT NULL,
  category        TEXT NOT NULL
                  CHECK (category IN ('Objets', 'Corps', 'Timing', 'LinkedIn', 'Secteur', 'Cible')),
  data            JSONB,
  confidence      TEXT DEFAULT 'Faible'
                  CHECK (confidence IN ('Haute', 'Moyenne', 'Faible')),
  date_discovered DATE DEFAULT CURRENT_DATE,
  sectors         TEXT[],
  targets         TEXT[],
  notion_page_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_patterns(category);
CREATE INDEX IF NOT EXISTS idx_memory_confidence ON memory_patterns(confidence);

-- =============================================
-- Chat Threads
-- =============================================
CREATE TABLE IF NOT EXISTS chat_threads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT DEFAULT 'Nouvelle conversation',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id);

-- =============================================
-- Chat Messages
-- =============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);

-- =============================================
-- Settings (key-value store)
-- =============================================
CREATE TABLE IF NOT EXISTS settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Refresh Tokens
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- =============================================
-- Documents (uploaded files)
-- =============================================
CREATE TABLE IF NOT EXISTS documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  mime_type       TEXT,
  file_size       INTEGER,
  file_path       TEXT NOT NULL,
  parsed_text     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

-- =============================================
-- User Profiles (client config)
-- =============================================
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company           TEXT,
  sector            TEXT,
  website           TEXT,
  team_size         TEXT,
  description       TEXT,
  value_prop        TEXT,
  social_proof      TEXT,
  pain_points       TEXT,
  objections        TEXT,
  persona_primary   TEXT,
  persona_secondary TEXT,
  target_sectors    TEXT,
  target_size       TEXT,
  target_zones      TEXT,
  default_tone      TEXT DEFAULT 'Pro décontracté',
  default_formality TEXT DEFAULT 'Vous',
  avoid_words       TEXT,
  signature_phrases TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- Project Files
-- =============================================
CREATE TABLE IF NOT EXISTS project_files (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  mime_type       TEXT,
  file_size       INTEGER,
  file_path       TEXT NOT NULL,
  parsed_text     TEXT,
  category        TEXT DEFAULT 'other',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);

-- =============================================
-- Custom Variables (user-defined template variables)
-- =============================================
CREATE TABLE IF NOT EXISTS custom_variables (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  label           TEXT,
  category        TEXT DEFAULT 'custom'
                  CHECK (category IN ('prospect', 'company', 'enrichment', 'custom')),
  sync_mode       TEXT DEFAULT 'local'
                  CHECK (sync_mode IN ('push', 'pull', 'bidirectional', 'local')),
  default_value   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_variables_user ON custom_variables(user_id);

ALTER TABLE custom_variables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON custom_variables;
CREATE POLICY "Service role full access" ON custom_variables FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- Auto-update updated_at trigger
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_touchpoints_updated_at ON touchpoints;
CREATE TRIGGER trg_touchpoints_updated_at BEFORE UPDATE ON touchpoints FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_chat_threads_updated_at ON chat_threads;
CREATE TRIGGER trg_chat_threads_updated_at BEFORE UPDATE ON chat_threads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated_at ON settings;
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- Row Level Security (RLS) — basic setup
-- Enable RLS on tables, policies to be refined later
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE touchpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for N8N workflows and backend)
-- Clients will access through the backend API, not directly via Supabase client
DROP POLICY IF EXISTS "Service role full access" ON users;
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON campaigns;
CREATE POLICY "Service role full access" ON campaigns FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON touchpoints;
CREATE POLICY "Service role full access" ON touchpoints FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON diagnostics;
CREATE POLICY "Service role full access" ON diagnostics FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON versions;
CREATE POLICY "Service role full access" ON versions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON memory_patterns;
CREATE POLICY "Service role full access" ON memory_patterns FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON chat_threads;
CREATE POLICY "Service role full access" ON chat_threads FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON chat_messages;
CREATE POLICY "Service role full access" ON chat_messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON documents;
CREATE POLICY "Service role full access" ON documents FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON user_profiles;
CREATE POLICY "Service role full access" ON user_profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON projects;
CREATE POLICY "Service role full access" ON projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON project_files;
CREATE POLICY "Service role full access" ON project_files FOR ALL USING (true) WITH CHECK (true);
