-- 126 : l'AFFAIRE, que baakalai écrivait sur la ligne d'une personne. Lot 4 du
-- plan docs/plan-modele-comptes-et-decouverte-crm.md.
--
-- La migration 124 a donné une table aux sociétés, la 125 un rôle aux
-- contacts. Il reste le niveau du milieu, et c'est celui qui fait perdre des
-- données : `opportunities` porte une ligne par CONTACT, avec un seul
-- `crm_deal_id`, un seul montant, une seule étape. Deux affaires sur la même
-- personne ne tiennent donc pas dans le modèle · la plus récemment modifiée
-- réclame la ligne, les autres sont comptées (`collisions` dans
-- lib/deal-lifecycle-sync.js) et perdues.
--
-- Et un compte qui porte à la fois une affaire gagnée et une affaire ouverte,
-- c'est exactement la définition de l'upsell. Tant que les deux ne peuvent pas
-- coexister, le deuxième des quatre jobs du produit est invisible par
-- construction.
--
-- ── Pourquoi cette migration ne casse rien ──────────────────────────────────
--
-- Elle est purement ADDITIVE, et c'est délibéré. `opportunities` ne perd pas
-- une colonne : `status`, `deal_value`, `won_date`, `crm_stage` et les autres
-- restent là où elles sont, et continuent d'être la source de vérité de tous
-- les lecteurs. `deals` est écrite en parallèle par la synchro, personne ne la
-- lit encore.
--
-- C'est la méthode imposée par le plan (§5, lot 4) : double écriture, puis
-- bascule des lecteurs au lot 5, puis suppression des colonnes mortes au lot
-- 8. Pas de big bang. `opportunities` est référencée 295 fois dans 77 fichiers
-- et 15 tables portent une FK `opportunity_id` : tout déplacer en une passe
-- n'est pas un risque, c'est une certitude.
--
-- La mesure du lot 0 du 29/09 confirme que le coût est faible : sur les 55
-- colonnes d'`opportunities`, 16 sont remplies à 0 % en production, dont
-- `crm_deal_id`, `renewal_date`, `lost_reason`, `planned_followup_date`,
-- `reactivated_at` et `hubspot_deal_id`. Le lot déplace donc surtout des
-- colonnes vides.

CREATE TABLE IF NOT EXISTS deals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,

  -- La société qui porte l'affaire. C'est le rattachement PRINCIPAL, et c'est
  -- le renversement du lot 4 : jusqu'ici un deal sans contact primaire était
  -- jeté par un `continue` muet (lib/deal-lifecycle-sync.js), alors que son
  -- `AccountId` est toujours renseigné côté Salesforce. 308 affaires perdues
  -- sur 308 chez un beta testeur pour cette seule raison.
  account_id    UUID REFERENCES accounts(id) ON DELETE SET NULL,

  -- L'interlocuteur de cette affaire, quand le CRM le nomme. NULLABLE, et il
  -- faut lire ce NULL comme « le CRM ne dit pas qui », jamais comme « affaire
  -- sans valeur » : c'est précisément la confusion que le modèle précédent
  -- imposait.
  primary_contact_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  crm_provider  TEXT,
  crm_deal_id   TEXT,
  -- Doublon historique de crm_deal_id, conservé parce que le push vers HubSpot
  -- le lit encore (routes/crm.js). Rempli à 0 % en production.
  hubspot_deal_id TEXT,

  -- Le nom de l'affaire côté CRM. Les quatre connecteurs le remontent déjà
  -- dans leur forme normalisée et il était jeté : une ligne de contact n'avait
  -- pas de place pour le nom d'un deal, elle portait déjà celui de la personne.
  name          TEXT,

  -- open · won · lost. Tranché sur les drapeaux natifs du CRM (IsWon/IsClosed,
  -- hs_is_closed_won, statut Pipedrive, étape gagnante Odoo), jamais déduit du
  -- libellé d'étape.
  status        TEXT NOT NULL DEFAULT 'open',
  deal_value    DECIMAL,

  -- La DEVISE, qui n'existait nulle part (plan §9.5). Pipedrive remonte la
  -- vraie, Salesforce et HubSpot la codaient en dur à 'EUR'. Tant qu'un montant
  -- vivait sur une ligne de contact, l'approximation ne se voyait pas ; au
  -- niveau compte on SOMME du chiffre d'affaires, et mélanger EUR et USD
  -- produit un nombre faux et affiché.
  --
  -- Arbitrage Goran du 30/09 : on ne convertit JAMAIS. Pas de taux de change,
  -- pas de devise de référence, pas de montant dérivé. Tout agrégat de CA sera
  -- groupé par devise au lot 5, la devise dominante du tenant affichée, les
  -- autres signalées et exclues de la somme. Un chiffre juste et incomplet vaut
  -- mieux qu'un chiffre complet et faux, et c'est la même règle que le NULL
  -- d'icp-signals.js : inconnu ne vaut pas zéro.
  --
  -- NULL = le connecteur n'a pas su lire la devise. Ne jamais présumer EUR.
  currency      TEXT,

  won_date      TIMESTAMPTZ,
  lost_date     TIMESTAMPTZ,
  lost_reason   TEXT,
  lost_reason_source TEXT,

  -- Date de clôture PRÉVUE, à ne pas confondre avec won_date/lost_date qui sont
  -- des dates constatées. C'est le champ de forecast, lu par Salesforce
  -- (CloseDate) et HubSpot (closedate) depuis toujours, puis jeté faute de
  -- colonne. Conséquence déjà en production : routes/analytics.js:1193 lit
  -- `o.close_date`, une colonne qui n'existe pas, donc cette branche est morte
  -- et l'export renouvellement retombe systématiquement sur won_date + 365
  -- jours. Bug silencieux, réparé par la simple existence de la colonne.
  close_date    TIMESTAMPTZ,
  renewal_date  TIMESTAMPTZ,

  crm_stage     TEXT,
  crm_stage_id  TEXT,
  crm_stage_changed_at TIMESTAMPTZ,
  -- Le pipeline d'origine. Pipedrive et HubSpot en ont plusieurs par portail et
  -- l'étape seule ne suffit pas à situer une affaire : « Négociation » n'a pas
  -- le même sens dans un pipeline « Nouveaux clients » et dans un pipeline
  -- « Renouvellements ». Salesforce et Odoo n'ont pas la notion, la colonne
  -- reste NULL chez eux.
  crm_pipeline_id TEXT,
  crm_pipeline_name TEXT,

  -- Deuxième des trois dates de création (plan §9.6) · celle du COMPTE est
  -- arrivée au lot 2, celle du CONTACT existe depuis la migration 113. Celle-ci
  -- répond à « depuis quand cette affaire est ouverte », donc elle mesure la
  -- stagnation et la vitesse du pipeline, deux choses qu'aucune des deux autres
  -- ne sait dire.
  crm_created_at TIMESTAMPTZ,
  crm_updated_at TIMESTAMPTZ,

  -- Récence de l'AFFAIRE. Troisième et dernier niveau de last_activity_at, et
  -- la raison d'être de la répartition (plan §9.4) : une colonne unique servait
  -- à la fois au churn du compte et à la stagnation du deal, qui ne se mesurent
  -- pas sur le même objet. C'est la racine du recalibrage du churn au lot 5.
  last_activity_at TIMESTAMPTZ,

  -- La relance planifiée est SCINDÉE, pas déplacée (plan §9.4). Ce qui porte
  -- sur l'affaire vient ici : les raisons 'crm_sync' (le commercial a posé une
  -- date dans le CRM) et 'not_now'. Ce qui porte sur la personne reste sur le
  -- contact, dans `opportunities.cooldown_until` créée plus bas.
  planned_followup_date TIMESTAMPTZ,
  planned_followup_reason TEXT,

  reactivated_at TIMESTAMPTZ,
  reactivated_from_email_id UUID REFERENCES nurture_emails(id) ON DELETE SET NULL,
  -- PAR QUI l'affaire a été réactivée. Sans cette colonne on sait qu'un deal
  -- mort est reparti sans savoir à quel interlocuteur l'écrire, ce qui est
  -- justement le signal d'apprentissage le plus fort du produit.
  reactivated_contact_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  -- Le troisième owner (plan §9.4). Un Salesforce en porte trois, souvent
  -- différents : le compte à l'account manager, l'affaire au commercial, le
  -- contact à personne. baakalai n'en avait qu'un jeu, posé sur le contact ;
  -- l'owner affiché sur un deal était donc celui de la personne, jamais celui
  -- de l'affaire.
  owner_id      UUID REFERENCES users(id),
  owner_email   TEXT,
  crm_owner_id  TEXT,

  -- crm_role · le CRM a nommé lui-même le contact de cette affaire
  -- inferred  · baakalai l'a deviné (migration 123)
  -- user      · un humain a confirmé le porteur
  -- account   · l'affaire n'est rattachée qu'à sa société, et c'est honnête ·
  --             valeur NOUVELLE au lot 4, impossible avant puisqu'un deal sans
  --             contact n'avait pas de ligne où exister.
  crm_deal_attribution TEXT,

  -- Un état de push par NIVEAU : on pousse des champs de compte, d'affaire et
  -- de contact séparément, un état unique ne pouvait pas les représenter.
  crm_push_state JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une affaire du CRM est identifiée par son id natif. Index PARTIEL, même
-- raisonnement que sur `accounts` : une affaire créée dans baakalai n'a pas
-- encore d'id CRM, et en SQL deux NULL ne sont jamais égaux, donc une
-- contrainte nue laisserait passer tous les doublons.
CREATE UNIQUE INDEX IF NOT EXISTS deals_crm_unique
  ON deals (user_id, crm_provider, crm_deal_id)
  WHERE crm_deal_id IS NOT NULL;

-- Chemins de lecture du lot 5 : les affaires d'un compte (upsell : un compte
-- qui porte un gagné et un ouvert), celles d'un contact, et le balayage par
-- utilisateur.
CREATE INDEX IF NOT EXISTS deals_user_idx ON deals (user_id);
CREATE INDEX IF NOT EXISTS deals_account_idx ON deals (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_contact_idx ON deals (primary_contact_id) WHERE primary_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_user_status_idx ON deals (user_id, status);

-- Même verrou que toutes les tables porteuses de données personnelles : le
-- backend passe par le rôle de service, la clé anonyme ne lit rien. Sans cette
-- ligne la table serait interrogeable depuis n'importe quel navigateur avec la
-- clé publique, la faille trouvée sur `users` le 27/07.
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE deals IS
  'Affaires du CRM. Un compte porte N deals, dont un gagné et un ouvert en même temps · c''est ça, l''upsell. Écrite en double avec les colonnes de deal restées sur opportunities (lot 4) ; les lecteurs basculent au lot 5, les colonnes mortes disparaissent au lot 8.';

COMMENT ON COLUMN deals.currency IS
  'Devise d''origine du montant, jamais convertie (arbitrage Goran 30/09). NULL = le connecteur n''a pas su la lire, ne jamais présumer EUR. Les agrégats de CA se groupent par devise et n''additionnent pas deux devises.';

COMMENT ON COLUMN deals.close_date IS
  'Date de clôture PRÉVUE (forecast), distincte de won_date/lost_date qui sont constatées. Lue par Salesforce et HubSpot depuis toujours puis jetée faute de colonne : routes/analytics.js lisait déjà o.close_date, inexistante.';

COMMENT ON COLUMN deals.account_id IS
  'La société de l''affaire, et son rattachement principal. Un deal dont le CRM ne nomme aucun contact existe désormais, au lieu d''être jeté par un continue muet.';

-- ── Le cooldown, moitié contact de la relance planifiée ─────────────────────
--
-- `opportunities.planned_followup_date` mélangeait deux choses : une date qui
-- porte sur l'affaire ('crm_sync', 'not_now') et une date qui porte sur la
-- personne ('post_send_cooldown', 'reply_requested_date'). La première monte
-- dans `deals` ci-dessus, la seconde reste ici sous son vrai nom.
--
-- Ce n'est pas cosmétique : au lot 6, l'envoi devient multi-threadé au niveau
-- compte. Écrire à trois interlocuteurs d'une même société sans cooldown par
-- personne est exactement le scénario qui fait classer un domaine en spam.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS cooldown_until TIMESTAMPTZ;

-- La date de clôture prévue existe aussi côté contact, et c'est la moitié
-- « double écriture » de deals.close_date. Sans elle, créer la colonne sur
-- `deals` ne répare rien : le lecteur est routes/analytics.js:1193, il lit
-- `o.close_date` sur `opportunities`, et cette branche est morte depuis
-- toujours · l'export renouvellement retombe donc systématiquement sur
-- won_date + 365 jours. La colonne remplie par la synchro rend la branche
-- vivante tout de suite, sans attendre que le lot 5 bascule les lecteurs.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS close_date TIMESTAMPTZ;

COMMENT ON COLUMN opportunities.close_date IS
  'Miroir de deals.close_date le temps de la double écriture (lot 4). Répare routes/analytics.js:1193, qui lisait une colonne inexistante. Disparaît au lot 8 avec les autres colonnes de deal.';

COMMENT ON COLUMN opportunities.cooldown_until IS
  'Jusqu''à quand cette PERSONNE ne doit pas être recontactée (on vient de lui écrire, ou elle a demandé une date). Moitié contact de planned_followup_date, dont la moitié affaire monte sur deals. Indispensable au multi-threading du lot 6.';

-- ── Les tables filles apprennent à pointer une affaire ──────────────────────
--
-- Trois tables historisent aujourd'hui des faits d'AFFAIRE sur une clé de
-- CONTACT. Elles gagnent `deal_id` en plus, jamais à la place : tant que le
-- lot 5 n'a pas basculé les lecteurs, `opportunity_id` reste renseignée et
-- fait autorité. Deux colonnes le temps de la transition est le prix de la
-- double écriture.
ALTER TABLE opportunity_stage_history
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE churn_score_history
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE CASCADE;

ALTER TABLE churn_outcomes
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stage_history_deal
  ON opportunity_stage_history (deal_id, changed_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_churn_score_history_deal
  ON churn_score_history (deal_id, scored_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_churn_outcomes_deal
  ON churn_outcomes (deal_id) WHERE deal_id IS NOT NULL;
