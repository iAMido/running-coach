-- The season above the block. Applied via Supabase MCP on 2026-09-03.
--
-- A day-by-day plan for a race 11 months out is fiction: measured at ~623
-- output tokens per plan-week, 48 weeks is ~30k tokens against a 16k ceiling,
-- and it would be invalidated by week 6 anyway. So the macro plan holds INTENT
-- and TARGETS per phase, and `training_plans` rows hang off it as 8-16 week
-- blocks carrying the actual sessions.
--
-- Deliberately a separate table rather than a column on training_plans: the
-- athlete will ask for a 6-month plan and then a 4-month plan, so a macro needs
-- its own lifecycle (active -> superseded) independent of the blocks beneath
-- it, and a column would duplicate the whole season onto every block.

CREATE TABLE IF NOT EXISTS runcoach.macro_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  goal_name text NOT NULL,
  race_date date,
  race_distance_km numeric,
  race_elevation_gain_m int,
  terrain_access text,
  horizon_weeks int NOT NULL,
  phases jsonb NOT NULL,
  rationale text,
  status text NOT NULL DEFAULT 'active',
  revision int NOT NULL DEFAULT 1,
  supersedes uuid REFERENCES runcoach.macro_plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS macro_plans_user_status_idx
  ON runcoach.macro_plans (user_id, status);

-- At most one active macro plan per athlete, enforced in the storage layer
-- rather than by convention (same reasoning as runs_user_filename_uniq): two
-- active seasons would make "which phase am I in" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS macro_plans_one_active_per_user
  ON runcoach.macro_plans (user_id) WHERE status = 'active';

ALTER TABLE runcoach.macro_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.macro_plans FROM anon, authenticated;

COMMENT ON COLUMN runcoach.macro_plans.phases IS
  'Array of phase objects: name, focus, weeks, weekly_km_range, weekly_vert_range_m, long_run_vert_ceiling_m, capability, exit_criteria[]. Holds NO workouts - blocks in training_plans do that.';
COMMENT ON COLUMN runcoach.macro_plans.status IS
  'active | superseded | completed. One active per user, enforced by macro_plans_one_active_per_user.';

ALTER TABLE runcoach.training_plans ADD COLUMN IF NOT EXISTS macro_plan_id uuid REFERENCES runcoach.macro_plans(id);
ALTER TABLE runcoach.training_plans ADD COLUMN IF NOT EXISTS block_number int;
ALTER TABLE runcoach.training_plans ADD COLUMN IF NOT EXISTS macro_phase text;

COMMENT ON COLUMN runcoach.training_plans.macro_plan_id IS
  'The season this block serves. Null for standalone plans predating macro plans, which stay valid.';
