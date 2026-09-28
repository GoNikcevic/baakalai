-- 120 : opposition d'un CONTACT à recevoir les emails d'un utilisateur.
--
-- À ne pas confondre avec les migrations 101 et 110, qui portent les
-- préférences d'un UTILISATEUR sur les emails que baakalai lui adresse. Ici
-- c'est l'inverse : la personne au bout de la chaîne, le prospect ou le
-- client, qui refuse les relances envoyées depuis la boîte de l'utilisateur.
--
-- Obligatoire, et pas seulement recommandé. En B2B c'est le CONSENTEMENT
-- préalable qui est assoupli, jamais le droit d'opposition : l'article
-- L.34-5 du code des postes et communications électroniques exige un moyen
-- de s'opposer dès le premier message, et l'article 21 du RGPD rend ce droit
-- absolu, sans intérêt légitime opposable. Gmail et Yahoo l'exigent en plus
-- techniquement (RFC 8058) au-dessus de leurs seuils de volume.
--
-- POURQUOI UNE TABLE ET NON UNE COLONNE SUR `opportunities` :
--
--   1. Un contact peut être démarché avant d'exister en base. La prospection
--      remonte des personnes depuis le web, l'opposition doit pouvoir être
--      enregistrée même sans ligne `opportunities` correspondante.
--   2. Une colonne serait effacée au réimport du CRM. Une opposition qui
--      disparaît parce qu'on a resynchronisé Pipedrive est une violation,
--      pas un bug d'affichage. Elle doit survivre à tout.
--   3. La même adresse existe souvent en plusieurs lignes : le produit a
--      justement une fonction de dédoublonnage. Une opposition doit valoir
--      pour l'adresse, pas pour une ligne.
--
-- POURQUOI UN HACHÉ EN PLUS DE L'ADRESSE :
--
-- Le lien de désinscription part dans un email et se retrouve dans des URL,
-- donc dans les journaux de serveurs, les référents et les historiques de
-- navigateur. Y faire figurer l'adresse du destinataire, même encodée,
-- reviendrait à la disséminer. Le jeton ne porte donc que `email_hash`, un
-- HMAC-SHA256 non réversible. L'adresse en clair reste ici, dans la base de
-- l'utilisateur, parce que c'est SON contact et qu'il doit pouvoir savoir
-- qui s'est désinscrit.

CREATE TABLE IF NOT EXISTS contact_optouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Adresse normalisée en minuscules par l'applicatif. Visible par
  -- l'utilisateur, jamais transmise dans une URL.
  --
  -- NULLABLE, et c'est le cas NORMAL : le lien de désinscription ne porte que
  -- le haché, donc au moment du clic on ne connaît pas l'adresse. La poser en
  -- NOT NULL fait échouer toute désinscription réelle sur une violation de
  -- contrainte. Elle n'est renseignée que lorsque l'appelant la connaît
  -- déjà, pour que l'utilisateur puisse voir qui s'est désinscrit.
  email       TEXT,

  -- HMAC-SHA256(ENCRYPTION_SECRET, email). Seule valeur qui circule.
  email_hash  TEXT NOT NULL,

  -- 'one_click' (RFC 8058, le client mail a agi seul), 'link' (clic humain
  -- sur le lien du pied de page), 'manual' (l'utilisateur l'a saisi depuis
  -- l'application), 'reply' (l'analyse de la réponse a conclu à un refus).
  source      TEXT NOT NULL DEFAULT 'link',

  -- Contexte au moment du refus, utile pour tracer une contestation. Nullable :
  -- une opposition posée à la main n'a ni l'un ni l'autre.
  user_agent  TEXT,
  ip_hash     TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L'opposition vaut par utilisateur, et non globalement : chaque utilisateur
-- est responsable de traitement pour sa propre base, et une opposition
-- exprimée auprès de l'un n'a pas à priver l'autre d'une relation qui lui est
-- propre. C'est aussi la clé d'idempotence : recliquer un vieux lien ne crée
-- pas de doublon.
CREATE UNIQUE INDEX IF NOT EXISTS contact_optouts_user_hash_uniq
  ON contact_optouts (user_id, email_hash);

-- Chemin de lecture chaud : vérifié avant CHAQUE envoi, dans
-- lib/contact-optout.isOptedOut. Doit rester un index unique scan.
CREATE INDEX IF NOT EXISTS contact_optouts_user_email_idx
  ON contact_optouts (user_id, email);

-- RLS active sans aucune politique : c'est le verrou appliqué à toutes les
-- tables porteuses de données personnelles ici (`users`, `opportunities`,
-- `nurture_emails`, `email_accounts`...). Le backend passe par le rôle de
-- service, qui contourne RLS ; la clé anonyme, elle, ne lit rien. Sans cette
-- ligne, la table serait interrogeable depuis n'importe quel navigateur avec
-- la clé publique, et elle contient des adresses de contacts. C'est
-- exactement la faille trouvée sur `users` le 27/07.
ALTER TABLE contact_optouts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE contact_optouts IS
  'Contacts ayant refusé les emails d''un utilisateur donné. Vérifié avant '
  'chaque envoi dans lib/email-outbound.sendPersonalEmail. Ne jamais purger '
  'par une règle de rétention : une opposition est sans limite de durée.';

COMMENT ON COLUMN contact_optouts.email_hash IS
  'HMAC-SHA256 de l''adresse. Seule valeur portée par le lien de '
  'désinscription, pour ne pas faire circuler l''adresse dans les URL.';
