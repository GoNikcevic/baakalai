-- 122 : d'où vient le lien entre un deal du CRM et un contact de baakalai.
--
-- `opportunities` porte une ligne par CONTACT. Un deal du CRM s'y accroche par
-- `crm_contact_id`, et c'est ce lien qui donne à la ligne son montant, son
-- étape et son dénouement. Jusqu'ici le lien était muet : rien ne disait si le
-- CRM l'avait affirmé ou si baakalai l'avait supposé.
--
-- Chez Salesforce il est souvent supposé. Le contact d'une Opportunity vient
-- des OpportunityContactRoles, que beaucoup d'orgs ne remplissent pas · le
-- repli d'origine n'attribuait alors le deal que si le compte n'avait qu'UN
-- seul contact emailable. Mesuré sur l'org d'un beta testeur : 52 comptes, tous
-- à deux contacts ou plus, aucun à un seul contact emailable. 0 deal rattaché
-- sur 308, donc aucun client, aucun montant, aucune étape, et un mappage de
-- pipeline (migration 121) qui ne s'appliquait à rien.
--
-- Depuis l'arbitrage du 29/09, les deals sans contact role sont répartis sur
-- les contacts du compte (voir api/salesforce.js). Cette colonne est ce qui
-- rend la répartition honnête : elle dit que le porteur est plausible, pas
-- confirmé. Les agents s'en servent pour ne jamais AFFIRMER le montant d'un
-- deal deviné à son porteur supposé · le chiffre reste bon pour les totaux,
-- les classements et les prévisions, il ne devient pas citable pour autant.
--
--   crm_role · le CRM nomme lui-même le contact du deal
--   inferred · baakalai a désigné un porteur plausible
--   user     · le user a confirmé que c'était le bon interlocuteur
--
-- NULL sur l'existant : ces lignes ont été rattachées avant que la question se
-- pose, et « on ne sait pas » se dit mieux avec un NULL qu'avec une valeur
-- inventée. La prochaine analyse CRM les renseigne.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS crm_deal_attribution TEXT
  CHECK (crm_deal_attribution IN ('crm_role', 'inferred', 'user'));

COMMENT ON COLUMN opportunities.crm_deal_attribution IS
  'Origine du rattachement deal -> contact : crm_role (le CRM le dit), inferred (baakalai a supposé), user (confirmé à la main). NULL = rattaché avant la migration 122.';

-- Partiel : la seule question posée à cette colonne est « combien de
-- rattachements restent à confirmer, pour ce user ». Les lignes réelles, qui
-- sont la majorité, n'ont pas à peser dans l'index.
CREATE INDEX IF NOT EXISTS idx_opportunities_deal_attribution_inferred
  ON opportunities (user_id)
  WHERE crm_deal_attribution = 'inferred';
