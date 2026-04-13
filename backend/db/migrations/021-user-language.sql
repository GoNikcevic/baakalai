ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'fr';
COMMENT ON COLUMN users.language IS 'UI language preference: fr, en';
