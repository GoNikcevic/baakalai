-- 121: ce que baakalai a compris du pipeline du user.
--
-- Jusqu'ici le produit manipulait les libellés BRUTS du CRM. `crm_stage` et
-- `crm_stage_id` sont recopiés tels quels sur chaque opportunité (migration
-- 092), Analytics groupe le tunnel sur ces libellés, et la Vue globale Deals
-- affichait une tuile par étape. Résultat sur un Salesforce standard : seize
-- intitulés maison (« Id. Decision Makers », « Analyse de la perception »)
-- que baakalai relaie sans les comprendre, alors que son propre modèle
-- (`opportunities.status`) ne connaît que sept valeurs.
--
-- Cette table est la traduction de l'un vers l'autre, une ligne par étape du
-- CRM du user. Elle est peuplée par lib/crm-stage-mapper.js à chaque analyse
-- CRM : règles déterministes d'abord quand le CRM donne la réponse en dur
-- (IsWon/IsClosed Salesforce, metadata.probability HubSpot, is_won Odoo), un
-- appel Claude ensuite pour les étapes intermédiaires, que rien ne permet de
-- déduire mécaniquement.
--
-- `source` est ce qui rend la table sûre : une ligne 'user' a été corrigée à
-- la main et ne doit JAMAIS être réécrite par une passe automatique. Sans
-- cette distinction, la correction du user serait effacée à la prochaine
-- analyse et il n'aurait aucun moyen de la faire tenir.
--
-- `baakalai_status` n'accepte que les valeurs réellement atteignables depuis
-- une étape de pipeline. 'new' et 'imported' en sont absents à dessein : ils
-- disent d'où vient un contact, pas où il en est.

CREATE TABLE IF NOT EXISTS crm_stage_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crm_provider TEXT NOT NULL,
  -- HubSpot et Pipedrive exposent plusieurs pipelines, et deux d'entre eux
  -- peuvent avoir une étape homonyme. NULL pour Salesforce et Odoo, qui n'en
  -- ont qu'un.
  pipeline_id TEXT,
  pipeline_name TEXT,
  -- Exactement ce que lib/stage-tracking.js écrit dans crm_stage_id, sinon le
  -- rapprochement échoue en silence : identifiant numérique chez Pipedrive et
  -- Odoo, id interne de dealstage chez HubSpot, LIBELLÉ chez Salesforce.
  crm_stage_id TEXT NOT NULL,
  crm_stage_name TEXT NOT NULL,
  stage_order INT,
  baakalai_status TEXT NOT NULL
    CHECK (baakalai_status IN ('interested', 'meeting', 'negotiation', 'won', 'lost')),
  -- rule · le CRM le dit lui-même · ai · déduit par Claude · user · corrigé à la main
  source TEXT NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ai', 'user')),
  -- 1 pour une règle, la confiance du modèle pour une déduction. Sert à
  -- afficher au user ce dont baakalai est sûr et ce qu'il a supposé.
  confidence NUMERIC(3, 2),
  -- Une phrase, montrée dans l'écran de relecture : un mappage qu'on ne peut
  -- pas expliquer, personne ne le corrigera.
  reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Une seule ligne par étape. COALESCE et non `pipeline_id` nu : en SQL, NULL
-- n'est jamais égal à NULL, donc une contrainte directe laisserait passer
-- autant de doublons que d'analyses pour Salesforce et Odoo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_stage_mappings_unique
  ON crm_stage_mappings (user_id, crm_provider, COALESCE(pipeline_id, ''), crm_stage_id);

CREATE INDEX IF NOT EXISTS idx_crm_stage_mappings_user
  ON crm_stage_mappings (user_id, crm_provider);
