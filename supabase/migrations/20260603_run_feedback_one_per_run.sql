-- Replace UNIQUE (user_id, run_date) with UNIQUE (user_id, run_id) on
-- run_feedback. The old constraint blocked logging two runs on the same
-- day (e.g. morning + evening, or a split workout). One feedback per run
-- — multiple per day — is the right model.
--
-- Applied via Supabase MCP on 2026-06-03.

ALTER TABLE runcoach.run_feedback
  DROP CONSTRAINT IF EXISTS run_feedback_user_id_run_date_key;

ALTER TABLE runcoach.run_feedback
  ADD CONSTRAINT run_feedback_user_id_run_id_key
  UNIQUE (user_id, run_id);

CREATE INDEX IF NOT EXISTS run_feedback_user_run_idx
  ON runcoach.run_feedback (user_id, run_id);
