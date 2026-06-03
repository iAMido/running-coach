-- Extend match_user_resources to optionally filter on methodology_tags.
-- When match_tags is non-null and non-empty, only chunks whose parent
-- resource has overlapping tags are returned.
--
-- Applied via Supabase MCP on 2026-06-03.

DROP FUNCTION IF EXISTS runcoach.match_user_resources(vector, text, float, int);

CREATE OR REPLACE FUNCTION runcoach.match_user_resources(
  query_embedding vector(1536),
  match_user_id text,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  match_tags text[] DEFAULT NULL
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
    AND (
      match_tags IS NULL
      OR cardinality(match_tags) = 0
      OR (r.methodology_tags IS NOT NULL AND r.methodology_tags && match_tags)
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
