-- 089 — Scoping des memory_patterns par tenant (audit mémoire du 02/09)
--
-- Modèle décidé : un pattern NAÎT scopé à son tenant (team_id pour une équipe,
-- user_id pour un solo), et ne monte au pool global anonymisé (shared=true)
-- que s'il passe l'anonymiseur ET la confiance Haute. Le pool global est un
-- bonus en lecture, jamais la source principale — « la mémoire de VOTRE CRM ».
--
-- user_id était d'ailleurs déjà attendu par lib/conversation-autopilot.js
-- (requête sur une colonne inexistante, qui levait à chaque appel).

ALTER TABLE memory_patterns ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_memory_patterns_user ON memory_patterns(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_patterns_team ON memory_patterns(team_id) WHERE team_id IS NOT NULL;
