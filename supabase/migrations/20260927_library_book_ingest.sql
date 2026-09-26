-- Upload a whole book from the Coach Library page (applied via Supabase MCP 2026-09-27).
--
-- Books are 6-11 MB; Vercel rejects request bodies over ~4.5 MB, and parsing,
-- analysing, chunking and embedding a 300-page book does not fit one request.
-- So the browser uploads the PDF straight to a private Storage bucket, and the
-- server processes it in stages (one stage per request, resumable), the same
-- pattern as the staged plan builder:
--
--   uploaded → extracted (text) → analyzed (AI: title, author, description,
--   methodology, tags, focus areas, phases, level) → chunked (book row +
--   sections) → embedded (book_instructions) → done (retrieval check)
--
-- A book is written into the same coaching_books / book_instructions corpus the
-- coaches already search, so an uploaded book is used exactly like the loaded
-- ones. A failed ingest removes whatever it had written — never half a book.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coach-library', 'coach-library', false, 52428800, ARRAY['application/pdf','text/plain','application/json'])
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS runcoach.library_ingests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  -- uploaded | extracted | analyzed | chunked | embedded | done | failed
  stage text NOT NULL DEFAULT 'uploaded',
  filename text NOT NULL,
  storage_path text NOT NULL,
  pages int,
  text_chars int,
  -- What the AI read out of the book: title, author, description, methodology, tags, ...
  meta jsonb,
  chunks_total int,
  chunks_done int NOT NULL DEFAULT 0,
  book_id uuid,
  -- The retrieval check: does a search on the book's own topics find it?
  check_result jsonb,
  error text,
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Stage claim, so a reloaded page and an in-flight request never run it twice.
  running_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_ingests_user_recent ON runcoach.library_ingests (user_id, created_at DESC);
ALTER TABLE runcoach.library_ingests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.library_ingests FROM anon, authenticated;

-- Sections per book, for the Library page (one grouped query, not N counts).
CREATE OR REPLACE FUNCTION runcoach.book_section_counts()
RETURNS TABLE (book_id uuid, sections bigint)
LANGUAGE sql STABLE SET search_path = runcoach, public AS $$
  SELECT bi.book_id, count(*) FROM runcoach.book_instructions bi GROUP BY bi.book_id;
$$;
REVOKE ALL ON FUNCTION runcoach.book_section_counts() FROM anon, authenticated;
