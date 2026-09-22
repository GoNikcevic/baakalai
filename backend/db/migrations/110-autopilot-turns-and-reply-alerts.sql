-- 110 · Nombre de tours d'autopilot par portée + alerte sur réponse
--
-- Deux arbitrages Goran du 2026-09-22.
--
-- 1. Le compteur de tours se comptait par ADRESSE EMAIL, sur toute la vie du
--    compte : un prospect relancé dans une nouvelle campagne 60 jours plus tard
--    repartait avec son compteur déjà entamé, parfois déjà épuisé. Il se compte
--    désormais par CONTENEUR (campagne de prospection, ou workflow CRM), d'où
--    ces deux colonnes. NULL sur les deux = relance CRM hors campagne et hors
--    workflow : le compteur retombe alors sur le contact.
--
-- 2. Les réponses n'ont jamais déclenché la moindre alerte. Choisir « arrête-toi
--    à la première réponse et rends-moi la main » n'a de sens que si quelque
--    chose prévient : notification dans l'app ET email. L'email est une nouvelle
--    catégorie opt-out (RGPD art. 21, cf. lib/email-prefs.js), pas un
--    transactionnel : il doit être désinscriptible comme les trois autres.

ALTER TABLE autopilot_queue ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE autopilot_queue ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL;

COMMENT ON COLUMN autopilot_queue.campaign_id IS
  'Campagne de prospection dans laquelle cet échange a lieu. Borne le compteur de tours : un nouveau conteneur = un compteur neuf.';
COMMENT ON COLUMN autopilot_queue.enrollment_id IS
  'Workflow CRM dans lequel cet échange a lieu. Même rôle que campaign_id pour la portée CRM.';

CREATE INDEX IF NOT EXISTS idx_autopilot_queue_turns
  ON autopilot_queue (opportunity_id, status)
  WHERE status = 'sent';

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_reply_alert BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.email_reply_alert IS
  'Opt-out de l''alerte email quand un prospect ou un client repond (true = recevoir)';
