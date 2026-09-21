-- Tracks WHY planned_followup_date was last set, so the "Deals à relancer" /
-- "Clients à upseller" history tab can distinguish a manual "Reporter" click from an
-- automatic postponement (negative sentiment, "not now" reply, CRM native sync, or the
-- post-send cooldown).
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS planned_followup_reason TEXT;
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_followup_reason_check;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_followup_reason_check
  CHECK (planned_followup_reason IS NULL OR planned_followup_reason IN (
    'manual', 'not_now', 'negative_sentiment', 'crm_sync', 'post_send_cooldown'
  ));
