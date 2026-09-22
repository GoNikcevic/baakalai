-- 113 · Date de création CRM sur les opportunités
--
-- POURQUOI
-- --------
-- `opportunities.created_at` est la date d'insertion CHEZ NOUS, pas la date à
-- laquelle le contact est né dans le CRM du client. Les deux étaient confondues,
-- et la confusion coûte cher : un CRM alimenté depuis 2019 et importé hier
-- ressort comme vieux d'un jour.
--
-- La couche `api/` récupérait déjà la date CRM pour certains connecteurs
-- (`add_time` Pipedrive, `create_date` Odoo, `created_time` Notion) puis la
-- jetait, faute de colonne où l'écrire. Les autres ne la demandaient même pas :
-- le SOQL de `salesforce.listContacts` triait `ORDER BY CreatedDate` sans jamais
-- SELECTer le champ, et `hubspot.listAllContacts` ne listait pas `createdate`
-- dans ses propriétés.
--
-- Même séparation des responsabilités que pour `last_activity_at` (voir
-- `lib/crm-activity-date.js`), avec une troisième date qui a son propre sens :
--   created_at      = quand NOUS avons inséré la ligne (audit technique)
--   crm_created_at  = quand le contact est né dans le CRM du client (métier)
--   last_activity_at = quand le commercial l'a touché pour la dernière fois
--
-- CE QUE ÇA DÉBLOQUE
-- ------------------
-- Le critère « ≥ 12 mois d'historique CRM » de l'ICP (arbitrage du 2026-09-21)
-- est aujourd'hui figé à NULL dans `lib/icp-signals.js` faute de cette colonne.
-- C'est le premier des trois critères déductibles et il n'était pas mesurable.
--
-- NULL veut dire « inconnu », jamais « zéro ». Un connecteur qui n'expose pas de
-- date de création laisse la colonne vide, et l'ancienneté ressort inconnue
-- plutôt que fausse : on ne disqualifie pas un compte sur une lacune de notre
-- propre import.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_created_at TIMESTAMPTZ;

COMMENT ON COLUMN opportunities.crm_created_at IS
  'Date de creation du contact DANS LE CRM du client, renseignee a l''import (lib/crm-origin.js). A ne pas confondre avec created_at, qui est la date d''insertion chez nous. NULL = le connecteur n''expose pas la date, ou ligne anterieure a la 113.';

-- `computeIcpSignals` lit min(crm_created_at) par utilisateur à chaque fin
-- d'import. Index partiel : les lignes sans date CRM ne pèsent pas dessus, et
-- elles sont majoritaires tant que les 443 opportunités existantes n'ont pas
-- été ré-importées.
CREATE INDEX IF NOT EXISTS idx_opportunities_crm_created_at
  ON opportunities (user_id, crm_created_at)
  WHERE crm_created_at IS NOT NULL;

-- REPRISE DES DONNÉES EXISTANTES
-- ------------------------------
-- Aucune reprise en SQL n'est possible : la date CRM n'a jamais été stockée
-- nulle part, pas même dans la colonne `data`. Elle doit être re-demandée au
-- CRM. État de la production au 2026-09-22, sur 443 opportunités :
--
--   • 203 lignes viennent de la prospection, sans CRM d'origine. Elles n'ont
--     légitimement ni date CRM ni owner, et n'en auront jamais.
--   • 67 lignes Salesforce se remplissent toutes seules au prochain passage du
--     cron CRM : `crm-agent.js` rattrape la colonne quand elle est vide, et
--     Salesforce fait partie des connecteurs qu'il synchronise.
--   • 173 lignes Notion demandent un ré-import manuel. Le cron `stepSync` ne
--     couvre que pipedrive, salesforce, hubspot et odoo ; Notion, Airtable et
--     Folk n'ont pas de synchronisation automatique. La branche Notion de
--     `POST /api/crm/import/notion` rattrape la colonne sur les contacts déjà
--     connus, donc un ré-import suffit, sans créer de doublons.
--
-- À noter : Notion n'expose aucun propriétaire exploitable. Ces 173 lignes
-- auront une date de création mais jamais d'owner, et ne compteront donc pas
-- dans le nombre de sièges estimé par l'ICP.
