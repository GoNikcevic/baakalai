-- 104 · Hidden Revenue Score : opportunités de revenu dormant + snapshots d'agrégats.
--
-- Deux tables, deux durées de vie :
--
--   hidden_revenue_snapshots     : les agrégats (score, montants, confiance).
--                                  Petits, conservés indéfiniment, ils portent
--                                  la courbe d'évolution et la comparaison
--                                  « le score baisse, la réserve se vide ».
--
--   hidden_revenue_opportunities : le détail ligne à ligne du DERNIER snapshot
--                                  seulement. Recalculé à chaque passage de
--                                  l'agent CRM depuis les données vivantes, il
--                                  n'a aucune valeur historique et grossirait
--                                  sans fin s'il était conservé (un CRM de
--                                  1 000 deals produit ~150 lignes par jour).
--                                  Le moteur purge les lignes des snapshots
--                                  précédents à chaque écriture.
--
-- `snapshot_at` est l'horloge gelée du calcul : toutes les ancienneté sont
-- mesurées par rapport à lui, jamais par rapport à now(). C'est ce qui rend le
-- score reproductible (même données + même version = même score).

CREATE TABLE IF NOT EXISTS hidden_revenue_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_version TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,

  hrs INTEGER NOT NULL,                              -- 0 à 100
  confidence INTEGER NOT NULL,                       -- 0 à 100, mesure la fiabilité, pas l'intensité
  qualified_value NUMERIC NOT NULL DEFAULT 0,        -- réserve, avant probabilité
  expected_value NUMERIC NOT NULL DEFAULT 0,         -- réserve × probabilité de récupération
  expected_low NUMERIC NOT NULL DEFAULT 0,           -- fourchette affichée, largeur pilotée par la confiance
  expected_high NUMERIC NOT NULL DEFAULT 0,
  revenue_base NUMERIC NOT NULL DEFAULT 0,           -- pipeline ouvert + gagné sur 12 mois, dénominateur des intensités
  opportunity_count INTEGER NOT NULL DEFAULT 0,

  dimensions JSONB NOT NULL DEFAULT '{}',            -- par dimension : sous-score, intensité, qualifié, attendu, volume
  confidence_factors JSONB NOT NULL DEFAULT '[]',    -- couvertures mesurées et leur poids
  context JSONB NOT NULL DEFAULT '{}',               -- taux de conversion, cycle, seuil de dormance, concentration

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hidden_revenue_snapshots_user
  ON hidden_revenue_snapshots (user_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS hidden_revenue_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES hidden_revenue_snapshots(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,

  -- Clé de dédup : société normalisée, à défaut email, à défaut nom. Un même
  -- compte ne peut peser qu'une fois par dimension.
  account_key TEXT,

  dimension TEXT NOT NULL,
  original_value NUMERIC,                            -- le montant tel que le CRM le porte (NULL si vide)
  qualified_value NUMERIC,                           -- après estimation et filtres
  value_estimated BOOLEAN NOT NULL DEFAULT false,    -- true = médiane des gagnés, le CRM ne portait rien
  recovery_probability NUMERIC,
  expected_value NUMERIC,
  priority INTEGER,

  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  factors JSONB NOT NULL DEFAULT '[]',               -- multiplicateurs appliqués, avec leur justification
  recommended_action TEXT,                           -- clé stable, le libellé est construit côté front (i18n)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hidden_revenue_opps_snapshot
  ON hidden_revenue_opportunities (snapshot_id, expected_value DESC);

CREATE INDEX IF NOT EXISTS idx_hidden_revenue_opps_user_dimension
  ON hidden_revenue_opportunities (user_id, dimension, expected_value DESC);
