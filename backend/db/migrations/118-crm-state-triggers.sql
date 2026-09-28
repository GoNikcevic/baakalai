-- 118: les déclencheurs évalués périodiquement sur l'état du CRM.
--
-- Les onze anciens types de `nurture_triggers` (lead stagnant, contact
-- inactif, client à risque, opportunité upsell...) sont exactement les quatre
-- jobs du produit : réactivation, upsell, churn. Ils vivaient dans un second
-- système d'automatisation, à côté du modèle Déclencheur -> Workflow, ce que
-- le cadrage interdisait explicitement : « ne pas empiler un troisième
-- système, le redesign doit en fusionner, pas en ajouter ». Cette migration
-- ouvre la porte pour les rapatrier.
--
-- Pourquoi une TROISIÈME source d'événement et pas `crm_event` :
--
--   signal     · une ligne apparaît dans `signals`, on réagit à l'insertion
--   crm_event  · quelque chose a bougé, on réagit au changement (stage)
--   crm_state  · une condition est VRAIE depuis un certain temps
--
-- La différence n'est pas cosmétique, elle décide de l'idempotence. Un
-- événement ne se produit qu'une fois ; un état reste vrai tous les jours
-- jusqu'à ce qu'il cesse de l'être. « Ce lead est stagnant depuis 30 jours »
-- sera encore vrai demain, après-demain, et tous les jours suivants. Sans
-- traiter les deux séparément, le même contact serait réinscrit chaque matin.
-- C'est la politique de réinscription du workflow (migration 114) qui l'en
-- empêche, et elle n'a de sens que si on sait qu'on évalue un état.
--
-- À noter : l'évaluation se fait sur les données LOCALES (`opportunities`,
-- déjà synchronisées) et non en rappelant le CRM comme le fait
-- `lib/nurture-engine.evaluateTriggers`. Cet appel live limitait l'ancien
-- système à 4 connecteurs sur 7, exigeait un jeton valide à chaque passage, et
-- tirait 500 contacts par évaluation.

ALTER TABLE automation_triggers DROP CONSTRAINT IF EXISTS automation_triggers_event_source_check;
ALTER TABLE automation_triggers ADD CONSTRAINT automation_triggers_event_source_check
  CHECK (event_source IN ('signal', 'crm_event', 'crm_state', 'email_event'));

COMMENT ON COLUMN automation_triggers.event_source IS
  'signal = insertion dans signals. crm_event = changement observé (stage). '
  'crm_state = condition vraie depuis N jours, évaluée périodiquement sur les '
  'données locales. email_event = réponse ou absence de réponse.';
