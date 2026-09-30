-- 130 : dire à la main qui, dans l'équipe, est cet owner du CRM.
--
-- Jusqu'ici le rattachement d'un owner CRM à un membre de l'équipe se faisait
-- UNIQUEMENT par égalité d'adresse email (`lib/crm-owner-resolver.js`,
-- buildOwnerMap). Ça marche tant que les deux mondes emploient la même
-- adresse, et ça échoue en silence dès qu'ils divergent : un commercial
-- inscrit sur baakalai avec son adresse personnelle, une boîte qui a changé
-- de domaine, un CRM où les utilisateurs portent une adresse de service.
-- L'affaire reste alors sans propriétaire côté baakalai, donc absente des
-- vues par commercial, du comptage de sièges et des relances nominatives.
--
-- Le contrôle « owner non rattaché » de Qualité des deals compte ces lignes.
-- Mais il les compte UNE PAR AFFAIRE, alors que la décision, elle, se prend
-- une fois par owner : quelques personnes pour des dizaines d'affaires. Cette
-- table stocke cette décision-là, prise une fois, et non une correction
-- répétée affaire par affaire.
--
-- La correspondance manuelle l'emporte sur la correspondance par email : si
-- l'utilisateur a pris la peine de désigner quelqu'un, aucune heuristique
-- d'adresse n'a de raison de le contredire.
--
-- `crm_owner_id` est du TEXT parce que chaque CRM numérote ses utilisateurs à
-- sa façon (entier chez Pipedrive, chaîne de 18 caractères chez Salesforce),
-- exactement comme `opportunities.crm_owner_id` qu'elle sert à traduire.

CREATE TABLE IF NOT EXISTS crm_owner_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'pipedrive', 'hubspot', 'salesforce', 'odoo'... Deux CRM peuvent employer
  -- le même identifiant d'utilisateur sans désigner la même personne.
  provider     TEXT NOT NULL,

  -- Identifiant de l'utilisateur CÔTÉ CRM, tel qu'il est écrit dans
  -- opportunities.crm_owner_id.
  crm_owner_id TEXT NOT NULL,

  -- Le membre de l'équipe derrière cet identifiant. ON DELETE CASCADE : si la
  -- personne quitte l'équipe, la correspondance n'a plus de sens et doit être
  -- refaite plutôt que de pointer dans le vide.
  team_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider, crm_owner_id)
);

-- buildOwnerMap lit toutes les correspondances d'un provider en une fois, à
-- chaque synchronisation. C'est le seul accès chaud.
CREATE INDEX IF NOT EXISTS idx_crm_owner_mappings_user_provider
  ON crm_owner_mappings (user_id, provider);
