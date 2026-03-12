-- =============================================
-- Bakal — Supabase RLS Policies + Missing Tables
-- Run AFTER supabase-schema.sql in Supabase SQL Editor
-- =============================================

-- =============================================
-- Opportunities (prospects in pipeline)
-- =============================================
CREATE TABLE IF NOT EXISTS opportunities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  title           TEXT,
  company         TEXT,
  company_size    TEXT,
  status          TEXT DEFAULT 'new',
  status_color    TEXT DEFAULT 'var(--text-muted)',
  timing          TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_user ON opportunities(user_id);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- =============================================
-- Reports (weekly performance reports)
-- =============================================
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week            TEXT NOT NULL,
  date_range      TEXT,
  score           TEXT DEFAULT 'ok',
  score_label     TEXT,
  contacts        INTEGER DEFAULT 0,
  open_rate       DECIMAL,
  reply_rate      DECIMAL,
  interested      INTEGER DEFAULT 0,
  meetings        INTEGER DEFAULT 0,
  synthesis       TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- =============================================
-- Chart Data (weekly analytics snapshots)
-- =============================================
CREATE TABLE IF NOT EXISTS chart_data (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  email_count     INTEGER DEFAULT 0,
  linkedin_count  INTEGER DEFAULT 0,
  week_start      DATE,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_data_user ON chart_data(user_id);

ALTER TABLE chart_data ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RLS Policies for Supabase Auth
-- Users can only access their own data
-- =============================================

-- Drop the overly permissive policies first (ignore errors if they don't exist)
DO $$ BEGIN
  -- We'll recreate them with proper user scoping
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON campaigns';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON touchpoints';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON diagnostics';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON versions';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON projects';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON project_files';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON chat_threads';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON chat_messages';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON documents';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON user_profiles';
  EXECUTE 'DROP POLICY IF EXISTS "Service role full access" ON memory_patterns';
END $$;

-- Campaigns: users see only their own
CREATE POLICY "Users manage own campaigns" ON campaigns
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Touchpoints: via campaign ownership
CREATE POLICY "Users manage own touchpoints" ON touchpoints
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  )
  WITH CHECK (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

-- Diagnostics: via campaign ownership
CREATE POLICY "Users manage own diagnostics" ON diagnostics
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  )
  WITH CHECK (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

-- Versions: via campaign ownership
CREATE POLICY "Users manage own versions" ON versions
  FOR ALL USING (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  )
  WITH CHECK (
    campaign_id IN (SELECT id FROM campaigns WHERE user_id = auth.uid())
  );

-- Projects: users see only their own
CREATE POLICY "Users manage own projects" ON projects
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Project files: via project ownership
CREATE POLICY "Users manage own project files" ON project_files
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Chat threads
CREATE POLICY "Users manage own threads" ON chat_threads
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Chat messages: via thread ownership
CREATE POLICY "Users manage own messages" ON chat_messages
  FOR ALL USING (
    thread_id IN (SELECT id FROM chat_threads WHERE user_id = auth.uid())
  )
  WITH CHECK (
    thread_id IN (SELECT id FROM chat_threads WHERE user_id = auth.uid())
  );

-- Documents
CREATE POLICY "Users manage own documents" ON documents
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- User profiles
CREATE POLICY "Users manage own profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Memory patterns: shared read, admin write
CREATE POLICY "Everyone reads memory" ON memory_patterns
  FOR SELECT USING (true);

CREATE POLICY "Authenticated insert memory" ON memory_patterns
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Opportunities
CREATE POLICY "Users manage own opportunities" ON opportunities
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Reports
CREATE POLICY "Users manage own reports" ON reports
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Chart data
CREATE POLICY "Users manage own chart data" ON chart_data
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================
-- Dashboard KPIs aggregate function (RPC)
-- =============================================
CREATE OR REPLACE FUNCTION get_dashboard_kpis(p_user_id UUID)
RETURNS JSON AS $$
  SELECT json_build_object(
    'total_contacts',   COALESCE(SUM(nb_prospects), 0),
    'active_campaigns', COUNT(*) FILTER (WHERE status = 'active'),
    'avg_open_rate',    ROUND(AVG(open_rate) FILTER (WHERE open_rate IS NOT NULL), 1),
    'avg_reply_rate',   ROUND(AVG(reply_rate) FILTER (WHERE reply_rate IS NOT NULL), 1),
    'total_interested', COALESCE(SUM(interested), 0),
    'total_meetings',   COALESCE(SUM(meetings), 0)
  )
  FROM campaigns
  WHERE user_id = p_user_id AND status IN ('active', 'optimizing');
$$ LANGUAGE sql SECURITY DEFINER;

-- =============================================
-- Triggers for new tables
-- =============================================
CREATE TRIGGER trg_opportunities_updated_at BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
