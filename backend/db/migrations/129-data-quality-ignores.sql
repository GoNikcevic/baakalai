-- 129 : « ce contact n'a pas d'entreprise, et c'est normal ».
--
-- L'onglet Général de Qualité des données compte les contacts auxquels il
-- manque un champ. Sur la base d'un beta testeur, 169 contacts sur Pipedrive
-- n'ont pas d'entreprise. Une partie d'entre eux n'en aura jamais : un
-- indépendant, un contact personnel, une ligne de test. Jusqu'ici rien ne
-- permettait de le dire. Ces contacts revenaient à chaque scan, le compteur ne
-- pouvait pas tomber à zéro, et le score de qualité restait plafonné pour une
-- raison qui n'était pas un défaut de la donnée.
--
-- D'où cette table : elle enregistre qu'un contact a été écarté POUR UN TYPE DE
-- PROBLÈME précis. Écarter Laura Jacquet de « entreprise manquante » ne
-- l'écarte pas de « email invalide ». C'est la raison de la clé à quatre
-- colonnes : le même contact peut être écarté d'un contrôle et pas des autres.
--
-- Ce n'est pas une suppression ni une exclusion du CRM. Le contact reste
-- entier, synchronisé, démarchable. Seul le contrôle de qualité cesse de le
-- signaler, et la décision est réversible : supprimer la ligne le fait
-- réapparaître au scan suivant.
--
-- `crm_contact_id` est du TEXT et non un UUID parce que l'identifiant dépend du
-- CRM. Pipedrive, HubSpot et Salesforce numérotent leurs contacts eux-mêmes ;
-- pour Notion, Airtable et les contacts sans CRM, le scan travaille sur les
-- lignes locales et l'identifiant est l'UUID de `opportunities`. Les deux
-- cohabitent dans cette colonne, exactement comme dans les rapports de scan
-- (`crm_cleaning_reports.issues`), et c'est le couple provider + identifiant
-- qui lève l'ambiguïté.

CREATE TABLE IF NOT EXISTS data_quality_ignores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'pipedrive', 'hubspot', 'salesforce', 'odoo', 'notion', 'airtable',
  -- 'folk', ou le pseudo-provider '__no_crm__' pour les contacts sans origine
  -- CRM connue. Même vocabulaire que crm_cleaning_reports.provider.
  provider       TEXT NOT NULL,

  -- Identifiant natif du CRM, ou UUID de opportunities pour les providers
  -- scannés localement (voir LOCAL_SCAN_PROVIDERS dans routes/data-quality.js).
  crm_contact_id TEXT NOT NULL,

  -- 'missing_company', 'missing_email', 'missing_name', 'invalid_email_format',
  -- 'invalid_email_domain', 'email_typo'... Un type de contrôle du scan.
  issue_type     TEXT NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, provider, crm_contact_id, issue_type)
);

-- Le scan lit tous les contacts écartés d'un provider en une fois, avant de
-- filtrer ses listes de problèmes. C'est le seul accès en lecture chaud.
CREATE INDEX IF NOT EXISTS idx_dq_ignores_user_provider
  ON data_quality_ignores (user_id, provider);
