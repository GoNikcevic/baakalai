-- 107 · Suppression du plafond de sièges (arbitrage Goran 2026-09-21/22)
--
-- Le produit doit tenir 20 personnes et plus. Le prix est de 79 €/siège/mois :
-- c'est la facturation qui décide du nombre de sièges, pas une constante.
--
-- Contrairement à `ENTITLEMENTS.teamMembers` (lib/billing.js) et à
-- `requirePlan()` (middleware/plan-gate.js), qui sont déclarés mais lus par
-- personne, CE plafond-ci était bel et bien appliqué : `db.teams.addMember`
-- comparait le nombre de membres à `teams.max_members` et levait une erreur,
-- et `/api/teams/join/:code` la relayait en 400. Le 6e membre était donc
-- réellement bloqué en production.
--
-- Convention retenue : NULL = aucun plafond. La colonne est conservée pour
-- pouvoir en reposer un par équipe si le besoin réapparaît (offre bridée,
-- compte de démonstration), sans nouvelle migration.

ALTER TABLE teams ALTER COLUMN max_members DROP DEFAULT;

-- Les équipes existantes portent la valeur 5 héritée du défaut de la
-- migration 032 : sans cette reprise, elles resteraient plafonnées alors que
-- le plafond est supprimé.
UPDATE teams SET max_members = NULL, updated_at = now() WHERE max_members IS NOT NULL;

COMMENT ON COLUMN teams.max_members IS
  'Plafond de membres de l''équipe. NULL = aucun plafond (défaut depuis la 107). Une valeur non nulle est appliquée par db.teams.addMember.';
