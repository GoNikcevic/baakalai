-- 117 — Ajoute 'reply_requested_date' aux raisons autorisées pour
-- opportunities.planned_followup_reason.
--
-- lib/response-analysis-agent.js extrait désormais une date explicitement
-- demandée par le contact dans sa réponse ("rappelez-moi en mars") au lieu
-- du repli générique +90j — cette raison n'existait pas dans la contrainte
-- posée avec les valeurs manual/not_now/negative_sentiment/crm_sync/
-- post_send_cooldown.

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_followup_reason_check;

ALTER TABLE opportunities ADD CONSTRAINT opportunities_followup_reason_check
  CHECK (planned_followup_reason IS NULL OR planned_followup_reason = ANY (ARRAY[
    'manual', 'not_now', 'negative_sentiment', 'crm_sync', 'post_send_cooldown', 'reply_requested_date'
  ]::text[]));
