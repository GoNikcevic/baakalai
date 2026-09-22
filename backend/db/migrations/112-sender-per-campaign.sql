-- 112 · Choisir la boîte d'envoi d'une campagne
--
-- Plusieurs boîtes pouvaient être connectées, mais une seule envoyait : tout
-- passait par `getDefaultAccount`, soit `ORDER BY is_default DESC,
-- created_at ASC LIMIT 1`. Or `is_default` valait `true` PAR DÉFAUT en base et
-- n'était jamais écrit : toutes les lignes étaient « par défaut », l'égalité
-- était tranchée par l'ancienneté, et la première boîte connectée envoyait
-- tout, sans moyen d'en changer. `campaigns.email_account_id` existait depuis
-- la migration 097 et n'était lu par personne.
--
-- Deux corrections ici, le choix par campagne se fait côté code.
--
-- 1. `is_default` redevient un vrai drapeau : faux par défaut, un seul vrai par
--    utilisateur (index unique partiel). La reprise désigne la boîte active la
--    plus ancienne, c'est-à-dire exactement celle qui envoyait déjà : personne
--    ne voit son expéditeur changer du jour au lendemain.
--
-- 2. `campaign_sends.email_account_id` trace la boîte qui a réellement envoyé.
--    Sans elle, le plafond anti-ban de 40 emails/jour restait compté par
--    UTILISATEUR : deux boîtes n'auraient pas donné deux budgets, ce qui est
--    l'inverse du besoin (des commerciaux qui répartissent pour ne pas se faire
--    bannir).

ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS email_account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN campaign_sends.email_account_id IS
  'Boite qui a reellement envoye ce message. Sert au plafond journalier par boite (lib/native-sequence-engine). NULL = envoi anterieur a la 112, compte sur la boite par defaut.';

CREATE INDEX IF NOT EXISTS idx_campaign_sends_account_day
  ON campaign_sends (user_id, email_account_id, sent_at)
  WHERE channel = 'email' AND status = 'sent';

ALTER TABLE email_accounts ALTER COLUMN is_default SET DEFAULT false;

-- Reprise : une seule boîte par défaut, la plus ancienne active. C'est celle
-- que `getDefaultAccount` renvoyait déjà par le jeu du tri.
UPDATE email_accounts SET is_default = false WHERE is_default IS NOT false;

UPDATE email_accounts e SET is_default = true
FROM (
  SELECT DISTINCT ON (user_id) id
  FROM email_accounts
  WHERE status = 'active'
  ORDER BY user_id, created_at ASC
) premier
WHERE e.id = premier.id;

-- Un utilisateur ne peut pas avoir deux boîtes par défaut : l'ambiguïté se
-- réglerait sinon au tri, comme avant, et le réglage mentirait.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_one_default
  ON email_accounts (user_id) WHERE is_default;
