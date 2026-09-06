-- Séquence outreach générée depuis un signal (POST /api/signals/:id/create-sequence).
-- Avant : la séquence LLM (E1/E2/E3) était retournée au client puis perdue —
-- le signal passait quand même à actioned/sequence_created sans rien créer.

ALTER TABLE signals ADD COLUMN IF NOT EXISTS sequence JSONB;

COMMENT ON COLUMN signals.sequence IS
  'Séquence générée ({name, steps: [{step, timing, subject, body}]}). '
  'E1 est aussi créé en nurture_emails (status pending, metadata.chain = '
  '''signal_sequence'') ; E2/E3 restent consultables ici.';
