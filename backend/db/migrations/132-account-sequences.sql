-- Lot 6 · l'inscription a une sequence passe au niveau COMPTE.
--
-- Jusqu'ici une inscription visait UN contact : `sequence_enrollments` porte un
-- `opportunity_id NOT NULL` et rien d'autre. Ecrire a trois interlocuteurs
-- d'une meme societe demandait donc trois inscriptions independantes, qui ne se
-- voyaient pas entre elles · d'ou huit relances au meme domaine pour huit
-- interlocuteurs, le probleme que le lot 5 a mis en evidence.
--
-- DEUX CHOIX DE FORME, tous deux pour ne rien casser :
--
-- 1. `opportunity_id` RESTE NOT NULL et devient le contact d'ANCRAGE de
--    l'inscription. Le rendre nullable aurait oblige a revoir chaque requete
--    qui joint dessus, et il y en a. Garder une valeur qui a du sens (le
--    contact principal du compte) laisse tout le code existant fonctionner.
--
-- 2. Le fan-out vit dans une table a part plutot que dans des colonnes
--    supplementaires. Un destinataire a son propre etat : il peut etre suspendu
--    parce qu'un collegue a repondu, pendant que l'inscription reste active.
--    Cet etat-la n'appartient pas a l'inscription.

ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

-- Les inscriptions d'un compte, pour le moteur comme pour l'affichage.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_account
  ON sequence_enrollments (account_id, status) WHERE account_id IS NOT NULL;

-- ── Les destinataires d'une inscription ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sequence_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `user_id` est redondant avec celui de l'inscription, et c'est voulu : les
  -- politiques RLS filtrent par utilisateur sans jointure, comme partout
  -- ailleurs dans ce schema.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,

  -- INSTANTANE du role d'achat, pas une seconde source de verite : la verite
  -- vit dans `opportunities.account_role` (avec son `role_source`). On le
  -- recopie ici parce que le message a ete ECRIT pour ce role, et qu'un role
  -- qui change apres coup ne doit pas rendre incomprehensible un message deja
  -- parti. Pas de CHECK : le vocabulaire est celui du lot 1, et une contrainte
  -- en double se desynchroniserait de celle qui compte.
  role TEXT,

  -- `suspended` est l'etat qui porte tout le lot : un collegue a repondu, donc
  -- on se tait sur ce fil SANS l'arreter · si la conversation retombe, il peut
  -- reprendre. C'est different de `stopped`, qui est definitif.
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'replied', 'stopped')),
  suspend_reason TEXT,
  suspended_at TIMESTAMPTZ,

  -- Le dernier envoi REELLEMENT parti vers ce destinataire, et leur compte.
  -- Sert a etaler les messages d'un meme compte dans le temps : deux personnes
  -- de la meme societe le meme jour se remarque, et pas en bien.
  last_sent_at TIMESTAMPTZ,
  sent_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Un contact ne peut figurer qu'une fois dans une inscription donnee. C'est
  -- la garde qui empeche le bug du lot 5 de revenir par une autre porte.
  UNIQUE (enrollment_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_sequence_recipients_enrollment
  ON sequence_recipients (enrollment_id, status);

-- Pour la question « ce contact est-il deja destinataire d'une sequence
-- vivante ? », posee a chaque inscription.
CREATE INDEX IF NOT EXISTS idx_sequence_recipients_opportunity
  ON sequence_recipients (opportunity_id, status);

-- ── L'interrupteur, et pourquoi il est ETEINT par defaut ────────────────────
--
-- Un workflow multi-destinataires ecrit a plusieurs personnes d'une meme
-- societe. C'est l'objet du lot, et c'est aussi le comportement que le plan
-- classe en risque « tres eleve ».
--
-- Il aurait ete plus simple de rendre TOUS les workflows multi-destinataires
-- d'un coup. Ca aurait change, sans que personne le demande, ce que recoivent
-- les contacts des utilisateurs existants · et dans le sens ou l'erreur coute
-- le plus cher, puisqu'une reputation d'expediteur met des mois a revenir.
--
-- Donc : opt-in, par workflow, faux par defaut. Rien ne change pour personne
-- tant que le choix n'est pas fait explicitement.
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS multi_thread BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workflows.multi_thread IS
  'Ce workflow aborde plusieurs interlocuteurs d''une meme societe (lot 6). Faux par defaut : le multi-destinataires est un choix, jamais un defaut.';

ALTER TABLE sequence_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON sequence_recipients;
CREATE POLICY "Service role full access" ON sequence_recipients
  FOR ALL USING (true) WITH CHECK (true);
