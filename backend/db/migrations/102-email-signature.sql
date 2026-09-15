-- 102 — Signature d'email par boîte connectée (décision Goran 15/09).
--
-- Une signature PAR compte email (email_accounts), pas par utilisateur : en
-- équipe chaque membre connecte sa propre boîte, et un utilisateur multi-boîtes
-- signe différemment selon l'adresse d'envoi.
--
-- signature_text  : bloc multi-lignes (nom, fonction, téléphone, site).
-- signature_image : logo/photo en data-URI base64 (≤ 300 Ko décodé, validé à
--                   l'API) — embarquée en pièce inline CID à l'envoi (comme
--                   Outlook), pas d'hébergement externe ni d'URL de tracking.
--
-- Dès qu'une signature existe, l'envoi passe de texte seul à multipart
-- texte+HTML (lib/email-outbound.js) — le format des vrais emails Gmail.

ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS signature_text TEXT;
ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS signature_image TEXT;
