-- 076 : état des écritures Baakalai → CRM
--
-- Le sens sortant n'avait aucune trace de ce qui avait déjà été poussé.
-- crm-bidirectional-sync (supprimé en 2a50921) lisait bien un `score_pushed_at`
-- pour s'auto-limiter à une écriture par semaine — sauf que la colonne n'a
-- jamais existé et que rien ne l'écrivait : le garde-fou était toujours vrai, et
-- le module aurait créé une note par contact et par jour dans le CRM du client.
--
-- On stocke donc l'empreinte du contenu poussé, et non un simple horodatage :
-- le bon critère n'est pas « ça fait 7 jours » mais « le contenu a changé ».
-- Un score de churn stable ne doit produire aucune écriture, même au bout d'un
-- mois ; un score qui bouge doit repartir tout de suite.
--
-- JSONB plutôt que des colonnes dédiées : chaque type d'écriture (churn,
-- relance, qualité de données…) a sa propre entrée, et en ajouter un ne demande
-- pas de nouvelle migration.
--   { "churn": { "fingerprint": "76|inactivity,no_reply", "at": "2026-09-01T…" } }

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS crm_push_state JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN opportunities.crm_push_state IS
  'Empreinte et date de la dernière écriture Baakalai → CRM, par type de contenu. '
  'Sert à ne réécrire que lorsque le contenu a réellement changé (lib/crm-export.js).';
