-- 070: nurture_emails.metadata — la colonne que tout le monde croyait exister
--
-- lib/agent-chains.js (deal_reactivation, auto_upsell) INSÈRE dans
-- nurture_emails avec une colonne metadata, et /api/crm/reactivation-stats
-- filtre sur metadata->>'chain'. Or aucune migration ne l'a jamais créée :
-- chaque écriture d'email de chaîne échouait en prod (« column "metadata"
-- does not exist ») et la ReactivationCard du dashboard ne s'est jamais
-- affichée — le .catch(() => {}) du frontend masquait l'erreur.
-- Découvert le 2026-08-05 en vérifiant les KPIs revenue.

ALTER TABLE nurture_emails ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN nurture_emails.metadata IS
  'Contexte de génération (ex: {"chain": "deal_reactivation"}). Filtré par '
  'reactivation-stats pour attribuer les relances aux chaînes autonomes.';

-- Chemin chaud de reactivation-stats : filtre sur metadata->>'chain' borné
-- aux 90 derniers jours. Index partiel suffisant.
CREATE INDEX IF NOT EXISTS idx_nurture_emails_chain
  ON nurture_emails ((metadata->>'chain')) WHERE metadata IS NOT NULL;
