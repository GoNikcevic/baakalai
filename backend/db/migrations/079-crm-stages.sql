-- 079 — Rapatriement des étapes de pipeline depuis le CRM.
--
-- POURQUOI : jusqu'ici baakalai ne connaissait d'un deal que trois états
-- (open / won / lost). L'étape réelle du pipeline était bien lue par les
-- connecteurs, mais jamais stockée : pipedrive.getDeals renvoyait `stage_id`
-- (un entier nu, « Stage 5 »), crm-sync l'envoyait tel quel à Claude, et
-- ClientsPage comptait `c.crm_stage` — une colonne qui n'a jamais existé, donc
-- une barre de pipeline affichée en permanence à 0.
--
-- Conséquence produit : impossible de distinguer un deal bloqué en découverte
-- d'un deal bloqué en négociation à 30k€. C'est pourtant la même stagnation
-- côté signal, et pas du tout la même priorité côté relance.
--
-- On stocke donc le référentiel d'étapes du client (crm_stages) ET la position
-- de chaque deal dedans (colonnes crm_stage_* sur opportunities). Le nom est
-- dupliqué sur l'opportunité volontairement : il permet d'afficher et de
-- prompter sans jointure, et il garde une trace lisible si le client supprime
-- l'étape de son CRM.

CREATE TABLE IF NOT EXISTS crm_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crm_provider TEXT NOT NULL,
  -- Identifiants côté CRM, en TEXT : Pipedrive et Odoo numérotent, HubSpot et
  -- Salesforce utilisent des chaînes. TEXT est le seul type qui les accepte tous.
  pipeline_id TEXT,
  pipeline_name TEXT,
  stage_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  -- Rang dans le pipeline : c'est lui qui permet de dire « avancé » ou « early ».
  display_order INTEGER NOT NULL DEFAULT 0,
  is_won BOOLEAN NOT NULL DEFAULT false,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Une étape est identifiée par (client, CRM, id d'étape) : c'est la clé
  -- d'upsert de chaque resynchronisation.
  UNIQUE (user_id, crm_provider, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_stages_user_provider
  ON crm_stages (user_id, crm_provider, display_order);

-- Position du deal dans le pipeline du client.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage_id TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage_name TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_pipeline_id TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_pipeline_name TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_stage_order INTEGER;
-- Date d'entrée dans l'étape courante. Comme won_date/lost_date, c'est une date
-- de DÉTECTION (la synchro tourne une fois par jour), pas la date CRM réelle :
-- on ne l'écrit qu'au changement d'étape, jamais à chaque passage.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_opportunities_stage
  ON opportunities (user_id, crm_stage_id);

COMMENT ON TABLE crm_stages IS
  'Référentiel des étapes de pipeline importées du CRM du client. '
  'Écrit par lib/crm-stage-resolver.js (syncStages), lu par GET /api/crm/stages.';
COMMENT ON COLUMN opportunities.crm_stage_order IS
  'Rang de l''étape dans son pipeline, recopié depuis crm_stages pour permettre '
  'un tri « avancement » sans jointure.';
