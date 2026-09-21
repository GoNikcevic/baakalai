-- 100 — Révision de la politique de partage mémoire (2026-09-14)
--
-- Les agrégats business d'un tenant (« taux de conversion CRM : 34 % », taux
-- de réponse email/LinkedIn, calibration forecast, recalibrage churn…) ne
-- rejoignent plus le pool global automatiquement : anonymes au sens entités,
-- ce sont quand même les chiffres d'un client. Le code (db/index.js,
-- NEVER_AUTO_SHARE_SOURCES) bloque l'accord auto pour les nouvelles
-- écritures ; cette migration révoque le partage du stock existant.
--
-- Les patterns crm-agent historiques ont source NULL (la colonne n'était
-- posée qu'en data JSON) — rattrapés via data->>'source'. Le partage manuel
-- reste possible via la route admin toggle-share.

UPDATE memory_patterns
SET shared = false
WHERE shared = true
  AND (
    source IN (
      'crm_sync', 'crm_analysis',
      'response_analysis_email', 'response_analysis_linkedin', 'response_analysis_global',
      'churn_feedback', 'reactivation_outcomes', 'forecast_calibration'
    )
    OR (source IS NULL AND data->>'source' IN (
      'crm_sync', 'crm_analysis', 'title_analysis', 'multitouch_analysis', 'response_analysis'
    ))
  );
