-- 092 — Rapatriement des étapes de pipeline CRM (stage tracking)
--
-- Jusqu'ici seul le statut grossier (open/won/lost) était persisté : impossible
-- de savoir OÙ les deals meurent dans le pipeline. On persiste maintenant
-- l'étape CRM réelle (libellé + id natif) et chaque transition observée.
-- Les étapes sont mappées par ID natif, jamais par libellé : l'utilisateur
-- renomme/supprime ses étapes dans son CRM quand il veut.
-- L'historique ne démarre qu'à l'installation (aucun CRM ne nous donne le
-- passé, sauf HubSpot — backfill possible plus tard via property history).

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage TEXT;            -- libellé lisible ("Proposition")
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage_id TEXT;         -- id natif du CRM (stable au renommage)
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage TEXT,                     -- NULL = première observation
  from_stage_id TEXT,
  to_stage TEXT NOT NULL,
  to_stage_id TEXT,
  deal_status TEXT,                    -- open/won/lost au moment de la transition
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'delta_sync'  -- delta_sync | webhook
);

CREATE INDEX IF NOT EXISTS idx_stage_history_user ON opportunity_stage_history(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_history_opp ON opportunity_stage_history(opportunity_id, changed_at DESC);

ALTER TABLE opportunity_stage_history ENABLE ROW LEVEL SECURITY;
