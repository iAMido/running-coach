-- Security-advisor fix: RLS on the migration backup snapshots.
--
-- All seven were created with CREATE TABLE AS SELECT during the intervals.icu
-- migration. That form does not inherit RLS, and the `runcoach` schema is
-- exposed to PostgREST, so the linter flagged every one of them.
--
-- Scope, accurately: `anon` held no SELECT privilege on any of these, so they
-- were not actually reachable through the API — the linter flags RLS-disabled
-- in an exposed schema without checking grants. This makes the protection
-- structural instead of depending on a grant nobody has issued yet.
--
-- No policies, matching 20260603_runcoach_enable_rls_on_new_tables.sql: the app
-- reaches these only via the service-role key, which bypasses RLS by design.
--
-- `_bak_20260806_strava_tokens` is the one that matters most. It holds a live
-- Strava refresh_token, retained deliberately so the connection can be restored
-- without a fresh OAuth round-trip (see the Strava-disarm note in CLAUDE.md).
-- If Strava is never coming back, revoking the token at Strava and dropping
-- this table is strictly better than protecting it.
--
-- Applied via Supabase MCP on 2026-08-06.

ALTER TABLE runcoach._bak_20260805_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260805_laps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260805_feedback      ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260806_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260806_laps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260806_feedback      ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach._bak_20260806_strava_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON runcoach._bak_20260805_runs          FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260805_laps          FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260805_feedback      FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260806_runs          FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260806_laps          FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260806_feedback      FROM anon, authenticated;
REVOKE ALL ON runcoach._bak_20260806_strava_tokens FROM anon, authenticated;
