-- 087 — Cache de correspondance société → registre officiel (santé financière churn)
--
-- Une ligne par (nom normalisé, pays) : le matching nom → SIREN / company number /
-- docket est coûteux (1-2 appels API) et le nom d'une société ne change pas — on ne
-- re-matche jamais deux fois. `registry_status` est rafraîchi si checked_at > 7 jours
-- (aligné sur la fenêtre de dédup du scan Brave existant).
--
-- Cache GLOBAL (pas de user_id) : le statut légal d'une société est un fait public,
-- le partager entre utilisateurs économise les quotas API sans fuite de donnée privée.
-- Les signaux par client restent, eux, dans churn_external_signals (scopés user).

CREATE TABLE IF NOT EXISTS company_registry_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_name TEXT NOT NULL,
  country TEXT NOT NULL,              -- 'FR', 'GB', 'US', ou 'EU-BE', 'EU-DE'…
  registry_id TEXT,                   -- SIREN, company number, docket id… NULL = pas de correspondance
  registry_status TEXT NOT NULL DEFAULT 'unknown',
    -- 'active' | 'insolvency' | 'safeguard' | 'dissolved' | 'not_found' | 'unknown'
  raw JSONB NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name, country)
);

CREATE INDEX IF NOT EXISTS idx_company_registry_checked ON company_registry_matches(checked_at);
