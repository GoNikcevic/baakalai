-- 090 — File tournante des signaux (remplace le batch unique du matin)
--
-- signal_scan_state : dernière vérification par cible (une config OU une
-- société du CRM). boost_until : posé par les webhooks CRM quand un deal
-- bouge — la cible passe en tête de file au prochain tick (≤ 30 min) sans
-- appel immédiat (le budget Brave reste maître).
--
-- signal_scan_budget : compteur GLOBAL de requêtes Brave par jour — le
-- quota (2000/mois en free tier) est partagé entre tous les utilisateurs,
-- le scheduler s'arrête quand le budget quotidien est consommé.

CREATE TABLE IF NOT EXISTS signal_scan_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('config', 'company')),
  target_key TEXT NOT NULL,
  last_scanned_at TIMESTAMPTZ,
  boost_until TIMESTAMPTZ,
  PRIMARY KEY (user_id, target_type, target_key)
);

CREATE TABLE IF NOT EXISTS signal_scan_budget (
  day DATE PRIMARY KEY,
  used INT NOT NULL DEFAULT 0
);
