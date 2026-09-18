-- 105 · Photo hebdomadaire du travail de baakalai
--
-- Alimente le bloc « Cette semaine » du dashboard et l'en-tête du digest du
-- lundi. Les chiffres sont recalculables à tout moment depuis les tables
-- sources (lib/activity-digest.js) : cette table n'est pas la source de
-- vérité, elle sert à garder l'historique semaine par semaine (comparaison
-- d'une semaine à l'autre) et à figer ce qui a été annoncé dans l'email.
--
-- Conséquence voulue : le bloc fonctionne dès le premier jour, sans attendre
-- qu'un cron ait tourné une fois.

CREATE TABLE IF NOT EXISTS weekly_activity_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Lundi et dimanche de la semaine couverte, en heure de Paris.
  week_start  DATE NOT NULL,
  week_end    DATE NOT NULL,
  -- { accountsReviewed, signals, followUps, issuesFound, analyses }
  counters    JSONB NOT NULL DEFAULT '{}',
  -- { reactivatedCount, reactivatedValue, replies, churnAlerts, items: [...] }
  results     JSONB NOT NULL DEFAULT '{}',
  -- { approvals, approvalsOldestDays, drafts, noEmail }
  pending     JSONB NOT NULL DEFAULT '{}',
  -- 7 entiers, lundi → dimanche : nombre d'actions par jour.
  daily       INTEGER[] NOT NULL DEFAULT '{}',
  -- Équivalent temps humain, en minutes, barème dans lib/activity-digest.js.
  minutes     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_activity_user
  ON weekly_activity_snapshots(user_id, week_start DESC);

-- Accès backend uniquement (service_role via pg direct), même posture que
-- strategic_results (084) et product_events (071).
ALTER TABLE weekly_activity_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON weekly_activity_snapshots FROM anon, authenticated;
