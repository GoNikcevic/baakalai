-- 127 : ce que baakalai comprend de l'ARCHITECTURE du CRM. Lot 1 du plan
-- docs/plan-modele-comptes-et-decouverte-crm.md.
--
-- Le modèle à trois niveaux (migrations 124 à 126) dit OÙ RANGER. Il ne dit
-- pas COMMENT RECONNAÎTRE, et c'est un problème distinct.
--
-- Deux Salesforce au schéma rigoureusement identique peuvent être utilisés de
-- façon opposée. Un client peut être un Account avec `Type = Customer`, une
-- Opportunity gagnée, un `Contrat__c` maison, ou un pipeline Pipedrive que
-- quelqu'un a nommé « Clients ». baakalai code aujourd'hui `IsWon` -> client
-- en dur : c'est vrai chez certains, faux chez d'autres, et rien ne permet de
-- savoir chez qui.
--
-- Ces deux tables sont la mémoire de ce que baakalai a MESURÉ puis DÉDUIT du
-- CRM de chaque utilisateur, séparément.
--
-- ── Pourquoi deux tables et pas une ─────────────────────────────────────────
--
-- `crm_architecture_profiles` garde la MESURE : quels objets existent, lequel
-- contient des données récentes, quel champ est rempli à 90 % et lequel à 3 %.
-- Elle est horodatée et conservée, parce que c'est la comparaison de deux
-- mesures qui détecte une dérive (un champ neuf qui se remplit, une
-- distribution de stages qui bascule). Une table écrasée à chaque passage ne
-- peut rien détecter du tout.
--
-- `crm_architecture_mappings` garde la DÉDUCTION, une ligne par objet et par
-- champ interprété, avec sa confiance, sa preuve et son origine. C'est elle
-- que les jobs liront, au lieu d'un nom de champ écrit en dur.
--
-- Séparer les deux permet de rejouer une inférence sur un profil déjà mesuré,
-- et de montrer à l'utilisateur la preuve à côté de la conclusion. Un mappage
-- qu'on ne peut pas justifier, personne ne le corrigera.
--
-- ── Ce que ce lot ne fait PAS ───────────────────────────────────────────────
--
-- Rien ne lit encore ces tables. Le moteur tourne en OBSERVATION : il mesure,
-- il déduit, il se montre, et les connecteurs continuent exactement comme
-- avant. C'est ce qui permet de comparer ses déductions au comportement actuel
-- avant d'en dépendre.
--
-- ── RGPD ────────────────────────────────────────────────────────────────────
--
-- `profile` ne contient QUE des agrégats : des noms de champs, des types, des
-- taux de remplissage, des cardinalités, et les libellés des listes de choix
-- (qui sont du schéma, pas de la donnée). Aucune valeur de champ d'un
-- enregistrement réel n'y entre, et c'est ce qui permet de le soumettre à
-- Claude. L'échantillon qui sert à calculer ces taux est lu, agrégé et jeté
-- côté serveur, il ne sort jamais.

CREATE TABLE IF NOT EXISTS crm_architecture_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crm_provider TEXT NOT NULL,

  -- Le profil agrégé, tel qu'il est soumis à l'inférence. Voir l'en-tête : que
  -- des agrégats, jamais une valeur d'enregistrement.
  profile JSONB NOT NULL,

  objects_seen INT NOT NULL DEFAULT 0,
  fields_seen INT NOT NULL DEFAULT 0,
  -- Les objets maison. Comptés à part parce qu'ils ne sont JAMAIS interprétés
  -- seuls (décision 5 du plan) : ils sont signalés à l'utilisateur, qui les
  -- mappe. Un `Contrat__c` peut être le coeur du métier comme un vestige.
  custom_objects INT NOT NULL DEFAULT 0,

  measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_arch_profiles_user
  ON crm_architecture_profiles (user_id, crm_provider, measured_at DESC);

ALTER TABLE crm_architecture_profiles ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE crm_architecture_profiles IS
  'Mesure horodatée de l''usage réel du CRM d''un utilisateur. Conservée et non écrasée : c''est la comparaison de deux mesures qui détecte une dérive. Agrégats uniquement, aucune valeur d''enregistrement.';

CREATE TABLE IF NOT EXISTS crm_architecture_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crm_provider TEXT NOT NULL,

  -- Le nom TECHNIQUE, celui qu'un connecteur peut réutiliser tel quel
  -- ('Account', 'crm.lead', 'deals'), et le libellé lisible à côté.
  object_name TEXT NOT NULL,
  object_label TEXT,

  -- NULL = la déduction porte sur l'OBJET lui-même (« Account joue la
  -- société »). Renseigné = elle porte sur un champ de cet objet
  -- (« Account.Type porte le cycle de vie »).
  field_name TEXT,
  field_label TEXT,

  -- Objet ou champ maison. Un objet custom n'est jamais interprété seul :
  -- baakalai le signale avec 'unknown' et attend que l'utilisateur tranche.
  is_custom BOOLEAN NOT NULL DEFAULT false,

  -- Ce que cet objet ou ce champ JOUE dans le modèle baakalai.
  --   objets · account · person · deal · activity
  --   champs · lifecycle · amount · currency · close_date · created_at
  --            owner · name · email · account_link
  --   les deux · unknown, qui veut dire « vu, pas compris », jamais « vide »
  -- La liste tient sur UNE ligne, et ce n'est pas un choix esthétique : le
  -- garde-fou tests/schema-mirror.test.js lit ces fichiers ligne par ligne et
  -- prendrait les valeurs d'une contrainte étalée pour des noms de colonnes.
  -- Même forme que crm_stage_mappings.baakalai_status (migration 121).
  baakalai_role TEXT NOT NULL
    CHECK (baakalai_role IN ('account', 'person', 'deal', 'activity', 'lifecycle', 'amount', 'currency', 'close_date', 'created_at', 'owner', 'name', 'email', 'account_link', 'unknown')),

  -- rule · l'API l'affirme elle-même · ai · déduit par Claude sur le profil
  -- agrégé · user · corrigé à la main, et alors plus jamais réécrit.
  source TEXT NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ai', 'user')),

  -- 1 pour une règle, la confiance du modèle pour une déduction. C'est elle
  -- qui décide du comportement (garde-fou du plan §4) : haute, on applique et
  -- on montre · moyenne, on applique et on demande confirmation · basse, on
  -- demande avant d'appliquer.
  confidence NUMERIC(3, 2),

  -- La PREUVE, en une phrase : « Type = Customer marque tes clients, parce que
  -- 87 % des comptes qui le portent ont au moins une Opportunity gagnée ».
  reasoning TEXT,
  -- Les chiffres derrière la phrase, pour que l'écran puisse les montrer sans
  -- relire tout le profil.
  evidence JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule ligne par objet et par champ. COALESCE et non `field_name` nu : en
-- SQL, NULL n'est jamais égal à NULL, donc une contrainte directe laisserait
-- entrer autant de lignes « objet » que d'analyses. Même piège que sur
-- crm_stage_mappings.pipeline_id (migration 121).
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_arch_mappings_unique
  ON crm_architecture_mappings (user_id, crm_provider, object_name, COALESCE(field_name, ''));

CREATE INDEX IF NOT EXISTS idx_crm_arch_mappings_user
  ON crm_architecture_mappings (user_id, crm_provider);

ALTER TABLE crm_architecture_mappings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE crm_architecture_mappings IS
  'Ce que baakalai a déduit de l''architecture du CRM : quel objet joue la société, la personne, l''affaire, et quel champ porte le cycle de vie, le montant, la date de vérité. Une ligne source=user ne doit JAMAIS être réécrite par une passe automatique.';

COMMENT ON COLUMN crm_architecture_mappings.baakalai_role IS
  'unknown veut dire vu mais pas compris, jamais vide. Un objet maison y reste tant que l''utilisateur n''a pas tranché : le plan interdit d''interpréter un objet custom seul.';
