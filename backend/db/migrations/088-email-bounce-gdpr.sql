-- 088 — Bounce d'email tracé sur le contact + support de la strate RGPD dans l'undo
--
-- email_bounced_at : posé par email-outbound quand un envoi échoue en rejet
-- DÉFINITIF (5xx destinataire inconnu) — pas sur les erreurs transitoires. Lu par
-- le scan data quality (issue email_bounced) et le scoring churn (contact parti).
-- Remis à NULL si un envoi ultérieur aboutit (l'adresse re-marche).

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS email_bounced_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS email_bounce_reason TEXT;

-- Strate « Conformité » (purge RGPD) dans le circuit d'historique/undo existant.
ALTER TABLE data_quality_changes DROP CONSTRAINT IF EXISTS data_quality_changes_strate_check;
ALTER TABLE data_quality_changes ADD CONSTRAINT data_quality_changes_strate_check
  CHECK (strate IN ('duplicates','deal_quality','client_quality','gdpr'));

ALTER TABLE data_quality_changes DROP CONSTRAINT IF EXISTS data_quality_changes_change_type_check;
ALTER TABLE data_quality_changes ADD CONSTRAINT data_quality_changes_change_type_check
  CHECK (change_type IN ('merge_keep','merge_delete','delete','field_update','enrichment',
                         'auto_fix','archive','product_line_assign','gdpr_purge'));
