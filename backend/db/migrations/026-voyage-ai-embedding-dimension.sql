-- Switch embedding dimension from 1536 (OpenAI) to 1024 (Voyage AI voyage-3)
-- Safe to run: no real embeddings stored yet (sandbox phase)
DROP INDEX IF EXISTS idx_memory_embeddings_vector;
ALTER TABLE memory_embeddings DROP COLUMN IF EXISTS embedding;
ALTER TABLE memory_embeddings ADD COLUMN embedding vector(1024);
CREATE INDEX idx_memory_embeddings_vector ON memory_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
