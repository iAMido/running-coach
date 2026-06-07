-- Split the single current_goal into long_term_goal + active_goal_focus.
-- The coach kept defaulting back to the settings goal during chat because
-- there was only one anchor — when the active plan was for a different
-- horizon (e.g. "return-from-break 10K base" vs the long-term "1:50 HM"),
-- the prompt couldn't distinguish them.
--
-- After this migration the user-formatter renders both, and the system
-- prompt is instructed to anchor advice on active_goal_focus, treating
-- long_term_goal as background context.
--
-- Applied via Supabase MCP on 2026-06-03.

ALTER TABLE runcoach.athlete_profile
  ADD COLUMN IF NOT EXISTS long_term_goal    text,
  ADD COLUMN IF NOT EXISTS active_goal_focus text;

UPDATE runcoach.athlete_profile ap
   SET long_term_goal    = COALESCE(long_term_goal, current_goal),
       active_goal_focus = COALESCE(
         active_goal_focus,
         (SELECT plan_json->>'goal'
            FROM runcoach.training_plans tp
           WHERE tp.user_id = ap.user_id
             AND tp.status = 'active'
           ORDER BY tp.created_at DESC LIMIT 1)
       )
 WHERE long_term_goal IS NULL OR active_goal_focus IS NULL;
