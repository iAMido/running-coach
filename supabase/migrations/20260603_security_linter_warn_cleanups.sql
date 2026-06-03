-- Clean up the remaining WARN-level findings from the Supabase security linter.
--
-- 1. function_search_path_mutable on six runcoach RPCs — pin search_path
--    so a future role-mutable search_path can't be exploited to shadow
--    types/operators in pg_catalog or our own schemas.
-- 2. rls_policy_always_true on three book tables — drop the misnamed
--    "Allow all access ... for service role" policy (its roles list is
--    actually PUBLIC, not service_role, so it lets anon write/delete
--    reference data). The existing per-table "Allow read access" SELECT
--    policy stays — book content is intentional public-read reference.
-- 3. Two SECURITY DEFINER linter findings on public.rls_auto_enable —
--    revoke EXECUTE from anon + authenticated. The function is only
--    useful from the event trigger that invokes it.
--
-- Applied via Supabase MCP on 2026-06-03.

-- 1. Pin search_path on runcoach RPCs
ALTER FUNCTION runcoach.match_instructions(vector, double precision, integer)
  SET search_path = pg_catalog, public, runcoach;
ALTER FUNCTION runcoach.match_user_resources(vector, text, double precision, integer, text[])
  SET search_path = pg_catalog, public, runcoach;
ALTER FUNCTION runcoach.search_coach_workouts(text, text, text, text, integer)
  SET search_path = pg_catalog, public, runcoach;
ALTER FUNCTION runcoach.search_instructions(vector, double precision, integer, text, text)
  SET search_path = pg_catalog, public, runcoach;
ALTER FUNCTION runcoach.search_instructions_filtered(vector, double precision, integer, text, text, text)
  SET search_path = pg_catalog, public, runcoach;
ALTER FUNCTION runcoach.search_schedules(text, text, integer)
  SET search_path = pg_catalog, public, runcoach;

-- 2. Drop overly-permissive policies on reference tables
DROP POLICY IF EXISTS "Allow all access to book_instructions for service role" ON runcoach.book_instructions;
DROP POLICY IF EXISTS "Allow all access to book_schedules for service role"    ON runcoach.book_schedules;
DROP POLICY IF EXISTS "Allow all access to coaching_books for service role"    ON runcoach.coaching_books;

-- 3. Revoke EXECUTE on rls_auto_enable from anon + authenticated
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;
