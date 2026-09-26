-- Staged builder for SEASON plans (applied via Supabase MCP 2026-09-27).
--
-- The season used to be one model call with no book research and no checks
-- beyond "is it JSON". It now runs through the same plan_builds stage machine
-- as a training block — assess, research, head-coach design, rule checks,
-- "does it all fit" review, save — distinguished by `kind`.

-- 'block' (a training plan, saved to training_plans) or 'season' (saved to macro_plans).
ALTER TABLE runcoach.plan_builds ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'block';
-- The season draft between stages (a block build uses outline/weeks instead).
ALTER TABLE runcoach.plan_builds ADD COLUMN IF NOT EXISTS season jsonb;
-- The macro_plans row a completed season build saved.
ALTER TABLE runcoach.plan_builds ADD COLUMN IF NOT EXISTS macro_plan_id uuid;

-- How the season was built and checked, shown under the season on the plan page.
ALTER TABLE runcoach.macro_plans ADD COLUMN IF NOT EXISTS build_report jsonb;

-- Phase-by-phase seasons: the season head coach writes a brief (goal, KPIs,
-- must-haves, don'ts, warning signs, hand-over) per phase, stored inside
-- `phases`; each phase is then built as ONE training plan when it is due.
-- `start_date` anchors the season's calendar; `phase_progress` records what
-- actually happened — which phase is active, when it really started, how many
-- weeks it was extended, and which training plans served it.
ALTER TABLE runcoach.macro_plans ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE runcoach.macro_plans ADD COLUMN IF NOT EXISTS phase_progress jsonb;
-- Existing seasons had no start date; their creation day is the best anchor.
UPDATE runcoach.macro_plans SET start_date = (created_at AT TIME ZONE 'Asia/Jerusalem')::date WHERE start_date IS NULL;
