-- 065: Suppression du code mort en base + hygiène d'index
--
-- Toutes les tables supprimées ici sont VIDES en production (0 ligne) et leur
-- code applicatif a été retiré dans le même commit.

-- ============================================================
-- memory_embeddings — jumelle morte du système vectoriel
-- ============================================================
-- Deux systèmes coexistaient : memory_patterns.embedding (HNSW, source de
-- vérité) et memory_embeddings (ivfflat, historique). La seconde n'a jamais
-- contenu la moindre ligne : upsertPatternEmbedding écrivait dans les deux, donc
-- une table vide prouve qu'aucune écriture n'a abouti. Son index ivfflat
-- (lists=100, construit sur table vide) occupait 1,6 Mo — le plus gros objet de
-- la base — pour indexer du néant.
--
-- Code mis à jour : lib/vector-store.js (chemins de fallback supprimés,
-- storeEmbedding supprimé faute d'appelant) et orchestrator/jobs/consolidate.js
-- (LEFT JOIN remplacé par `WHERE mp.embedding IS NULL`).

DROP TABLE IF EXISTS memory_embeddings;

-- ============================================================
-- job_queue — jamais produite, jamais consommée
-- ============================================================
-- Aucun appelant de queue.add(), startPolling() jamais invoqué, et le module
-- orchestrator/queue/ n'était même pas chargé dans le process Node. Le seul
-- accès en production était un DELETE toutes les 6 h sur une table vide.
-- Voir backend/orchestrator/README.md : « Structure only. Not active. »

DROP TABLE IF EXISTS job_queue;

-- ============================================================
-- Fonction orpheline
-- ============================================================
-- get_dashboard_kpis prenait un user_id en paramètre sans jamais le confronter
-- à auth.uid(), et n'avait aucun appelant applicatif.

DROP FUNCTION IF EXISTS public.get_dashboard_kpis(uuid);

-- ⚠️ NE PAS SUPPRIMER rls_auto_enable() : contrairement à ce que suggère un
-- grep sur le code JS, elle n'est pas orpheline — elle porte l'event trigger
-- `ensure_rls` (ddl_command_end) qui active automatiquement RLS sur toute
-- nouvelle table du schéma public. C'est ce qui explique que les 46 tables
-- aient RLS activé. Vérifié après le REVOKE de 064 : le trigger fonctionne
-- toujours (les event triggers ne passent pas par le privilège EXECUTE).

-- ============================================================
-- Index dupliqués (15 paires strictement identiques)
-- ============================================================
-- Une migration a créé des index suffixés `_id` par-dessus des index déjà
-- existants. Chaque doublon ralentit les écritures sans rien accélérer.
--
-- ⚠️ Sur users / refresh_tokens / user_integrations on supprime l'index NON
-- adossé à une contrainte : la contrainte UNIQUE doit survivre.

DROP INDEX IF EXISTS idx_campaigns_user_id;
DROP INDEX IF EXISTS idx_chart_data_user_id;
DROP INDEX IF EXISTS idx_chat_messages_thread_id;
DROP INDEX IF EXISTS idx_chat_threads_user_id;
DROP INDEX IF EXISTS idx_diagnostics_campaign_id;
DROP INDEX IF EXISTS idx_documents_user_id;
DROP INDEX IF EXISTS idx_opportunities_user_id;
DROP INDEX IF EXISTS idx_project_files_project_id;
DROP INDEX IF EXISTS idx_projects_user_id;
DROP INDEX IF EXISTS idx_reports_user_id;
DROP INDEX IF EXISTS idx_touchpoints_campaign_id;
DROP INDEX IF EXISTS idx_versions_campaign_id;
-- index unique doublonnant la contrainte users_email_key (conservée)
DROP INDEX IF EXISTS idx_users_email;
-- doublons de contraintes UNIQUE (conservées)
DROP INDEX IF EXISTS idx_refresh_tokens_hash;
DROP INDEX IF EXISTS idx_user_integrations_user_provider;

-- ============================================================
-- Clés étrangères non indexées (16)
-- ============================================================
-- Sans index, chaque DELETE sur la table parente déclenche un seq scan de
-- l'enfant. Les tables concernées sont majoritairement vides : c'est le bon
-- moment, le coût est nul.

CREATE INDEX IF NOT EXISTS idx_autopilot_queue_opportunity  ON autopilot_queue(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_crm_cleaning_reports_team    ON crm_cleaning_reports(team_id);
CREATE INDEX IF NOT EXISTS idx_email_accounts_team          ON email_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_memory_patterns_source_test  ON memory_patterns(source_test_id);
CREATE INDEX IF NOT EXISTS idx_nurture_emails_email_account ON nurture_emails(email_account_id);
CREATE INDEX IF NOT EXISTS idx_nurture_emails_team          ON nurture_emails(team_id);
CREATE INDEX IF NOT EXISTS idx_nurture_triggers_team        ON nurture_triggers(team_id);
CREATE INDEX IF NOT EXISTS idx_project_files_user           ON project_files(user_id);
CREATE INDEX IF NOT EXISTS idx_prospect_act_opportunity     ON prospect_activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_reco_feedback_pattern        ON recommendation_feedback(pattern_id);
CREATE INDEX IF NOT EXISTS idx_signals_config               ON signals(config_id);
CREATE INDEX IF NOT EXISTS idx_signals_opportunity          ON signals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_team_campaigns_created_by    ON team_campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_teams_created_by             ON teams(created_by);
CREATE INDEX IF NOT EXISTS idx_templates_source_campaign    ON templates(source_campaign_id);
CREATE INDEX IF NOT EXISTS idx_user_integrations_team       ON user_integrations(team_id);
