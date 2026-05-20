-- 053: Ensure memory_patterns.confidence CHECK constraint
-- Values: 'Haute', 'Moyenne', 'Faible'
-- This constraint already exists in the base schema but we ensure it via migration for safety.

ALTER TABLE memory_patterns DROP CONSTRAINT IF EXISTS memory_patterns_confidence_check;
ALTER TABLE memory_patterns ADD CONSTRAINT memory_patterns_confidence_check
  CHECK (confidence IN ('Haute', 'Moyenne', 'Faible'));
