-- Migration 017: Relax memory_patterns.category CHECK constraint
-- The previous constraint only allowed: 'Objets', 'Corps', 'Timing', 'LinkedIn', 'Secteur', 'Cible'
-- This was too restrictive and would block future memory extensions.
-- New constraint: category must be non-empty text (any value accepted).

ALTER TABLE memory_patterns DROP CONSTRAINT memory_patterns_category_check;

ALTER TABLE memory_patterns ADD CONSTRAINT memory_patterns_category_check
  CHECK (category IS NOT NULL AND length(trim(category)) > 0);
