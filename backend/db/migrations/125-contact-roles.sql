-- 125 : qui est qui dans un compte. Lot 3 du plan
-- docs/plan-modele-comptes-et-decouverte-crm.md.
--
-- Le lot 2 a donné une société à chaque contact. Il reste à dire ce que chacun
-- y fait, et à qui on parle quand on veut faire avancer une affaire.
--
-- Sans ça, un compte à huit contacts est une liste de huit noms équivalents.
-- Le produit relance alors au hasard, et l'écran ne sait pas qui mettre en
-- avant. C'est aussi ce qui bloque le lot 6 : un envoi multi-threadé qui ne
-- distingue pas le décideur de l'utilisateur final envoie le même message aux
-- deux, ce qui est la meilleure façon de perdre les deux.
--
-- ── Trois sources, dans cet ordre ───────────────────────────────────────────
--
--   crm      · le CRM le dit lui-même. Salesforce porte un rôle explicite sur
--              OpportunityContactRole (Decision Maker, Economic Buyer,
--              Influencer...), déjà requêté par api/salesforce.js mais utilisé
--              jusqu'ici comme un simple booléen de rattachement : le rôle
--              était lu puis jeté.
--   inferred · déduit de l'intitulé de poste. Les trois autres CRM n'ont aucun
--              champ de rôle, et `opportunities.title` est rempli par les sept
--              importeurs.
--   user     · corrigé à la main. Ne se fait jamais réécrire, même règle que
--              crm_stage_mappings (migration 121) et crm_deal_attribution
--              (migration 123) · sans ça la correction saute à la synchro
--              suivante et l'utilisateur n'a aucun moyen de la faire tenir.
--
-- ── Pourquoi le rôle vit sur le CONTACT et pas sur le compte ────────────────
--
-- Une même personne peut être décideur chez un client et simple utilisateur
-- chez un autre. Le rôle qualifie donc le lien contact-compte, et
-- `opportunities` EST ce lien tant que la table `contacts` n'existe pas.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS account_role TEXT
  CHECK (account_role IN ('decision_maker', 'influencer', 'operational', 'other'));

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS role_source TEXT
  CHECK (role_source IN ('crm', 'inferred', 'user'));

-- Un seul interlocuteur mis en avant par compte · c'est lui que l'écran montre
-- en premier et que les jobs visent par défaut. Booléen et non rang : « le
-- principal » n'est pas un classement, c'est un choix.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS is_primary_contact BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN opportunities.account_role IS
  'Role de ce contact dans son compte : decision_maker, influencer, operational, other. NULL = pas encore determine.';

COMMENT ON COLUMN opportunities.role_source IS
  'D''ou vient le role : crm (le CRM le declare), inferred (deduit de l''intitule de poste), user (corrige a la main, jamais reecrit).';

COMMENT ON COLUMN opportunities.is_primary_contact IS
  'Interlocuteur principal du compte. Un seul par compte, elu par lib/contact-role.js : role CRM d''abord, decideur le plus recemment actif ensuite.';

-- Index partiel : la seule question posée est « qui est le principal de ce
-- compte ». Les autres lignes, qui sont la majorite, n'ont pas a peser.
CREATE INDEX IF NOT EXISTS opportunities_primary_contact_idx
  ON opportunities (account_id)
  WHERE is_primary_contact = true;

-- Chemin de lecture des jobs qui ciblent les decideurs (lot 6).
CREATE INDEX IF NOT EXISTS opportunities_account_role_idx
  ON opportunities (user_id, account_role)
  WHERE account_role IS NOT NULL;
