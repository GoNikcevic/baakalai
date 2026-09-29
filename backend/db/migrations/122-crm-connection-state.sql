-- Migration 122 · État de santé d'une connexion CRM
--
-- Jusqu'ici « connecté » voulait dire « il existe une ligne dans
-- user_integrations dont l'access_token se déchiffre ». C'est une vérification
-- purement locale : aucun appel n'est fait au CRM. Un refresh token révoqué ou
-- expiré laissait donc la carte des Réglages au vert pendant que toutes les
-- synchros échouaient.
--
-- Constaté le 2026-09-29 sur la production : la connexion Salesforce était
-- morte depuis le 24/09 (Salesforce répondant « invalid_grant · expired
-- access/refresh token ») et l'écran affichait toujours « ✓ Connecté ».
--
-- On stocke donc le seul signal qui ne mente pas : le refus du CRM lui-même.

ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS invalid_since TIMESTAMPTZ;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS invalid_reason TEXT;
ALTER TABLE user_integrations ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

-- Une seule raison est retenue pour l'instant, et c'est volontaire : on ne
-- marque une connexion invalide QUE lorsque le CRM refuse lui-même le refresh
-- token. Une clé applicative manquante côté serveur ou un refresh token absent
-- sont nos problèmes, pas ceux de l'utilisateur : lui demander de reconnecter
-- ne réparerait rien et userait sa confiance dans l'alerte.
ALTER TABLE user_integrations DROP CONSTRAINT IF EXISTS user_integrations_invalid_reason_check;
ALTER TABLE user_integrations ADD CONSTRAINT user_integrations_invalid_reason_check
  CHECK (invalid_reason IS NULL OR invalid_reason IN ('refresh_rejected'));

CREATE INDEX IF NOT EXISTS idx_user_integrations_invalid
  ON user_integrations (user_id) WHERE invalid_since IS NOT NULL;

COMMENT ON COLUMN user_integrations.invalid_since IS
  'Date du premier refus du CRM sur le rafraîchissement du token. NULL = connexion saine, ou jamais mise à l''épreuve. Posée par lib/crm-connection-state.markInvalid, effacée dès qu''un échange de token réussit.';
COMMENT ON COLUMN user_integrations.invalid_reason IS
  'Pourquoi la connexion est réputée morte. Seule valeur actuelle : refresh_rejected, le CRM a refusé le refresh token, seul un nouvel OAuth répare.';
COMMENT ON COLUMN user_integrations.last_verified_at IS
  'Dernière fois que le CRM a effectivement honoré un échange de token. A ne pas confondre avec updated_at, qui bouge aussi sur une simple réécriture de métadonnées.';
