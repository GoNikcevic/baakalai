-- 108 · Chaîne « churn_prevention » dans agent_chain_executions
--
-- La relance groupée des clients à risque (page « À risque », bouton d'envoi
-- groupé) trace ses envois comme les autres files, pour que l'attribution et
-- l'historique les comptent. Sans cette valeur, le seul choix possible était
-- `auto_upsell` : les emails de rétention auraient été comptés comme des
-- upsells, ce qui fausse aussi bien l'attribution que la lecture des chiffres.
--
-- La contrainte vient de la migration 056, qui ne connaissait que les deux
-- chaînes autonomes de l'époque plus la prospection adaptative.

ALTER TABLE agent_chain_executions DROP CONSTRAINT IF EXISTS chain_type_check;

ALTER TABLE agent_chain_executions ADD CONSTRAINT chain_type_check
  CHECK (chain_type IN ('deal_reactivation', 'auto_upsell', 'adaptive_prospection', 'churn_prevention'));
