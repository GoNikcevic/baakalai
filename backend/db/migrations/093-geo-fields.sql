-- 093 — Champs géographiques sur les contacts
--
-- Aucun connecteur ne rapatriait la géo : impossible d'analyser le pipeline par
-- pays. On persiste le pays/ville tels que fournis par le CRM (HubSpot country/city,
-- Salesforce MailingCountry/MailingCity, Odoo country_id/city — Pipedrive n'a pas
-- d'adresse standard sur les personnes, fallback TLD email côté analytics).
-- La normalisation (France/FR/france → FR) se fait à la lecture (lib/geo.js),
-- jamais à l'écriture : on ne détruit pas la donnée source du CRM.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS city TEXT;
