-- 101 — Préférences d'emails système (RGPD art. 21 / ePrivacy : droit
-- d'opposition simple et effectif aux emails non transactionnels).
--
-- 3 catégories, exposées dans Paramètres > Notifications et désinscriptibles
-- en un clic depuis chaque email (List-Unsubscribe, RFC 8058) :
--   email_crm_digest    → digest CRM du lundi (orchestrator/jobs/crm-digest.js)
--   email_weekly_report → rapport hebdo & tendances (orchestrator/jobs/weekly-report.js)
--   email_tips          → conseils & découverte : onboarding + rétention (lib/lifecycle-emails.js)
--
-- Les transactionnels (vérification d'email, reset mot de passe) ne sont pas
-- concernés : nécessaires au service, pas de base d'opposition.
--
-- L'ancien interrupteur unique weekly_report (migration 024) couvrait digest +
-- rapport : un opt-out existant est reporté sur les deux nouvelles colonnes.
-- La colonne weekly_report est conservée (compat lecture) mais plus écrite.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_crm_digest BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_weekly_report BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_tips BOOLEAN NOT NULL DEFAULT true;

UPDATE user_profiles
SET email_crm_digest = false, email_weekly_report = false
WHERE weekly_report = false;

COMMENT ON COLUMN user_profiles.email_crm_digest IS 'Opt-out digest CRM hebdo (true = recevoir)';
COMMENT ON COLUMN user_profiles.email_weekly_report IS 'Opt-out rapport hebdo & tendances (true = recevoir)';
COMMENT ON COLUMN user_profiles.email_tips IS 'Opt-out conseils/onboarding/rétention (true = recevoir)';
