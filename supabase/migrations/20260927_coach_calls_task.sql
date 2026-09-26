-- Which step of a multi-call feature a coach_calls row belongs to (applied via
-- Supabase MCP 2026-09-27), e.g. plan_outline / plan_writer / plan_review.
--
-- The staged plan builder first recorded this as a fake preflight warning
-- ("builder:plan_writer"), so the Coach Health widget counted 93 test-build
-- calls as warnings. The label moves to its own column and the rows written
-- that way are migrated.
ALTER TABLE runcoach.coach_calls ADD COLUMN IF NOT EXISTS task text;
UPDATE runcoach.coach_calls
   SET task = substring(preflight_warnings[1] from 'builder:(.*)'),
       preflight_warnings = NULL
 WHERE route = '/api/coach/plans/build'
   AND preflight_warnings[1] LIKE 'builder:%';
