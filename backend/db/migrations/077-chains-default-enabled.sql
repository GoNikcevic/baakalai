-- 077: Chains de réactivation/upsell actives par défaut, en mode brouillon.
--
-- Les chains n'étaient activées que sur 1 compte : pour tous les autres la
-- config auto-créée était enabled:false et rien ne tournait. On active par
-- défaut MAIS approval_required reste true — la chain ne fait que déposer des
-- brouillons dans la file d'approbation, rien ne part sans action utilisateur.
-- Le passage en envoi autonome (approval_required:false) reste un choix par
-- compte, prévu pour les paliers supérieurs du pricing.

ALTER TABLE agent_chain_configs
  ALTER COLUMN deal_reactivation SET DEFAULT '{"enabled": true, "approval_required": true, "max_per_day": 3, "min_stagnant_days": 14, "exclude_above_value": null}',
  ALTER COLUMN auto_upsell SET DEFAULT '{"enabled": true, "approval_required": true, "max_per_day": 2, "min_score": 50}';

-- Activer l'existant en préservant les autres réglages (merge, pas remplacement).
UPDATE agent_chain_configs
SET deal_reactivation = deal_reactivation || '{"enabled": true}'::jsonb,
    auto_upsell = auto_upsell || '{"enabled": true}'::jsonb,
    updated_at = now()
WHERE (deal_reactivation->>'enabled')::boolean IS DISTINCT FROM true
   OR (auto_upsell->>'enabled')::boolean IS DISTINCT FROM true;
