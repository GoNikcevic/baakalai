-- 068: Provenance des patterns mémoire
--
-- Au moins six agents passent `source: '...'` à replaceOrCreate() :
--   response_analysis_email, response_analysis_linkedin, response_analysis_global,
--   copy_optimizer_linkedin, timing_agent_linkedin, ...
-- Or memory_patterns n'a pas de colonne `source`, et ni create() ni update()
-- ne mappaient ce champ : il était silencieusement jeté à chaque écriture.
--
-- Conséquence : impossible de savoir quel agent a produit quel pattern. Ce qui
-- bloque (a) la purge ciblée des patterns de diagnostic, (b) la curation, et
-- (c) toute mesure de la qualité par agent. Certains chemins contournaient le
-- problème en glissant la source dans data->>'source' (crm_sync, lemlist_sync),
-- d'où une provenance partielle et incohérente selon l'agent.

ALTER TABLE memory_patterns ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN memory_patterns.source IS
  'Agent émetteur du pattern (ex: response_analysis_email, timing_agent_linkedin). '
  'Renseigné par db.memoryPatterns.create/update. Sert à la purge ciblée, à la '
  'curation et au suivi de qualité par agent.';

-- Rattrapage : les patterns existants portent leur source dans data->>'source'
-- pour les chemins crm_sync / lemlist_sync. On la remonte au niveau colonne.
UPDATE memory_patterns
   SET source = data->>'source'
 WHERE source IS NULL
   AND data ? 'source'
   AND nullif(trim(data->>'source'), '') IS NOT NULL;

-- Filtrer par agent est une opération de curation, pas un chemin chaud :
-- un index partiel suffit et reste peu coûteux.
CREATE INDEX IF NOT EXISTS idx_memory_patterns_source
  ON memory_patterns (source) WHERE source IS NOT NULL;
