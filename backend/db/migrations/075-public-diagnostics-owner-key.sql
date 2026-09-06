-- Diagnostic public via OAuth : le rapport arrive au propriétaire par
-- redirect (?r=<id>&k=<owner_key>), il faut donc distinguer sa vue complète
-- de la vue partagée anonymisée. owner_key n'est renvoyée par l'API que dans
-- ce redirect — jamais dans la vue partagée.
ALTER TABLE public_diagnostics
  ADD COLUMN IF NOT EXISTS owner_key UUID NOT NULL DEFAULT gen_random_uuid();
