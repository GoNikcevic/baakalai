-- 119: les demandes d'échange déposées depuis la landing (section Tarif).
--
-- Ces lignes ne sont PAS des utilisateurs. Personne n'a de compte à ce stade,
-- et c'est le point : le formulaire existe pour capter ceux qui ne veulent
-- pas encore réserver un créneau dans l'agenda. Ne jamais rapprocher cette
-- table de `users` par un join implicite sur l'email, une même adresse peut
-- déposer une demande des mois avant de créer un compte, ou jamais.
--
-- L'IP est hachée, pas stockée en clair : elle ne sert qu'à repérer un
-- envoi en boucle, ce qui n'exige pas de savoir de quelle IP il s'agit. Le
-- sel vient de ENCRYPTION_SECRET, déjà présent dans tous les environnements.

CREATE TABLE IF NOT EXISTS expert_contact_requests (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  company     TEXT,
  crm         TEXT,
  lang        TEXT        NOT NULL DEFAULT 'fr',
  source      TEXT        NOT NULL DEFAULT 'landing',
  ip_hash     TEXT,
  notified_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expert_contact_created
  ON expert_contact_requests (created_at DESC);

-- Recherche par adresse lors d'un rappel : l'index doit porter sur la même
-- expression que la requête, d'où le LOWER() des deux côtés.
CREATE INDEX IF NOT EXISTS idx_expert_contact_email
  ON expert_contact_requests (LOWER(email));

COMMENT ON TABLE expert_contact_requests IS
  'Demandes d''échange déposées depuis la landing. Prospects sans compte : '
  'aucune clé étrangère vers users, le rapprochement est manuel.';

COMMENT ON COLUMN expert_contact_requests.notified_at IS
  'Date d''envoi de la notification interne. NULL = la demande est arrivée '
  'mais l''email n''est pas parti (RESEND_API_KEY absente ou envoi en échec), '
  'la ligne reste exploitable.';

ALTER TABLE expert_contact_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON expert_contact_requests FROM anon, authenticated;
