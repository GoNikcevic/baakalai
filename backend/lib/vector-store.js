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

module.exports = { storeEmbedding, searchSimilar, deleteBySource, generateEmbedding, ENABLED };
