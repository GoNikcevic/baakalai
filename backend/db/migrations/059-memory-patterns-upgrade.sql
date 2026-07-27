-- 059: memory_patterns upgrade — confidence_score, embedding, updated_at, index cleanup
-- Safe: all additive, no breaking changes

-- 1. Add confidence_score NUMERIC for precise agent scoring
ALTER TABLE memory_patterns
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,2);

-- Backfill from text confidence
UPDATE memory_patterns SET confidence_score = CASE
  WHEN confidence = 'Haute'   THEN 0.90
  WHEN confidence = 'Moyenne' THEN 0.60
  WHEN confidence = 'Faible'  THEN 0.30
  ELSE 0.30
END
WHERE confidence_score IS NULL;

-- 2. Add embedding vector directly on the table (avoids JOIN with memory_embeddings)
ALTER TABLE memory_patterns
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Backfill embeddings from memory_embeddings where available
UPDATE memory_patterns mp
SET embedding = me.embedding
FROM memory_embeddings me
WHERE me.source_type = 'pattern'
  AND me.source_id = mp.id
  AND mp.embedding IS NULL;

-- 3. Add updated_at for cache invalidation and change tracking
ALTER TABLE memory_patterns
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill updated_at from created_at for existing rows
UPDATE memory_patterns
SET updated_at = COALESCE(last_confirmed_at, created_at, now())
WHERE updated_at IS NULL OR updated_at = created_at;

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_memory_patterns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memory_patterns_updated_at ON memory_patterns;
CREATE TRIGGER trg_memory_patterns_updated_at
  BEFORE UPDATE ON memory_patterns
  FOR EACH ROW EXECUTE FUNCTION update_memory_patterns_updated_at();

-- 4. Drop duplicate index (idx_memory_category is identical to idx_memory_patterns_category)
DROP INDEX IF EXISTS idx_memory_category;

-- 5. Composite index for listForPrompt() hot path:
--    WHERE dismissed_at IS NULL AND (applied = true OR confidence = 'Haute')
--    ORDER BY applied DESC, date_discovered DESC
CREATE INDEX IF NOT EXISTS idx_memory_patterns_prompt_lookup
  ON memory_patterns (applied DESC, date_discovered DESC)
  WHERE dismissed_at IS NULL;

-- 6. HNSW index for direct vector search on the table
CREATE INDEX IF NOT EXISTS idx_memory_patterns_embedding
  ON memory_patterns USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
