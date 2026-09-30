-- 128 : l'affaire DÉRIVÉE, pour les CRM qui n'ont pas d'affaires.
--
-- Suite directe du lot 4 (migration 126), et sans elle le lot 5 casse des
-- écrans.
--
-- ── Le problème, mesuré et pas supposé ──────────────────────────────────────
--
-- Mesuré sur la production le 2026-09-30 : sur 443 lignes, **376 (85 %)**
-- viennent d'un provider qui n'expose AUCUN objet affaire.
--
--   csv / fichier · 203 lignes · 0 montant, 0 étape, 0 dénouement
--   notion        · 173 lignes · 61 montants, 0 étape, 12 gagnés
--   salesforce    ·  67 lignes · 25 montants, 25 étapes
--
-- `WITH_DEALS` ne couvre que Salesforce, HubSpot, Pipedrive et Odoo. Pour un
-- utilisateur Notion, Airtable, Folk ou venu d'un CSV, la table `deals` reste
-- donc vide POUR TOUJOURS. Et le jour où le lot 5 fera lire `deals` aux
-- écrans, cet utilisateur perdrait d'un coup ses 61 montants et ses 12
-- clients : ils vivent aujourd'hui sur la ligne du contact, recopiés depuis
-- une propriété Notion, pas depuis un objet affaire.
--
-- ── La réponse : le même patron que les comptes ─────────────────────────────
--
-- Le lot 2 a déjà tranché exactement cette question pour les sociétés. Un CRM
-- sans objet compte reçoit des comptes `source = 'derived'`, reconstruits
-- depuis le nom de société du contact. On applique le même raisonnement un
-- cran plus bas, plutôt que d'inventer un second mécanisme ou de maintenir
-- pour toujours deux chemins de lecture dans chaque écran et chaque job.
--
-- Arbitrage Goran du 2026-09-30.
--
-- ── Ce qu'une affaire dérivée n'est pas ─────────────────────────────────────
--
-- Elle n'est pas une invention. Elle ne naît que d'un contact qui porte DÉJÀ
-- un montant, une étape ou un dénouement : on ne crée pas de l'information, on
-- déménage celle qui existe vers le niveau où elle appartient. Un CSV de 203
-- contacts sans le moindre montant produit donc ZÉRO affaire, et c'est la
-- bonne réponse : une liste de contacts n'a pas d'affaires.
--
-- Elle ne se pousse pas non plus vers le CRM : il n'y a pas d'objet en face.
-- C'est `source` qui permettra au push de les écarter.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'crm'
    CHECK (source IN ('crm', 'derived'));

COMMENT ON COLUMN deals.source IS
  'crm = le CRM expose un objet affaire et c''est lui qu''on a lu. derived = reconstruite depuis un contact qui portait un montant, une étape ou un dénouement, pour les CRM sans objet affaire (Notion, Airtable, Folk, CSV). Une affaire dérivée ne se pousse jamais vers le CRM : il n''y a rien en face.';

-- Une seule affaire dérivée par contact. Index PARTIEL, même raisonnement que
-- sur `accounts` : une affaire dérivée n'a pas de `crm_deal_id`, donc l'index
-- d'unicité de la migration 126 ne la couvre pas, et sans celui-ci chaque
-- synchro en créerait une de plus.
CREATE UNIQUE INDEX IF NOT EXISTS deals_derived_unique
  ON deals (user_id, primary_contact_id)
  WHERE source = 'derived' AND primary_contact_id IS NOT NULL;
