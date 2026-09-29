-- 124 : la SOCIÉTÉ, que baakalai n'a jamais su nommer. Lot 2 du plan
-- docs/plan-modele-comptes-et-decouverte-crm.md.
--
-- Jusqu'ici le produit n'a qu'une table `opportunities`, une ligne par
-- CONTACT, avec `company` en texte libre et l'état du deal écrit sur la ligne
-- de la personne. Tout ce qui est vrai d'une entreprise est donc soit
-- introuvable, soit répété autant de fois qu'elle a d'interlocuteurs.
--
-- Ce que ça coûte aujourd'hui, mesuré et pas supposé :
--
--   · un compte n'a pas de commercial à lui, il en a autant que de contacts.
--     Le propriétaire affiché sur un deal est celui du CONTACT, jamais celui
--     du deal : aucun des quatre connecteurs ne lit l'owner de l'affaire.
--   · un deal Salesforce sans OpportunityContactRole n'a personne à qui se
--     rattacher, alors que son `AccountId` est TOUJOURS renseigné. 308 deals
--     sur 308 perdus chez un beta testeur, et une déduction à la place
--     (migration 123) qui restera fausse de temps en temps.
--   · `icp_crm_history_months` se calcule sur le contact le plus ancien
--     (lib/icp-signals.js), alors qu'un contact naît en même temps que son
--     compte ou après. L'ancienneté de la relation est donc sous-estimée, et
--     le critère « au moins 12 mois d'historique » produit des faux négatifs.
--   · l'upsell est invisible : c'est un compte qui porte à la fois un deal
--     gagné et un deal ouvert, et rien ne permet de voir les deux ensemble.
--
-- ── Ce que cette migration fait, et ne fait pas ─────────────────────────────
--
-- Purement ADDITIVE. `opportunities` ne perd pas une colonne, aucun écran ni
-- aucun job ne change de source. `account_id` est renseigné à l'import et lu
-- plus tard : tant qu'il est NULL, tout se comporte exactement comme avant.
-- Le déménagement des colonnes de deal est le lot 4, et il est dangereux ;
-- celui-ci ne l'est pas.

CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- NULL pour un compte DÉRIVÉ, c'est-à-dire reconstruit à partir du nom de
  -- société d'un contact quand le CRM n'expose aucun objet compte (Notion,
  -- Airtable, Folk, import CSV). Voir `source`.
  crm_provider  TEXT,
  crm_account_id TEXT,

  name          TEXT NOT NULL,
  -- Minuscules, accents et ponctuation retirés, formes juridiques ôtées.
  -- Calculé par l'applicatif et stocké, pour que la dédup ne dépende pas de la
  -- collation Postgres. Mesuré le 29/09 sur la prod : 226 comptes, ZÉRO
  -- variante de nom · une normalisation simple suffit, il n'y a pas de moteur
  -- de fusion à construire.
  name_normalized TEXT NOT NULL,
  domain        TEXT,
  industry      TEXT,
  size          TEXT,

  -- L'owner du COMPTE, distinct de celui du contact et de celui du deal. Les
  -- trois existent dans un Salesforce et sont souvent différents : c'est
  -- pourquoi l'owner ne DÉMÉNAGE pas ici, il s'y ajoute (plan §9.4).
  owner_id      UUID REFERENCES users(id),
  owner_email   TEXT,
  crm_owner_id  TEXT,

  -- Date de création CÔTÉ CRM, celle qui dit depuis quand la relation existe.
  -- C'est elle qui répare icp_crm_history_months. listAccounts() la remonte
  -- déjà chez Salesforce, il n'y avait que la colonne qui manquait.
  crm_created_at TIMESTAMPTZ,

  -- Récence au niveau du compte · un compte n'est pas silencieux parce qu'un
  -- de ses contacts l'est (arbitrage UX du 29/09, §12.3 du plan). Renseignée
  -- au lot 5, quand les jobs seront recâblés ; déclarée ici pour que la table
  -- n'ait pas à être modifiée deux fois.
  last_activity_at TIMESTAMPTZ,

  -- crm     · le CRM expose un objet compte et l'a nommé
  -- derived · reconstruit à partir du nom de société d'un contact
  source        TEXT NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'derived')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un compte du CRM est identifié par son id natif. Index PARTIEL : les comptes
-- dérivés n'ont pas de crm_account_id, et en SQL deux NULL ne sont jamais
-- égaux, donc une contrainte nue les laisserait tous passer en double.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_crm_unique
  ON accounts (user_id, crm_provider, crm_account_id)
  WHERE crm_account_id IS NOT NULL;

-- Un compte dérivé est identifié par son nom normalisé. Même raisonnement en
-- miroir : la contrainte ne vaut que pour eux, sinon deux sociétés homonymes
-- venant de deux CRM différents entreraient en collision.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_derived_unique
  ON accounts (user_id, name_normalized)
  WHERE crm_account_id IS NULL;

-- Chemin de lecture chaud : « les comptes de cet utilisateur », et le
-- rapprochement par nom au backfill.
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id);
CREATE INDEX IF NOT EXISTS accounts_user_name_idx ON accounts (user_id, name_normalized);

-- Même verrou que toutes les tables porteuses de données personnelles ici : le
-- backend passe par le rôle de service, la clé anonyme ne lit rien. Sans cette
-- ligne, la table serait interrogeable depuis n'importe quel navigateur avec
-- la clé publique. C'est la faille trouvée sur `users` le 27/07.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE accounts IS
  'Sociétés du CRM de l''utilisateur. Un compte porte N contacts (opportunities.account_id) et, au lot 4, N deals. NULLABLE partout côté opportunities : tant que account_id est NULL, le produit se comporte comme avant la migration 124.';

COMMENT ON COLUMN accounts.name_normalized IS
  'Nom réduit pour la dédup : minuscules, sans accents, sans ponctuation, sans forme juridique. Calculé par lib/account-name.js, stocké pour ne pas dépendre de la collation.';

COMMENT ON COLUMN accounts.source IS
  'crm = le CRM expose un objet compte. derived = reconstruit depuis le nom de société d''un contact, pour les CRM qui n''en ont pas (Notion, Airtable, Folk, CSV).';

-- Le lien contact -> compte. Nullable, sans valeur par défaut, et personne ne
-- le lit encore : c'est ce qui rend cette migration sans risque.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS opportunities_account_idx
  ON opportunities (account_id) WHERE account_id IS NOT NULL;

COMMENT ON COLUMN opportunities.account_id IS
  'Société de ce contact (migration 124). NULL = pas encore rattaché, le produit se comporte alors exactement comme avant.';
