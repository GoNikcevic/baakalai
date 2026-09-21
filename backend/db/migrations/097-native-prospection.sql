-- Migration 097: envoi natif des campagnes de prospection (sans Lemlist).
-- Le canal d'envoi devient une propriété de la campagne : 'lemlist' (délégué)
-- ou 'native' (emails via la boîte connectée de l'utilisateur + LinkedIn via
-- le cookie li_at). campaign_sends journalise chaque step envoyé par le moteur
-- natif — c'est lui qui détermine « où en est » chaque prospect dans la
-- séquence (prochain step = premier touchpoint sans ligne sent/skipped).

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_channel TEXT
  CHECK (send_channel IS NULL OR send_channel IN ('lemlist', 'native'));
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS email_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL;

-- Les campagnes déjà liées à Lemlist restent sur leur canal historique.
UPDATE campaigns SET send_channel = 'lemlist' WHERE lemlist_id IS NOT NULL AND send_channel IS NULL;

CREATE TABLE IF NOT EXISTS campaign_sends (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  touchpoint_id UUID NOT NULL REFERENCES touchpoints(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'linkedin_visit', 'linkedin_invite', 'linkedin_message')),
  -- sent/skipped = step consommé, on passe au suivant ; failed = retentera au
  -- prochain passage du moteur (la ligne est mise à jour, pas dupliquée).
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  message_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (opportunity_id, touchpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_user_day ON campaign_sends(user_id, sent_at);

-- Arrêt de séquence par prospect : posé sur réponse détectée, bounce définitif,
-- désinscription ou stop manuel. Un prospect stoppé ne reçoit plus aucun step.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sequence_stopped_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sequence_stop_reason TEXT
  CHECK (sequence_stop_reason IS NULL OR sequence_stop_reason IN ('replied', 'bounced', 'unsubscribed', 'manual'));
