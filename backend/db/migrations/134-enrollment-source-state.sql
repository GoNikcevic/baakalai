-- Une inscription nee d'un declencheur d'ETAT a sa propre source.
--
-- ── Le probleme, et il est atteignable ────────────────────────────────────
--
-- Le disjoncteur de `lib/automation-enroll` protege d'une BOUCLE : un evenement
-- qui en produit un autre, vingt-cinq fois en une heure, et le declencheur
-- passe en statut `breaker` jusqu'a une relance A LA MAIN. Il ne compte que les
-- inscriptions dont `enrollment_source = 'event'`, et c'est exactement pour ca
-- que le rattrapage ecrit 'backfill' : il inscrit volontairement un lot d'un
-- coup, et comptes ensemble la premiere automatisation ouvrirait sa propre
-- securite dans la minute.
--
-- Une evaluation d'ETAT est de la meme nature qu'un rattrapage. « Contact
-- inactif depuis 60 jours » est vrai pour tout un lot le jour ou on l'arme, et
-- `runStateTriggers` en prend 25 par passage. Elle ecrivait pourtant 'event'.
--
-- Consequence mesuree par un test : deux evaluations dans la meme heure
-- ouvrent le disjoncteur et eteignent le declencheur. Et deux evaluations dans
-- l'heure sont faciles a obtenir, parce que le bouton « evaluer maintenant »
-- existe precisement pour staging, ou `ORCHESTRATOR_ENABLED=false` et ou aucun
-- cron ne tourne. Le premier essai de la feature l'eteignait.
--
-- ── Pourquoi une valeur de plus et pas la reutilisation de 'backfill' ─────
--
-- 'backfill' veut dire « rattrapage d'un stock de signaux deja presents », et
-- c'est ce que la colonne Declencheur de l'Historique raconte. Y ranger les
-- evaluations d'etat melangerait deux choses dans toute lecture future pour
-- economiser une migration de trois lignes.
--
-- ── Aucun risque ──────────────────────────────────────────────────────────
--
-- Purement additif : la contrainte s'elargit, aucune ligne existante ne la
-- viole. Un seul endroit du code LIT cette colonne (le compteur du
-- disjoncteur, qui filtre sur 'event'), et l'index partiel qui le sert garde
-- donc exactement la meme definition. Rejouable.

ALTER TABLE sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_enrollment_source_check;

ALTER TABLE sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_enrollment_source_check
  CHECK (enrollment_source IN ('agent', 'user', 'event', 'backfill', 'state'));
