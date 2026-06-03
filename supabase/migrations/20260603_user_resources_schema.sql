-- user_resources: the athlete's own coach material (training plan archives,
-- physiology notes, blog posts they want the coach to follow, etc).
-- Mirrors coaching_books + book_instructions but scoped per user_id so
-- retrieval can union with book content while staying private/owner-specific.
--
-- Applied via Supabase MCP on 2026-06-03.

CREATE TABLE IF NOT EXISTS runcoach.user_resources (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  title               text NOT NULL,
  source_type         text NOT NULL DEFAULT 'pasted_text',
  original_filename   text,
  description         text,
  methodology_tags    text[],
  applies_to_phase    text,
  applies_to_workout_type text,
  chunk_count         int DEFAULT 0,
  total_tokens        int DEFAULT 0,
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_resources_user_status_idx
  ON runcoach.user_resources (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS runcoach.user_resource_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id     uuid NOT NULL REFERENCES runcoach.user_resources(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  chunk_index     int NOT NULL,
  section_title   text,
  content         text NOT NULL,
  key_rules       text[],
  embedding       vector(1536),
  token_count     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_resource_chunks_resource_idx
  ON runcoach.user_resource_chunks (resource_id, chunk_index);
CREATE INDEX IF NOT EXISTS user_resource_chunks_user_idx
  ON runcoach.user_resource_chunks (user_id);
CREATE INDEX IF NOT EXISTS user_resource_chunks_embedding_idx
  ON runcoach.user_resource_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION runcoach.match_user_resources(
  query_embedding vector(1536),
  match_user_id text,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id              uuid,
  resource_id     uuid,
  resource_title  text,
  section_title   text,
  content         text,
  key_rules       text[],
  similarity      float
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.resource_id,
    r.title AS resource_title,
    c.section_title,
    c.content,
    c.key_rules,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM runcoach.user_resource_chunks c
  JOIN runcoach.user_resources r ON r.id = c.resource_id
  WHERE c.user_id = match_user_id
    AND r.status = 'active'
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
