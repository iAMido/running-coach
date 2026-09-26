-- Expert plan exemplars. Applied via Supabase MCP on 2026-09-26.
--
-- A LIBRARY, not per-athlete data — like coaching_books. Ten plans supplied by
-- the athlete: two Carmel-Kinneret trail plans (33K, 55K), three Norwegian-
-- method plans, a half-marathon PB plan, a return-to-running plan, two
-- strength-only blocks, and a half-Ironman. Loaded by
-- scripts/load-plan-exemplars.ts.
--
-- Stores the DISTILLED exemplar (lib/coach/plan-exemplars.ts), not the raw
-- export: the raw files are 140 KB-4 MB and almost none of those bytes are
-- signal — one strength session carries its exercises three times over in
-- different serialisation formats. The distillation keeps phase shape, loading
-- rhythm, volume and climb progression, every distinct coaching note, a
-- representative week per phase, and the strength programme.
--
-- The metadata columns exist so generation can SELECT the most relevant
-- exemplars deterministically (scoreExemplar) rather than by embedding
-- similarity: "which plan is structurally like this race" is a question about
-- terrain and distance, not wording.
CREATE TABLE IF NOT EXISTS runcoach.plan_exemplars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  kind text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  weeks int NOT NULL,
  goal_distance_km numeric,
  goal_elevation_gain_m int,
  goal_elevation_loss_m int,
  exemplar jsonb NOT NULL,
  rendered text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN runcoach.plan_exemplars.kind IS
  'full_plan | strength_block | return_to_run | multisport. strength_block rows are never used as a plan STRUCTURE — they are selected separately as a strength reference.';
COMMENT ON COLUMN runcoach.plan_exemplars.rendered IS
  'Prompt-ready text from renderExemplar(). Stored so plan generation does not re-distil on every request.';

ALTER TABLE runcoach.plan_exemplars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.plan_exemplars FROM anon, authenticated;
