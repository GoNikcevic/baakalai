-- 131 : le churn passe au COMPTE. Lot 5 du plan
-- docs/plan-modele-comptes-et-decouverte-crm.md.
--
-- Les lots 2 à 4 ont donné au produit ses trois niveaux : la société
-- (migration 124), le rôle du contact (125), l'affaire (126). Tout ça était du
-- rangement. Le lot 5 est le premier à changer ce que baakalai AFFIRME.
--
-- ── Pourquoi le churn ne peut pas rester sur le contact ─────────────────────
--
-- `opportunities.churn_score` répond à « cette personne est-elle silencieuse ».
-- Ce n'est pas la question qui intéresse un commercial. Un client qui part,
-- c'est une SOCIÉTÉ qui part, et aucune somme de scores de contacts ne le dit :
-- une société à huit interlocuteurs produit huit scores dont sept sont élevés
-- en permanence, parce que sept personnes sur huit ne sont jamais celle à qui
-- on parle. La liste « Clients à risque » est aujourd'hui une liste de
-- personnes, et elle compte le même client autant de fois qu'il a de contacts.
--
-- ── L'arbitrage du 2026-10-01 : le contact le plus récent fait foi ──────────
--
-- Un compte est silencieux depuis la dernière activité de N'IMPORTE LEQUEL de
-- ses contacts, et les seuils de lib/churn-scoring.js (30, 60, 90, 120 jours)
-- ne bougent pas.
--
-- C'est volontairement le choix le plus PRUDENT des quatre examinés. Un compte
-- à cinq contacts devient difficile à flaguer, puisqu'il suffit qu'un seul
-- d'entre eux ait bougé. On accepte des faux négatifs pour n'avoir presque
-- aucun faux positif, et c'est le bon sens de l'erreur ici : une alerte de
-- churn qui se trompe coûte la confiance dans la liste entière, et une liste à
-- laquelle on ne croit plus n'est plus ouverte. Le risque assumé est connu et
-- écrit : un compte où seul un opérationnel répond encore passe pour vivant
-- alors que le décideur est parti.
--
-- Deux garde-fous rendent ce choix révisable sans nouvelle migration :
-- `churn_factors` garde la trace du contact qui a porté la décision, et
-- `churn_score_history` est horodatée par compte. Le jour où de vrais
-- dénouements existent (zéro à ce jour en production), la comparaison entre le
-- score passé et le sort réel du compte dira si le seuil est trop lâche.
--
-- ── Purement additive ───────────────────────────────────────────────────────
--
-- `opportunities.churn_score` RESTE, et reste écrit par le même code. Le score
-- de compte s'ajoute à côté. C'est la même méthode de double écriture que le
-- lot 4 : les écrans basculent quand ils basculent, et tant qu'ils lisent le
-- contact, ils voient exactement ce qu'ils voyaient hier.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS churn_score INT;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS churn_factors JSONB;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS churn_scored_at TIMESTAMPTZ;

-- Date de FRANCHISSEMENT du seuil vers le haut, pas état courant. Même rôle et
-- même piège que opportunities.churn_flagged_at (migration 109) : c'est elle
-- qui permet au déclencheur « client à risque » de matcher un compte UNE fois
-- au lieu de le reproposer à chaque passage du cron.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS churn_flagged_at TIMESTAMPTZ;

COMMENT ON COLUMN accounts.churn_score IS
  'Risque de perte de la SOCIÉTÉ, 0 à 100. Calculé sur l''activité la plus récente tous contacts confondus (arbitrage Goran 2026-10-01), seuils identiques à ceux du contact. NULL = jamais scoré, à ne pas lire comme 0.';

COMMENT ON COLUMN accounts.churn_factors IS
  'Les signaux qui ont fait le score, dont le contact qui porte la dernière activité. C''est ce qui rend l''arbitrage du 2026-10-01 révisable sans migration : on sait toujours qui a maintenu le compte en vie.';

COMMENT ON COLUMN accounts.churn_flagged_at IS
  'Quand ce compte est passé AU-DESSUS du seuil, pas depuis quand il y est. NULL dès qu''il repasse dessous. Sans cette distinction, un déclencheur d''automatisation reproposerait le même client à chaque run.';

-- La question posée par la page Clients à risque et par le badge de nav :
-- « les comptes à risque de cet utilisateur ». Index PARTIEL, le seuil est
-- AT_RISK_THRESHOLD = 60 dans lib/churn-scoring.js : les comptes sains sont la
-- majorité et n'ont pas à peser dans l'index.
CREATE INDEX IF NOT EXISTS accounts_at_risk_idx
  ON accounts (user_id, churn_score DESC)
  WHERE churn_score >= 60;

-- ── L'historique apprend à pointer un compte ────────────────────────────────
--
-- Même patron que `deal_id` au lot 4 : la colonne s'ajoute, `opportunity_id`
-- reste renseignée et fait autorité tant que les lecteurs n'ont pas basculé.
-- Sans elle, un score de compte ne serait comparable à rien, et c'est
-- précisément cette comparaison qui doit trancher plus tard si le seuil tient.
ALTER TABLE churn_score_history
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_churn_score_history_account
  ON churn_score_history (account_id, scored_at DESC) WHERE account_id IS NOT NULL;

-- `opportunity_id` était NOT NULL : la table ne savait historiser qu'un CONTACT.
-- Une ligne de compte n'a pas de contact à mettre dedans, et y glisser le
-- contact principal serait un mensonge qui polluerait son propre historique.
-- La colonne devient donc facultative, remplacée par une contrainte qui dit la
-- vraie règle : une ligne d'historique porte sur un contact OU sur un compte,
-- jamais sur rien.
ALTER TABLE churn_score_history ALTER COLUMN opportunity_id DROP NOT NULL;

ALTER TABLE churn_score_history DROP CONSTRAINT IF EXISTS churn_score_history_subject_check;
ALTER TABLE churn_score_history ADD CONSTRAINT churn_score_history_subject_check
  CHECK (opportunity_id IS NOT NULL OR account_id IS NOT NULL);

-- Le dénouement se constate aussi au niveau du compte : c'est la société qui
-- est perdue ou sauvée, pas la personne. Sans cette colonne, le jour où un
-- dénouement arrive, il resterait attaché à un contact et ne pourrait pas
-- valider le score de compte qui l'avait annoncé.
ALTER TABLE churn_outcomes
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_churn_outcomes_account
  ON churn_outcomes (account_id) WHERE account_id IS NOT NULL;

-- ── Dette des migrations 129 et 130, rattrapée ici ──────────────────────────
--
-- Les deux ont créé leur table sans ENABLE ROW LEVEL SECURITY, contrairement
-- aux 124, 126 et 127. Constaté le 2026-10-01 en comparant les deux bases : sur
-- STAGING les deux tables sont restées ouvertes, sur la production Supabase a
-- posé la RLS lui-même à la création. C'est donc staging qui était le laxiste,
-- l'inverse de ce qu'on attend.
--
-- Rien ne casse aujourd'hui, le backend passe par le rôle de service qui
-- contourne la RLS. Mais c'est la forme exacte de la faille trouvée sur `users`
-- le 2026-07-27 : table lisible depuis n'importe quel navigateur avec la clé
-- publique. `data_quality_ignores` dit quels contacts un utilisateur a écartés,
-- `crm_owner_mappings` nomme les membres de son équipe.
--
-- Idempotent : ENABLE sur une table qui l'a déjà ne fait rien.
ALTER TABLE data_quality_ignores ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_owner_mappings ENABLE ROW LEVEL SECURITY;
