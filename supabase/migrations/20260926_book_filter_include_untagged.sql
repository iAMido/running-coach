-- Applied via Supabase MCP on 2026-09-26.
--
-- The phase/workout-type filters in search_instructions_filtered were HARD
-- filters over tags that are mostly absent: 1,291 of 1,452 chunks (89%) had no
-- applies_to_phase and 877 no applies_to_workout_type, because the tags come
-- from a keyword heuristic in scripts/load-book-pdf.ts ("base phase" appearing
-- in the text). An untagged chunk was EXCLUDED whenever a filter was set.
--
-- The phase filter is taken from the ACTIVE PLAN's current week
-- (lib/rag/context-builder.ts). Measured on a real query:
--   phase=null                     -> 12 chunks
--   phase=Base                     -> 12 chunks, drawn from only 63 (4.3%)
--   phase=Support/Build            -> 0
--   phase=Specific/Peak            -> 0
--   phase=Gradient Familiarisation -> 0
-- Plan generation names its phases "Support/Build" and "Specific/Peak", so for
-- the Build and Peak weeks of every generated plan the coach had NO book
-- methodology at all. A third silent-empty failure of the book layer,
-- independent of the search_path and threshold faults fixed 2026-09-03.
--
-- New semantics:
--   * an untagged chunk applies everywhere — a missing tag is not a restriction
--   * a tag matches when it appears INSIDE the filter, so "Support/Build" still
--     prefers Build-tagged chunks and "Taper & Race Prep" prefers Taper ones
--   * a chunk tagged for a DIFFERENT phase stays excluded, so taper advice does
--     not surface in a base week
-- Similarity does the relevance work; tags only rule things out.
-- After: every phase above returns 12.
CREATE OR REPLACE FUNCTION runcoach.search_instructions_filtered(
  query_embedding extensions.vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5,
  filter_phase text DEFAULT NULL::text,
  filter_workout_type text DEFAULT NULL::text,
  filter_level text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, book_id uuid, book_title text, methodology text, chapter_title text, section_title text, content text, key_rules text[], similarity double precision)
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'runcoach', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    bi.id, bi.book_id, cb.title AS book_title, cb.methodology,
    bi.chapter_title, bi.section_title, bi.content, bi.key_rules,
    1 - (bi.embedding <=> query_embedding) AS similarity
  FROM book_instructions bi
  JOIN coaching_books cb ON cb.id = bi.book_id
  WHERE
    bi.embedding IS NOT NULL
    AND 1 - (bi.embedding <=> query_embedding) > match_threshold
    AND (
      filter_phase IS NULL
      OR bi.applies_to_phase IS NULL
      OR bi.applies_to_phase = 'All'
      OR filter_phase ILIKE '%' || bi.applies_to_phase || '%'
    )
    AND (
      filter_workout_type IS NULL
      OR bi.applies_to_workout_type IS NULL
      OR filter_workout_type ILIKE '%' || bi.applies_to_workout_type || '%'
    )
    AND (filter_level IS NULL OR cb.level = filter_level OR cb.level = 'all')
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$function$;
