/**
 * Vector Store — pgvector-powered semantic search for memory patterns.
 *
 * Feature-flagged: only active when PGVECTOR_ENABLED=true.
 * Falls back gracefully to no-op when disabled.
 */

const db = require('../db');
const logger = require('./logger');

const ENABLED = process.env.PGVECTOR_ENABLED === 'true';

/**
 * Store an embedding for a piece of content.
 */
async function storeEmbedding(userId, sourceType, content, metadata = {}, sourceId = null) {
  if (!ENABLED) return null;

  const embedding = await generateEmbedding(content);
  if (!embedding) return null;

  try {
    const result = await db.query(
      `INSERT INTO memory_embeddings (user_id, source_type, source_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, sourceType, sourceId, content.slice(0, 5000), JSON.stringify(embedding), JSON.stringify(metadata)]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    logger.warn('vector-store', `storeEmbedding failed: ${err.message}`);
    return null;
  }
}

/**
 * Search for similar content using vector cosine similarity.
 */
async function searchSimilar(userId, query, limit = 5, sourceType = null) {
  if (!ENABLED) return [];

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  try {
    const typeFilter = sourceType ? 'AND source_type = $4' : '';
    const params = [JSON.stringify(queryEmbedding), userId, limit];
    if (sourceType) params.push(sourceType);

    const result = await db.query(
      `SELECT id, content, metadata, source_type, source_id,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_embeddings
       WHERE user_id = $2 ${typeFilter}
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      params
    );

    return result.rows.map(r => ({
      id: r.id,
      content: r.content,
      similarity: parseFloat(r.similarity),
      metadata: r.metadata,
      sourceType: r.source_type,
      sourceId: r.source_id,
    }));
  } catch (err) {
    logger.warn('vector-store', `searchSimilar failed: ${err.message}`);
    return [];
  }
}

/**
 * Find a semantically similar pattern (for deduplication).
 * Returns the source_id of the most similar existing pattern above threshold.
 * Uses direct embedding on memory_patterns first (no JOIN), falls back to memory_embeddings.
 */
async function findSimilarPattern(text, threshold = 0.85) {
  if (!ENABLED) return null;

  const embedding = await generateEmbedding(text);
  if (!embedding) return null;

  try {
    // Direct search on memory_patterns.embedding (HNSW index, no JOIN)
    const direct = await db.query(
      `SELECT id, pattern, 1 - (embedding <=> $1::vector) AS similarity
       FROM memory_patterns
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [JSON.stringify(embedding)]
    );

    const match = direct.rows[0];
    if (match && parseFloat(match.similarity) >= threshold) {
      return { sourceId: match.id, similarity: parseFloat(match.similarity), content: match.pattern };
    }

    // Fallback to memory_embeddings for patterns not yet backfilled
    const fallback = await db.query(
      `SELECT source_id, content, 1 - (embedding <=> $1::vector) AS similarity
       FROM memory_embeddings
       WHERE source_type = 'pattern'
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [JSON.stringify(embedding)]
    );

    const fbMatch = fallback.rows[0];
    if (fbMatch && parseFloat(fbMatch.similarity) >= threshold) {
      return { sourceId: fbMatch.source_id, similarity: parseFloat(fbMatch.similarity), content: fbMatch.content };
    }
    return null;
  } catch (err) {
    logger.warn('vector-store', `findSimilarPattern failed: ${err.message}`);
    return null;
  }
}

/**
 * Store or update the embedding for a pattern.
 * Writes to BOTH memory_patterns.embedding (direct, fast) and memory_embeddings (legacy).
 */
async function upsertPatternEmbedding(patternId, text, metadata = {}) {
  if (!ENABLED) return null;

  const embedding = await generateEmbedding(text);
  if (!embedding) return null;

  try {
    const embeddingJson = JSON.stringify(embedding);

    // Write directly on memory_patterns (primary — no JOIN needed for queries)
    await db.query(
      'UPDATE memory_patterns SET embedding = $1::vector WHERE id = $2',
      [embeddingJson, patternId]
    );

    // Also write to memory_embeddings (legacy — other source_types still use it)
    await db.query('DELETE FROM memory_embeddings WHERE source_type = $1 AND source_id = $2', ['pattern', patternId]);
    const result = await db.query(
      `INSERT INTO memory_embeddings (user_id, source_type, source_id, content, embedding, metadata)
       VALUES (NULL, 'pattern', $1, $2, $3, $4) RETURNING id`,
      [patternId, text.slice(0, 5000), embeddingJson, JSON.stringify(metadata)]
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    logger.warn('vector-store', `upsertPatternEmbedding failed: ${err.message}`);
    return null;
  }
}

/**
 * Find the most relevant patterns for a given context (sector, target, etc.).
 * Used for contextual pattern injection in email generation.
 * Direct search on memory_patterns.embedding (no JOIN), falls back to memory_embeddings.
 */
async function findRelevantPatterns(contextText, limit = 10) {
  if (!ENABLED) return [];

  const embedding = await generateEmbedding(contextText);
  if (!embedding) return [];

  try {
    // Direct search on memory_patterns.embedding — faster, no JOIN
    const result = await db.query(
      `SELECT id, pattern, category, confidence, confidence_score, applied, confirmations,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_patterns
       WHERE embedding IS NOT NULL AND dismissed_at IS NULL
       ORDER BY applied DESC, embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(embedding), limit]
    );

    if (result.rows.length > 0) return result.rows;

    // Fallback to memory_embeddings JOIN for patterns not yet backfilled
    const fallback = await db.query(
      `SELECT me.source_id, me.content, me.metadata, 1 - (me.embedding <=> $1::vector) AS similarity,
              mp.id, mp.pattern, mp.category, mp.confidence, mp.confidence_score, mp.applied, mp.confirmations
       FROM memory_embeddings me
       JOIN memory_patterns mp ON mp.id = me.source_id
       WHERE me.source_type = 'pattern' AND mp.dismissed_at IS NULL
       ORDER BY mp.applied DESC, me.embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(embedding), limit]
    );

    return fallback.rows;
  } catch (err) {
    logger.warn('vector-store', `findRelevantPatterns failed: ${err.message}`);
    return [];
  }
}

/**
 * Delete embeddings by source.
 */
async function deleteBySource(sourceType, sourceId) {
  if (!ENABLED) return;
  try {
    await db.query(
      'DELETE FROM memory_embeddings WHERE source_type = $1 AND source_id = $2',
      [sourceType, sourceId]
    );
  } catch (err) {
    logger.warn('vector-store', `deleteBySource failed: ${err.message}`);
  }
}

/**
 * Generate an embedding vector from text via Voyage AI.
 *
 * Model: voyage-3 (1024 dimensions, $0.06/1M tokens)
 * Recommended by Anthropic for Claude-based projects.
 * API docs: https://docs.voyageai.com/reference/embeddings-api
 */
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = 'voyage-3';

async function generateEmbedding(text) {
  if (!VOYAGE_API_KEY) {
    logger.warn('vector-store', 'VOYAGE_API_KEY not set — skipping embedding');
    return null;
  }

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [text.slice(0, 8000)], // Voyage AI max ~32k tokens but truncate for safety
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('vector-store', `Voyage AI ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!embedding || !Array.isArray(embedding)) {
      logger.warn('vector-store', 'Voyage AI returned no embedding');
      return null;
    }

    return embedding;
  } catch (err) {
    logger.warn('vector-store', `Voyage AI error: ${err.message}`);
    return null;
  }
}

module.exports = { storeEmbedding, searchSimilar, deleteBySource, generateEmbedding, findSimilarPattern, upsertPatternEmbedding, findRelevantPatterns, ENABLED };
