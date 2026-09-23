-- 115: conditions d'entrée sur un déclencheur.
--
-- Pour les signaux, la condition est facultative : « un signal Recrutement
-- apparaît » veut déjà dire quelque chose. Pour un événement CRM, elle est
-- CONSTITUTIVE. « Le deal change de stage » sans stage cible inscrirait un
-- contact à chaque mouvement de pipeline, dans les deux sens, y compris quand
-- un commercial corrige une erreur de saisie. Personne ne veut de ça, et le
-- disjoncteur de la migration 114 se contenterait d'éteindre l'incendie après
-- coup.
--
-- La condition reste volontairement pauvre : un tableau de stages cibles, lus
-- sur les libellés rapatriés localement (`opportunities.crm_stage`, migration
-- 092). Les identifiants de stage diffèrent d'un connecteur à l'autre alors
-- que le libellé est ce que l'utilisateur voit et choisit.
--
--   { "toStages": ["Gagné", "Négociation"] }
--
-- Le constructeur de conditions général (filtrer sur les faits d'un signal,
-- sur un montant, sur un secteur) reste un chantier à part : le goulot du
-- produit n'est pas le filtrage, c'est que rien n'est encore automatisé.

ALTER TABLE automation_triggers ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN automation_triggers.conditions IS
  'Conditions d''entrée, évaluées une seule fois à l''inscription. '
  'deal_stage_changed : { "toStages": ["Gagné"] }, obligatoire, sinon le '
  'déclencheur inscrirait un contact à chaque mouvement de pipeline.';

-- L'index unique de la 114 interdisait un seul déclencheur par (compte,
-- source, clé). C'était juste pour les signaux, où la clé EST le type. Pour un
-- événement CRM, deux déclencheurs sur « le deal change de stage » avec des
-- stages cibles différents sont deux automatisations légitimes : « passé à
-- Gagné, demander un avis » et « passé à Négociation, envoyer la plaquette ».
-- L'unicité descend donc au niveau de la condition.
DROP INDEX IF EXISTS idx_automation_triggers_one_per_event;
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_triggers_one_per_event
  ON automation_triggers(user_id, event_source, event_key, conditions)
  WHERE status <> 'draft';
