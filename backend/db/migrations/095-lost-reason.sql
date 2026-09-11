-- 095 — Raison de perte sur les deals perdus
--
-- Aucun champ n'existait pour savoir POURQUOI un deal est perdu, seulement QUE
-- il l'est (status='lost'). lost_reason est alimenté de deux façons :
--  - 'crm'    : rapatrié tel quel depuis le champ natif du CRM (Pipedrive
--               lost_reason aujourd'hui ; les autres connecteurs n'ont pas
--               d'équivalent standard fiable).
--  - 'manual' : saisi dans baakalai (Analytics → Deals → Raisons de perte)
--               pour les deals sans donnée CRM.
-- lost_reason_source distingue les deux pour ne jamais écraser une valeur CRM
-- par une resynchro, et pour afficher la provenance dans l'UI.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS lost_reason_source TEXT
  CHECK (lost_reason_source IN ('crm', 'manual'));
