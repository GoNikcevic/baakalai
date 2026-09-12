-- 098 — Suivi upsell (date d'ajout de ligne produit) + historique du score de churn
--
-- opportunity_product_lines.added_at : NULL pour les lignes existantes (date
-- réelle inconnue, on ne l'invente pas), renseigné à now() pour toute nouvelle
-- assignation (routes/crm.js POST /product-lines/:id/assign) — permet de savoir
-- si une ligne a été ajoutée APRÈS un email d'upsell envoyé par baakalai
-- (corrélation temporelle, cf. GET /api/analytics/upsell-performance).
--
-- churn_score_history : opportunities.churn_score est écrasé à chaque calcul
-- (lib/churn-scoring.js), aucun historique n'existait. Cette table capture un
-- snapshot à chaque exécution du scoring, pour comparer "était à risque il y a
-- 30/60/90j" au statut actuel (sauvé / perdu / toujours à risque). Vide au
-- démarrage : l'indicateur "sauvés vs perdus" ne sera exploitable qu'après
-- quelques semaines d'accumulation.

ALTER TABLE opportunity_product_lines ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS churn_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  factors JSONB,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_score_history_opp ON churn_score_history(opportunity_id, scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_churn_score_history_user ON churn_score_history(user_id, scored_at DESC);
