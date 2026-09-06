-- 074: Diagnostic CRM public (lead magnet) — rapports anonymes et éphémères.
-- Aucune clé API n'est stockée : le token sert à un seul fetch, seul le
-- rapport agrégé (JSONB) est conservé, purgé après 30 jours par
-- lib/retention-cleanup.js. L'id UUID sert de slug de partage non devinable.

CREATE TABLE IF NOT EXISTS public_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'fr',
  report JSONB NOT NULL,
  views INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS idx_public_diag_expires ON public_diagnostics(expires_at);

-- Accès service uniquement (le backend passe par pg direct) — même politique
-- que product_events (071) et strategic_results (073).
ALTER TABLE public_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public_diagnostics FROM anon, authenticated;
