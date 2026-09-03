-- Every RAG vector search in the app was failing with:
--   operator does not exist: extensions.vector <=> extensions.vector
--
-- Cause: these functions pin `search_path` to 'pg_catalog, public, runcoach'
-- (hardening against a mutable search_path), but the `vector` extension lives
-- in the `extensions` schema. pgvector's distance operators <=>, <->, <#> are
-- therefore unresolvable inside the function body — the column types are fine,
-- it is only the operator lookup that fails.
--
-- Impact while broken: book methodology, coach-workout and user-resource
-- retrieval ALL returned nothing, so every AI call — Ask Coach, weekly review,
-- plan generation — ran on the model's priors alone. The corpus was intact the
-- whole time: 7 books, 1,452 instructions, every one embedded, and none of it
-- reachable.
--
-- It failed SOFT, which is why it survived: each retriever catches the error
-- and continues with an empty layer, so the only symptom was a console warning
-- on a server that nobody was watching. What finally exposed it was a
-- generated plan citing "Training for the Uphill Athlete" — a book that is not
-- in this database. With the RAG layer empty the model had nothing to cite and
-- confabulated a plausible source. After the fix the same prompt cited 80/20
-- and the Norwegian Method, both of which are genuinely loaded.
--
-- Worth keeping in mind: the supervisor's pre-flight is supposed to flag "no
-- book sources for plan generation". It did not save us here, so if this class
-- of failure matters, that check deserves a look.
--
-- Fix: add `extensions` to each search_path. Still pinned, so the original
-- hardening property is preserved. Only the four vector-taking functions need
-- it; search_coach_workouts and search_schedules take no vector.
--
-- Applied via Supabase MCP on 2026-09-03.

ALTER FUNCTION runcoach.match_instructions(extensions.vector, double precision, integer)
  SET search_path = pg_catalog, public, runcoach, extensions;

ALTER FUNCTION runcoach.match_user_resources(extensions.vector, text, double precision, integer, text[])
  SET search_path = pg_catalog, public, runcoach, extensions;

ALTER FUNCTION runcoach.search_instructions(extensions.vector, double precision, integer, text, text)
  SET search_path = pg_catalog, public, runcoach, extensions;

ALTER FUNCTION runcoach.search_instructions_filtered(extensions.vector, double precision, integer, text, text, text)
  SET search_path = pg_catalog, public, runcoach, extensions;
