-- Chat history persistence so conversations survive page reload.
-- Applied via Supabase MCP on 2026-06-03.

CREATE TABLE IF NOT EXISTS runcoach.coach_chat_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  title         text,
  status        text NOT NULL DEFAULT 'active',
  message_count int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_chat_sessions_user_idx
  ON runcoach.coach_chat_sessions (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS runcoach.coach_chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES runcoach.coach_chat_sessions(id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  role          text NOT NULL,
  content       text NOT NULL,
  supervisor    jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coach_chat_messages_session_idx
  ON runcoach.coach_chat_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS coach_chat_messages_user_idx
  ON runcoach.coach_chat_messages (user_id, created_at DESC);
