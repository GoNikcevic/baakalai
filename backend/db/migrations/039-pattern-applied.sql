-- 039: Add applied flag to memory patterns (user-approved recommendations)
ALTER TABLE memory_patterns ADD COLUMN IF NOT EXISTS applied BOOLEAN DEFAULT false;
