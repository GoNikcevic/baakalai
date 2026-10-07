-- Les 18 cles etrangeres qui n'avaient pas d'index.
--
-- ── Ce que ca coute, mesure et pas suppose ─────────────────────────────────
--
-- Postgres n'indexe PAS automatiquement une colonne de cle etrangere. A chaque
-- suppression d'une ligne parente, il doit verifier qu'aucun enfant ne la
-- reference encore, et cette verification est une requete interne, invisible.
-- Sans index, c'est un balayage complet de la table enfant.
--
-- Mesure sur staging le 2026-10-07, sur `deals` (129 lignes) :
--
--   sans index  Seq Scan on deals, Rows Removed by Filter: 129   10,8 ms
--   avec index  Index Only Scan using deals_account_idx           0,64 ms
--
-- Dix-sept fois plus rapide pour une reponse identique, « aucune ligne ». Et le
-- balayage tient un verrou pendant toute sa duree.
--
-- ── Pourquoi maintenant, alors que 10 ms ne genent personne ────────────────
--
-- Precisement parce que 10 ms ne genent personne. Le cout croit
-- LINEAIREMENT avec la table, et les tables concernees sont celles qui
-- grossissent le plus vite des qu'un utilisateur envoie pour de vrai :
-- `campaign_sends` et `signals` sont vides aujourd'hui et porteront des
-- dizaines de milliers de lignes au premier usage reel.
--
-- Une table vide ne se plaint jamais. Le jour ou elle en porte cent mille, la
-- suppression d'une campagne bloque les ecritures concurrentes le temps de la
-- lecture, et personne ne fait le lien avec un index absent depuis des mois.
--
-- ── Aucun risque ──────────────────────────────────────────────────────────
--
-- Un index ne change aucun comportement : meme resultat, meme ordre, mêmes
-- contraintes. Il coute un peu d'espace et un peu d'ecriture, et il rend les
-- suppressions et les jointures instantanees. `IF NOT EXISTS` partout, donc
-- rejouable.
--
-- A rapprocher des 128 lints de performance releves par l'audit Supabase du
-- 2026-07-27, dont ceux-ci font partie.

-- ── deals · la table la plus exposee, quatre FK sans index ────────────────
CREATE INDEX IF NOT EXISTS deals_owner_idx ON deals (owner_id);
CREATE INDEX IF NOT EXISTS deals_team_idx ON deals (team_id);
CREATE INDEX IF NOT EXISTS deals_reactivated_contact_idx ON deals (reactivated_contact_id);
CREATE INDEX IF NOT EXISTS deals_reactivated_email_idx ON deals (reactivated_from_email_id);

-- ── accounts ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (owner_id);

-- ── hidden_revenue_opportunities ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS hidden_revenue_opp_idx ON hidden_revenue_opportunities (opportunity_id);

-- ── Les tables vides AUJOURD'HUI, et qui grossiront le plus vite ──────────
CREATE INDEX IF NOT EXISTS campaign_sends_touchpoint_idx ON campaign_sends (touchpoint_id);
CREATE INDEX IF NOT EXISTS campaign_sends_email_account_idx ON campaign_sends (email_account_id);
CREATE INDEX IF NOT EXISTS campaigns_email_account_idx ON campaigns (email_account_id);
CREATE INDEX IF NOT EXISTS signals_automation_trigger_idx ON signals (automation_trigger_id);
CREATE INDEX IF NOT EXISTS signals_enrollment_idx ON signals (enrollment_id);
CREATE INDEX IF NOT EXISTS autopilot_queue_enrollment_idx ON autopilot_queue (enrollment_id);
CREATE INDEX IF NOT EXISTS autopilot_queue_campaign_idx ON autopilot_queue (campaign_id);
CREATE INDEX IF NOT EXISTS sequence_enrollments_signal_idx ON sequence_enrollments (signal_id);
CREATE INDEX IF NOT EXISTS automation_triggers_workflow_idx ON automation_triggers (workflow_id);
CREATE INDEX IF NOT EXISTS sequence_recipients_user_idx ON sequence_recipients (user_id);
CREATE INDEX IF NOT EXISTS crm_owner_mappings_team_user_idx ON crm_owner_mappings (team_user_id);
CREATE INDEX IF NOT EXISTS signal_scan_user_budget_user_idx ON signal_scan_user_budget (user_id);
