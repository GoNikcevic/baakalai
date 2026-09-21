-- Migration 103: enrollments de séquence génériques.
-- Le moteur natif (lib/native-sequence-engine) ne travaille plus uniquement sur
-- des campagnes de prospection : un « enrollment » inscrit UN contact CRM dans
-- UN workflow de relance sur mesure (réactivation, upsell, prévention churn),
-- proposé par l'agent et approuvé par l'utilisateur avant tout envoi.
-- La frontière crm-scope reste intacte : un enrollment référence le contact
-- CRM existant (campaign_id IS NULL), il ne le transforme jamais en prospect
-- de campagne.

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  goal TEXT NOT NULL CHECK (goal IN ('reactivation', 'upsell', 'churn_prevention')),
  -- draft = proposé, en attente d'approbation ; active = approuvé, le moteur
  -- exécute ; completed = tous les steps consommés ; stopped = arrêt définitif.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'stopped')),
  -- Pourquoi ce plan — affiché sur l'écran d'approbation (mémoire patterns).
  rationale TEXT,
  created_by TEXT NOT NULL DEFAULT 'agent' CHECK (created_by IN ('agent', 'user')),
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN
    ('replied', 'bounced', 'unsubscribed', 'manual', 'deal_updated')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Un seul workflow vivant à la fois par contact — le re-enrollment après un
-- stop/completed reste possible (l'index est partiel).
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollments_one_live_per_opp
  ON sequence_enrollments(opportunity_id)
  WHERE status IN ('draft', 'active', 'paused');
CREATE INDEX IF NOT EXISTS idx_enrollments_user_status
  ON sequence_enrollments(user_id, status);

-- Le backend passe par DATABASE_URL (service role) ; on ferme la porte anon
-- comme sur les autres tables sensibles (leçon migration 064).
ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;

-- Les touchpoints appartiennent désormais à UN conteneur : une campagne
-- (séquence partagée par tous les prospects) OU un enrollment (workflow sur
-- mesure pour un seul contact).
ALTER TABLE touchpoints ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE touchpoints ADD COLUMN IF NOT EXISTS enrollment_id UUID
  REFERENCES sequence_enrollments(id) ON DELETE CASCADE;
ALTER TABLE touchpoints DROP CONSTRAINT IF EXISTS chk_touchpoints_container;
ALTER TABLE touchpoints ADD CONSTRAINT chk_touchpoints_container
  CHECK ((campaign_id IS NULL) <> (enrollment_id IS NULL));
CREATE INDEX IF NOT EXISTS idx_touchpoints_enrollment ON touchpoints(enrollment_id);

-- campaign_sends devient le journal d'envoi universel (campagnes + enrollments).
ALTER TABLE campaign_sends ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS enrollment_id UUID
  REFERENCES sequence_enrollments(id) ON DELETE CASCADE;
ALTER TABLE campaign_sends DROP CONSTRAINT IF EXISTS chk_campaign_sends_container;
ALTER TABLE campaign_sends ADD CONSTRAINT chk_campaign_sends_container
  CHECK (campaign_id IS NOT NULL OR enrollment_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_enrollment ON campaign_sends(enrollment_id);

-- Fix P0 « copy edit » au niveau données : supprimer un touchpoint ne doit
-- plus effacer le journal d'envoi (le CASCADE faisait repartir tous les
-- prospects à E1 quand la séquence d'une campagne active était rééditée).
-- L'historique survit avec touchpoint_id NULL : il ne compte plus comme step
-- consommé (le step n'existe plus) mais reste dans les stats et le cap
-- journalier. La route PUT /:id/sequence réconcilie désormais au lieu de
-- delete/recreate — ceci est la ceinture de sécurité si un step est
-- réellement retiré.
ALTER TABLE campaign_sends ALTER COLUMN touchpoint_id DROP NOT NULL;
-- Drop par introspection : si le FK a un nom non standard, un DROP IF EXISTS
-- nominal passerait sans rien faire et l'ancien CASCADE resterait actif.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'campaign_sends'::regclass AND contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(conkey) k
        JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k
        WHERE a.attname = 'touchpoint_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE campaign_sends DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_touchpoint_id_fkey
  FOREIGN KEY (touchpoint_id) REFERENCES touchpoints(id) ON DELETE SET NULL;
