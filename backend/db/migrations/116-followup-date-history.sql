-- 116 — Historique des changements de date de relance planifiée
--
-- opportunities.planned_followup_date est écrasé à chaque changement (Reporter
-- manuel, réponse email analysée, sync CRM) : aucune trace de l'ancienne valeur
-- n'était conservée. Cette table capture chaque changement (old → new) avec sa
-- source, pour que l'onglet Historique de « Deals à relancer » puisse afficher
-- "reporté de telle date à telle date, fait automatiquement/manuellement".
--
-- source :
--   'manual'     — action "Reporter" de l'utilisateur dans Baakalai
--   'auto_email' — réponse email analysée par l'IA (sentiment négatif, "pas
--                  maintenant", ou date explicitement demandée par le contact)
--   'crm_sync'   — date de prochaine activité lue depuis le CRM (Pipedrive,
--                  HubSpot, ...), le commercial l'a changée directement là-bas

CREATE TABLE IF NOT EXISTS followup_date_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  old_date TIMESTAMPTZ,
  new_date TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto_email', 'crm_sync')),
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_date_history_opp ON followup_date_history(opportunity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_followup_date_history_user ON followup_date_history(user_id, changed_at DESC);
