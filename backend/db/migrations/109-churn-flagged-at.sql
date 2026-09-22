-- 109 · Date de passage à risque (déclencheur « Client à risque »)
--
-- Le churn est un ETAT, pas un événement : c'est ce qui empêchait d'en faire
-- un déclencheur d'automatisation. Tous les types de `lib/trigger-matching.js`
-- s'ancrent sur une date avec fenêtre (won_date, lost_date, last_activity_at)
-- précisément pour qu'un contact matche une fois et pas à chaque run. Une
-- règle « client à risque » lue sur `churn_score >= seuil` aurait reproposé la
-- même population tous les jours, seule la dédup 7 jours la retenant.
--
-- `churn_flagged_at` date le FRANCHISSEMENT du seuil, vers le haut. Elle est
-- tenue par lib/churn-scoring.js à chaque scoring : posée quand le score passe
-- sous le seuil vers au-dessus, remise à NULL quand le client repasse en bon
-- état (un client qui replonge plus tard redevient donc un événement neuf).

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS churn_flagged_at TIMESTAMPTZ;

COMMENT ON COLUMN opportunities.churn_flagged_at IS
  'Date à laquelle churn_score a franchi AT_RISK_THRESHOLD vers le haut. NULL = pas à risque. Tenue par lib/churn-scoring.scoreAllForUser, lue par le déclencheur churn_risk.';

-- Sans reprise, les clients DÉJÀ à risque au moment de la migration ne
-- franchiraient plus jamais le seuil (ils sont déjà au-dessus) et aucune règle
-- ne les verrait. On date leur signalement du dernier scoring connu : la
-- fenêtre de 7 jours du déclencheur borne l'effet dans le temps, et la règle
-- reste opt-in, avec son aperçu avant activation.
UPDATE opportunities
SET churn_flagged_at = COALESCE(churn_scored_at, now())
WHERE status = 'won' AND churn_score >= 60 AND churn_flagged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_churn_flagged_at
  ON opportunities (user_id, churn_flagged_at)
  WHERE churn_flagged_at IS NOT NULL;
