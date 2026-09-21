-- 106 · Qualification ICP : poste déclaré + critères déduits du CRM
--
-- Contexte : l'ICP arrêté le 2026-09-02 repose sur 4 critères (poste et taille,
-- historique CRM >= 12 mois, base clients existante, nombre de personnes sur le
-- CRM). Aucun des 4 n'était capté : sur 15 comptes de prod, 2 profils seulement
-- avaient une taille d'équipe, et le poste n'existait nulle part. Impossible
-- donc de savoir si un inscrit est dans la cible, ni de mesurer si la cible est
-- la bonne.
--
-- Le poste se demande : il n'est pas déductible. Les autres critères se
-- déduisent du CRM une fois connecté.
--
-- IMPORTANT · NULL veut dire « inconnu », jamais « zéro ». Deux critères
-- restent NULL tant que les importeurs ne persistent pas la date de création
-- CRM et l'owner du deal (constat du 2026-09-21 : owner_email et crm_owner_id
-- sont vides sur les 443 opportunités de prod, et opportunities.created_at est
-- la date d'insertion chez nous, pas la date CRM). Un score composite calculé
-- sur un seul critère renseigné mentirait : il n'y en a donc pas ici.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS job_role TEXT;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_has_client_base BOOLEAN;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_won_deals_count INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_deals_count INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_crm_history_months INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_crm_seat_count INTEGER;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS icp_computed_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.job_role IS
  'Poste déclaré à l''onboarding (dirigeant, responsable_commercial, commercial, revops, marketing, autre). Seul critère ICP non déductible du CRM.';
COMMENT ON COLUMN user_profiles.icp_crm_history_months IS
  'Ancienneté de l''historique CRM en mois. NULL = inconnu tant que les importeurs ne persistent pas la date de création côté CRM. Jamais 0 par défaut.';
COMMENT ON COLUMN user_profiles.icp_crm_seat_count IS
  'Nombre de personnes distinctes qui portent des deals dans le CRM. NULL = inconnu tant que owner_email / crm_owner_id ne sont pas remplis à l''import. Jamais 0 par défaut.';
COMMENT ON COLUMN user_profiles.icp_computed_at IS
  'Dernier calcul des critères déduits. NULL = jamais calculé, donc aucun CRM connecté ou aucun import.';

-- Le poste sert à segmenter les inscrits (question nav par persona du
-- 2026-09-21) : l'index ne porte que sur les lignes renseignées.
CREATE INDEX IF NOT EXISTS idx_user_profiles_job_role
  ON user_profiles (job_role) WHERE job_role IS NOT NULL;
