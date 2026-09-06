/**
 * Vector Store — recherche sémantique pgvector sur les patterns mémoire.
 *
 * Feature-flag : actif uniquement si PGVECTOR_ENABLED=true. Sinon, no-op.
 *
 * Source de vérité unique : `memory_patterns.embedding` (vector(1024), index HNSW).
 * La table `memory_embeddings` — jumelle historique en ivfflat, restée vide en
 * production — a été supprimée (migration 065). Elle dupliquait chaque écriture
 * et ses chemins de fallback ne pouvaient jamais rien renvoyer.
 */

const db = require('../db');
const logger = require('./logger');

const ENABLED = process.env.PGVECTOR_ENABLED === 'true';

/**
 * Cache d'embeddings en mémoire, borné.
 *
 * Voyage est facturé à l'appel et ne propose pas de batching ici : embedder deux
 * fois le même texte est du gaspillage pur. Le cache est volontairement simple
 * (Map + éviction FIFO) — il couvre le cas dominant, à savoir le même texte
 * embedé plusieurs fois dans un même cycle d'agent.
 */
const EMBED_CACHE_MAX = 500;
const embedCache = new Map();

function cacheGet(text) {
  const hit = embedCache.get(text);
  if (hit) {
    // Rafraîchit la position (LRU approximatif)
    embedCache.delete(text);
    embedCache.set(text, hit);
  }
  return hit || null;
}

function cacheSet(text, embedding) {
  if (embedCache.size >= EMBED_CACHE_MAX) {
    embedCache.delete(embedCache.keys().next().value);
  }
  embedCache.set(text, embedding);
}

/**
 * Recherche sémantique sur les patterns.
 *
 * La mémoire est un pool mutualisé entre clients (décision produit) : la
 * recherche porte donc sur l'ensemble des patterns non dismissés. `userId` est
 * conservé dans la signature pour la compatibilité des appelants mais n'est pas
 * utilisé comme filtre.
 */
async function searchSimilar(_userId, query, limit = 5) {
  if (!ENABLED) return [];

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) return [];

  try {
    const result = await db.query(
      `SELECT id, pattern, category, confidence, data,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_patterns
       WHERE embedding IS NOT NULL AND dismissed_at IS NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(queryEmbedding), limit]
    );

    return result.rows.map(r => ({
      id: r.id,
      content: r.pattern,
      similarity: parseFloat(r.similarity),
      metadata: r.data,
      sourceType: 'pattern',
      sourceId: r.id,
    }));
  } catch (err) {
    logger.warn('vector-store', `searchSimilar failed: ${err.message}`);
    return [];
  }
}

/**
 * Cherche un pattern sémantiquement proche (déduplication).
 *
 * Retourne aussi l'embedding calculé (`embedding`) pour que l'appelant puisse le
 * réutiliser lors de l'écriture, au lieu de le recalculer — c'était un doublon
 * de facturation Voyage sur chaque création de pattern.
 */
async function findSimilarPattern(text, threshold = 0.85) {
  if (!ENABLED) return null;

  const embedding = await generateEmbedding(text);
  if (!embedding) return null;

  try {
    const direct = await db.query(
      `SELECT id, pattern, 1 - (embedding <=> $1::vector) AS similarity
       FROM memory_patterns
       WHERE embedding IS NOT NULL AND dismissed_at IS NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [JSON.stringify(embedding)]
    );

    const match = direct.rows[0];
    if (match && parseFloat(match.similarity) >= threshold) {
      return {
        sourceId: match.id,
        similarity: parseFloat(match.similarity),
        content: match.pattern,
        embedding,
      };
    }
    // Pas de correspondance : on renvoie quand même l'embedding, il servira à
    // l'écriture du nouveau pattern.
    return { sourceId: null, similarity: null, content: null, embedding };
  } catch (err) {
    logger.warn('vector-store', `findSimilarPattern failed: ${err.message}`);
    return null;
  }
}

/**
 * Écrit (ou met à jour) l'embedding d'un pattern.
 * @param {string} patternId
 * @param {string} text
 * @param {object} [_metadata] — conservé pour compatibilité, non stocké
 * @param {number[]} [precomputed] — embedding déjà calculé, pour éviter un
 *   second appel Voyage sur le même texte.
 */
async function upsertPatternEmbedding(patternId, text, _metadata = {}, precomputed = null) {
  if (!ENABLED) return null;

  const embedding = precomputed || await generateEmbedding(text);
  if (!embedding) return null;

  try {
    await db.query(
      'UPDATE memory_patterns SET embedding = $1::vector WHERE id = $2',
      [JSON.stringify(embedding), patternId]
    );
    return patternId;
  } catch (err) {
    logger.warn('vector-store', `upsertPatternEmbedding failed: ${err.message}`);
    return null;
  }
}

/**
 * Patterns les plus pertinents pour un contexte donné (secteur, cible…).
 * Utilisé pour l'injection contextuelle à la génération d'email.
 *
 * Corrections audit 02/09 :
 * - le tri commençait par `applied DESC`, qui passait DEVANT la distance
 *   vectorielle — tout pattern épinglé écrasait le classement sémantique.
 *   `applied` reste un bonus (+0.10 de similarité), plus un tri prioritaire ;
 * - seuil de similarité 0.60 : en dessous, injecter du bruit est pire que rien ;
 * - filtre tenant : ce chemin (le nominal quand pgvector est actif) contournait
 *   la porte `shared` — il lisait la table entière, tous tenants confondus.
 */
async function findRelevantPatterns(contextText, limit = 10, { teamId = null, userId = null } = {}) {
  if (!ENABLED) return [];

  const embedding = await generateEmbedding(contextText);
  if (!embedding) return [];

  let tenantFilter = `AND shared = true AND confidence = 'Haute'`;
  const params = [JSON.stringify(embedding), limit];
  if (teamId) {
    tenantFilter = `AND (team_id = $3 OR (shared = true AND confidence = 'Haute'))`;
    params.push(teamId);
  } else if (userId) {
    tenantFilter = `AND (user_id = $3 OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $3) OR (shared = true AND confidence = 'Haute'))`;
    params.push(userId);
  }

  try {
    const result = await db.query(
      `SELECT id, pattern, category, confidence, confidence_score, applied, confirmations,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_patterns
       WHERE embedding IS NOT NULL AND dismissed_at IS NULL
         AND 1 - (embedding <=> $1::vector) >= 0.60
         ${tenantFilter}
       ORDER BY (1 - (embedding <=> $1::vector)) + (CASE WHEN applied THEN 0.10 ELSE 0 END) DESC
       LIMIT $2`,
      params
    );
    return result.rows;
  } catch (err) {
    logger.warn('vector-store', `findRelevantPatterns failed: ${err.message}`);
    return [];
  }
}

/**
 * Efface l'embedding d'un pattern (appelé à la suppression / au pruning).
 * `sourceType` est conservé pour la compatibilité des appelants.
 */
async function deleteBySource(_sourceType, sourceId) {
  if (!ENABLED) return;
  try {
    await db.query('UPDATE memory_patterns SET embedding = NULL WHERE id = $1', [sourceId]);
  } catch (err) {
    logger.warn('vector-store', `deleteBySource failed: ${err.message}`);
  }
}

/**
 * Génère un vecteur depuis du texte via Voyage AI.
 *
 * Modèle : voyage-3 (1024 dimensions, 0,06 $/1M tokens).
 * API : https://docs.voyageai.com/reference/embeddings-api
 */
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = 'voyage-3';

async function generateEmbedding(text) {
  if (!VOYAGE_API_KEY) {
    logger.warn('vector-store', 'VOYAGE_API_KEY not set — skipping embedding');
    return null;
  }

  const key = text.slice(0, 8000);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: [key] }),
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

    cacheSet(key, embedding);
    return embedding;
  } catch (err) {
    logger.warn('vector-store', `Voyage AI error: ${err.message}`);
    return null;
  }
}

module.exports = {
  searchSimilar,
  deleteBySource,
  generateEmbedding,
  findSimilarPattern,
  upsertPatternEmbedding,
  findRelevantPatterns,
  ENABLED,
};
