-- 111 · Lecture de la boîte Outlook (détection des réponses)
--
-- L'envoi Microsoft fonctionne depuis toujours, mais la détection des réponses
-- était réservée à Gmail : sur Outlook, une séquence continuait de tourner
-- alors que le prospect avait répondu, l'autopilot ne se déclenchait jamais et
-- aucune alerte ne partait. Un connecteur proposé en un clic, à moitié branché.
--
-- Pourquoi une seconde autorisation, et pas simplement un scope de plus sur la
-- connexion existante : l'envoi utilise `outlook.office365.com/SMTP.Send` et la
-- lecture demande `graph.microsoft.com/Mail.Read`. Azure AD délivre un jeton
-- pour UNE ressource à la fois. Ajouter la lecture à la demande existante
-- exposerait la connexion Outlook, qui marche, au risque d'un refus côté Azure.
-- On garde donc l'envoi intact et on ajoute un consentement séparé, réclamé
-- seulement quand l'utilisateur veut la détection des réponses. Le jeton de
-- rafraîchissement obtenu là est propre à Graph, d'où ces colonnes.
--
-- Les trois colonnes sont chiffrées comme les autres secrets (config/crypto.js).

ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS graph_refresh_token TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS graph_access_token TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS graph_token_expiry TIMESTAMPTZ;

COMMENT ON COLUMN email_accounts.graph_refresh_token IS
  'Jeton de rafraichissement Microsoft Graph (Mail.Read), chiffre. NULL = lecture des reponses non autorisee sur ce compte.';
COMMENT ON COLUMN email_accounts.graph_access_token IS
  'Dernier jeton d acces Graph, chiffre. Cache court, reconstruit a partir du refresh token.';
COMMENT ON COLUMN email_accounts.graph_token_expiry IS
  'Expiration du jeton d acces Graph. Rafraichi 5 minutes avant, comme le jeton d envoi.';
