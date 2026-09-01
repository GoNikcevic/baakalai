-- 078: Socle billing Stripe — plan, statut d'abonnement, identifiants Stripe.
--
-- Les comptes existants (fondateurs, beta gratuits) gardent trial_ends_at NULL
-- = exemptés du paywall. Les nouveaux comptes démarrent un essai de 14 jours.
-- Tant que STRIPE_SECRET_KEY n'est pas posée sur Railway, tout le billing est
-- inerte (routes en 501, paywall désactivé) — même pattern que les OAuth CRM.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

-- Les nouveaux inscrits ont 14 jours d'essai ; l'existant reste NULL (exempté).
ALTER TABLE users ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer
  ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
