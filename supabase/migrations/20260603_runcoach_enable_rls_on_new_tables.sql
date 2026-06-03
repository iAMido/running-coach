-- RLS regression fix: the supervisor, user_resources, and chat-history PRs
-- created six new tables in the runcoach schema without enabling RLS.
-- The app uses the service-role key server-side (which bypasses RLS) so
-- functionality is unaffected; but anyone with just the anon key could
-- read these tables via the PostgREST endpoint. Two of them
-- (coach_chat_messages, coach_response_audits) contain genuine user data.
--
-- Fix: enable RLS on all six. No policies are added — service role
-- bypasses RLS by design, and we want anon + authenticated to have zero
-- access by default (the app does its own auth via NextAuth and uses the
-- service-role key for all DB access; same pattern as the existing
-- CalTrack public.* tables).
--
-- Applied via Supabase MCP on 2026-06-03.

ALTER TABLE runcoach.coach_calls            ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach.coach_response_audits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach.user_resources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach.user_resource_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach.coach_chat_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE runcoach.coach_chat_messages    ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicit deny to anon. With RLS enabled and no
-- policies, anon already gets zero rows; this just makes the intent
-- explicit in the role grants.
REVOKE ALL ON runcoach.coach_calls            FROM anon;
REVOKE ALL ON runcoach.coach_response_audits  FROM anon;
REVOKE ALL ON runcoach.user_resources         FROM anon;
REVOKE ALL ON runcoach.user_resource_chunks   FROM anon;
REVOKE ALL ON runcoach.coach_chat_sessions    FROM anon;
REVOKE ALL ON runcoach.coach_chat_messages    FROM anon;
