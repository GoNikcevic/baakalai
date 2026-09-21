-- Split the chat feature into two independent assistants (general vs. campaign-creation)
-- sharing the same thread/message infrastructure, distinguished by this column so each UI's
-- thread list only ever shows its own conversations.

ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS assistant_type TEXT NOT NULL DEFAULT 'campaign'
  CHECK (assistant_type IN ('general', 'campaign'));

CREATE INDEX IF NOT EXISTS idx_chat_threads_user_assistant_type
  ON chat_threads(user_id, assistant_type, updated_at DESC);
