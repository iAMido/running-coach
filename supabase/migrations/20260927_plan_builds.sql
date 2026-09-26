-- Staged plan builder: one row per plan build, holding each stage's output.
--
-- Plan generation used to be a single model call — read everything, reason,
-- and write every week of JSON in one response. It is now a pipeline:
--
--   prepare (assess athlete, understand race, targeted research)
--   → outline  (strategy: phases, weekly targets, strength library)
--   → write    (phases written in parallel against the outline)
--   → check    (deterministic rules; failing weeks rewritten)
--   → review   (does it all fit: joins, alignment, outline, race)
--   → save
--
-- Each stage is its own HTTP request so no single request approaches the
-- 300 s function limit (the outline and the review run on a model whose
-- thinking cannot be switched off). This row is the hand-off between them,
-- which also makes a build resumable and every decision inspectable after
-- the fact.
--
-- Nothing here is the athlete's plan. The plan is written to
-- training_plans only by the final save stage, and only when every earlier
-- stage succeeded.
CREATE TABLE IF NOT EXISTS runcoach.plan_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  -- created | prepared | outlined | written | checked | coherence_fix
  -- | reviewed | done | failed
  stage text NOT NULL DEFAULT 'created',
  request jsonb NOT NULL,
  prepared jsonb,
  outline jsonb,
  weeks jsonb,
  checks jsonb,
  reviews jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_rounds int NOT NULL DEFAULT 0,
  plan_id uuid,
  error text,
  -- Per-stage wall clock and token usage, for tuning.
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Scripts build without saving; the save stage then refuses.
  dry_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plan_builds_user_recent
  ON runcoach.plan_builds (user_id, created_at DESC);

ALTER TABLE runcoach.plan_builds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.plan_builds FROM anon, authenticated;

-- A stage is claimed before it runs, so a resumed page and an in-flight
-- request cannot both pay for the same Opus call. Expires on its own if the
-- function dies mid-stage.
ALTER TABLE runcoach.plan_builds ADD COLUMN IF NOT EXISTS running_until timestamptz;
-- Per-stage retry counts (an unusable outline or a failed writer is retried
-- once before the build is failed).
ALTER TABLE runcoach.plan_builds ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '{}'::jsonb;
