-- 114: Déclencheur -> Workflow.
--
-- L'objet « workflow » n'existait pas en base. `nurture_triggers.sequence_id`
-- est mort depuis toujours (aucun écrivain, aucun lecteur) et n'est pas
-- réutilisé ici : il pointait vers un objet « sequence » qui n'a jamais été
-- créé. On pose les trois pièces manquantes.
--
--   workflows            le modèle réutilisable, une liste ORDONNÉE d'étapes
--   automation_triggers  le couple « quand ceci » -> « faire cela »
--   sequence_enrollments gagne trigger_id / workflow_id / signal_id
--
-- Deux principes structurants, posés ici parce qu'ils coûtent cher après.
--
-- 1. Pas de graphe. Les étapes d'un workflow sont des touchpoints ordonnés par
--    sort_order, exactement comme une séquence de campagne. Aucune coordonnée,
--    aucun DAG, aucun moteur de layout.
--
-- 2. Les étapes sont COPIÉES à l'inscription, jamais référencées. Le contact
--    garde la copie reçue à son entrée : un workflow modifié pendant qu'un
--    parcours est en vol ne réécrit rien, et campaign_sends.UNIQUE(
--    opportunity_id, touchpoint_id) reste valide. C'est ce qui règle le
--    versionnement sans table de versions.

-- =====================================================================
-- 1. workflows · le modèle
-- =====================================================================

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Sortie de sécurité : rien ne bornait un enrollment jusqu'ici. Un contact
  -- pouvait rester en parcours indéfiniment si aucune autre sortie ne tombait.
  -- 45 jours par défaut (arbitrage du cadrage ; la maquette affichait 30).
  max_duration_days INTEGER NOT NULL DEFAULT 45 CHECK (max_duration_days BETWEEN 1 AND 365),
  -- Politique de réinscription, portée par le WORKFLOW et non par le couple :
  -- un contact déjà passé par « Prise de contact » via Recrutement n'y entre
  -- pas une seconde fois via Levée de fonds.
  reenroll_policy TEXT NOT NULL DEFAULT 'period'
    CHECK (reenroll_policy IN ('never', 'period', 'always')),
  reenroll_days INTEGER NOT NULL DEFAULT 90 CHECK (reenroll_days BETWEEN 1 AND 3650),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id) WHERE archived_at IS NULL;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- Les touchpoints appartiennent désormais à UN conteneur parmi trois :
-- une campagne, un enrollment (workflow d'un seul contact, migration 103),
-- ou un workflow (le modèle réutilisable).
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS workflow_id UUID
  REFERENCES workflows(id) ON DELETE CASCADE;
ALTER TABLE touchpoints DROP CONSTRAINT IF EXISTS chk_touchpoints_container;
ALTER TABLE touchpoints ADD CONSTRAINT chk_touchpoints_container
  CHECK (
    (campaign_id IS NOT NULL)::int
    + (enrollment_id IS NOT NULL)::int
    + (workflow_id IS NOT NULL)::int = 1
  );
CREATE INDEX IF NOT EXISTS idx_touchpoints_workflow ON touchpoints(workflow_id);

-- =====================================================================
-- 2. automation_triggers · le couple
-- =====================================================================

CREATE TABLE IF NOT EXISTS automation_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,

  -- Deux natures de déclencheurs, une seule abstraction. `signal` couvre à la
  -- fois l'événementiel (une actualité remonte) et l'état évalué par un cron
  -- (deal stagnant, contact inactif) : dans les deux cas le déclenchement a
  -- lieu à l'INSERTION d'une ligne dans `signals`. Le moteur de signaux est
  -- déjà l'évaluateur d'état périodique, on n'en écrit pas un second.
  event_source TEXT NOT NULL CHECK (event_source IN ('signal', 'crm_event', 'email_event')),
  -- signal      -> signals.signal_type
  -- crm_event   -> deal_stage_changed | deal_created | contact_created
  -- email_event -> reply_received | no_reply_days
  event_key TEXT NOT NULL,
  label TEXT NOT NULL,

  -- draft   : créé, jamais armé. Rien ne part.
  -- active  : armé.
  -- paused  : mis en pause à la main.
  -- breaker : mis en pause par le disjoncteur, relance manuelle uniquement.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'breaker')),
  paused_reason TEXT,

  armed_at TIMESTAMPTZ,
  last_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un même événement ne peut pas être armé deux fois pour le même compte :
-- deux déclencheurs « signal Recrutement » inscriraient le contact deux fois.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_triggers_one_per_event
  ON automation_triggers(user_id, event_source, event_key)
  WHERE status <> 'draft';
CREATE INDEX IF NOT EXISTS idx_automation_triggers_user ON automation_triggers(user_id, status);
CREATE INDEX IF NOT EXISTS idx_automation_triggers_lookup
  ON automation_triggers(user_id, event_source, event_key) WHERE status = 'active';
ALTER TABLE automation_triggers ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 3. sequence_enrollments · rattacher l'inscription à sa cause
-- =====================================================================

ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS trigger_id UUID
  REFERENCES automation_triggers(id) ON DELETE SET NULL;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS workflow_id UUID
  REFERENCES workflows(id) ON DELETE SET NULL;
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS signal_id UUID
  REFERENCES signals(id) ON DELETE SET NULL;

-- Sans cette colonne, la colonne DÉCLENCHEUR de l'Historique n'a aucune source
-- et le rattrapage ne se distingue pas d'un déclenchement normal. La
-- distinction n'est pas cosmétique : le rattrapage inscrit 124 contacts d'un
-- coup là où le disjoncteur s'arrête à 25 par heure. Comptés ensemble, la
-- toute première automatisation se mettrait en pause de sécurité dans la
-- minute, ce qui est la pire démonstration possible.
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS enrollment_source TEXT
  NOT NULL DEFAULT 'agent'
  CHECK (enrollment_source IN ('agent', 'user', 'event', 'backfill'));

-- Clé d'idempotence, calculée par lib/automation-enroll selon la politique de
-- réinscription du workflow. NULL = pas de dédup (politique « à chaque fois »).
ALTER TABLE sequence_enrollments ADD COLUMN IF NOT EXISTS dedup_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_dedup
  ON sequence_enrollments(user_id, dedup_key) WHERE dedup_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_trigger ON sequence_enrollments(trigger_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_workflow ON sequence_enrollments(workflow_id);
-- Le disjoncteur compte les inscriptions récentes d'un déclencheur.
CREATE INDEX IF NOT EXISTS idx_enrollments_trigger_recent
  ON sequence_enrollments(trigger_id, created_at DESC)
  WHERE enrollment_source = 'event';

-- Un enrollment né d'un déclencheur n'a pas de « but » au sens des trois
-- chantiers agent (réactivation, upsell, churn) : son but est le workflow.
ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_goal_check;
ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_goal_check
  CHECK (goal IN ('reactivation', 'upsell', 'churn_prevention', 'automation'));

ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_created_by_check;
ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_created_by_check
  CHECK (created_by IN ('agent', 'user', 'trigger'));

-- Le motif de sortie est l'unité de l'Historique et des statistiques. Sans
-- motif typé et stocké, l'Historique est une liste de « terminé » qui
-- n'apprend rien. Les cinq valeurs de la migration 103 sont conservées.
-- « meeting_requested » et non « meeting_booked » : c'est une lecture de la
-- réponse par un classifieur d'intention, pas un fait. Le libellé « RDV pris »
-- reste interdit côté interface.
ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
ALTER TABLE sequence_enrollments ADD CONSTRAINT sequence_enrollments_stop_reason_check
  CHECK (stop_reason IS NULL OR stop_reason IN (
    'replied', 'bounced', 'unsubscribed', 'manual', 'deal_updated',
    'meeting_requested', 'deal_stage_reached', 'max_duration', 'handed_off'
  ));

-- =====================================================================
-- 4. signals · faire bouger le statut
-- =====================================================================
--
-- 320 signaux en production, tous en `new`, aucun traité. Quand un signal
-- déclenche un workflow, il doit quitter `new` : c'est la seule preuve
-- mesurable que la feature sert à quelque chose, et le backlog doit
-- visiblement se vider. `signals.status` n'a pas de CHECK, la valeur
-- `automated` s'ajoute sans contrainte à modifier.

ALTER TABLE signals ADD COLUMN IF NOT EXISTS automation_trigger_id UUID
  REFERENCES automation_triggers(id) ON DELETE SET NULL;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS enrollment_id UUID
  REFERENCES sequence_enrollments(id) ON DELETE SET NULL;

-- Pourquoi un signal n'a PAS inscrit son contact alors qu'un déclencheur est
-- armé. Sans cette colonne, un déclencheur qui ne déclenche jamais reste
-- inexplicable, et l'interface est réduite à inventer une cause.
-- `no_known_contact` est de loin la plus fréquente : la veille externe remonte
-- des sociétés absentes de la base. Un contact n'est JAMAIS créé depuis un
-- signal : il tomberait dans la population CRM (campaign_id IS NULL, voir
-- lib/crm-scope) et deviendrait éligible aux relances « suite à nos échanges »
-- alors qu'aucun échange n'a jamais eu lieu.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS automation_skip_reason TEXT
  CHECK (automation_skip_reason IS NULL OR automation_skip_reason IN (
    'no_known_contact', 'no_email', 'recently_enrolled',
    'contact_in_other_workflow', 'breaker_open', 'no_mailbox'
  ));

COMMENT ON COLUMN signals.status IS
  'new = détecté, jamais traité. automated = a déclenché un workflow (voir '
  'enrollment_id). skipped = un déclencheur était armé mais le contact n''a pas '
  'pu être inscrit (voir automation_skip_reason). actioned = action manuelle '
  'historique. dismissed = ignoré. ignored_type = masqué, type entier ignoré.';

-- Idempotence : le cron recalcule les signaux d'état (deal stagnant se
-- régénère chaque nuit tant que le deal stagne). Sans cet index, le même
-- contact serait réinscrit tous les matins.
CREATE INDEX IF NOT EXISTS idx_signals_user_type_status
  ON signals(user_id, signal_type, status);

-- « Ignorer ce type » : une vraie décision, qui fait tomber le compteur.
-- Aujourd'hui, ignorer un signal c'est ne pas cliquer, donc ça ressemble à du
-- retard alors que c'est souvent un arbitrage correct.
CREATE TABLE IF NOT EXISTS signal_type_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  ignored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, signal_type)
);
ALTER TABLE signal_type_preferences ENABLE ROW LEVEL SECURITY;
