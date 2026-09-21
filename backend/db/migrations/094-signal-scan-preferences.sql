-- 094 — Préférences de veille signaux + équité du budget partagé
--
-- users.signal_scan_frequency : cadence de la veille automatique choisie par
-- l'utilisateur ('off' = scan manuel uniquement). Le scheduler
-- (lib/signal-scheduler.js) en dérive les intervalles chaud/standard.
--
-- signal_scan_user_budget : compteur de requêtes par utilisateur et par jour.
-- Le budget Brave quotidien est global — sans plafond par user, un CRM de
-- 500 sociétés monopolise la file au détriment des autres comptes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS signal_scan_frequency TEXT NOT NULL DEFAULT 'weekly'
  CHECK (signal_scan_frequency IN ('off', 'weekly', 'daily'));

CREATE TABLE IF NOT EXISTS signal_scan_user_budget (
  day DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, user_id)
);
