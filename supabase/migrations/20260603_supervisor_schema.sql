-- Supervisor schema: telemetry + response audits for the AI coach.
-- coach_calls captures one row per AI request (preflight warnings, tokens,
-- latency) so the weekly health audit can spot trends. coach_response_audits
-- captures the optional Haiku critic's scores so we can see when the coach
-- is shipping low-quality responses.
--
-- Applied via Supabase MCP on 2026-06-03.

CREATE TABLE IF NOT EXISTS runcoach.coach_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  route         text NOT NULL,
  query_type    text,
  model         text,
  context_tokens int,
  context_budget int,
  ceiling_hit   boolean DEFAULT false,
  cache_used    boolean DEFAULT false,
  preflight_ok  boolean DEFAULT true,
  preflight_warnings text[],
  preflight_augmented boolean DEFAULT false,
  latency_ms    int,
  status        text,
  error_message text,
  plan_modified boolean DEFAULT false,
  audit_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_calls_user_created_idx
  ON runcoach.coach_calls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_calls_route_created_idx
  ON runcoach.coach_calls (route, created_at DESC);

CREATE TABLE IF NOT EXISTS runcoach.coach_response_audits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             uuid REFERENCES runcoach.coach_calls(id) ON DELETE SET NULL,
  user_id             text NOT NULL,
  route               text NOT NULL,
  query_type          text,
  query_excerpt       text,
  response_excerpt    text,
  scores              jsonb,
  overall_score       numeric(3,1),
  missing             text[],
  hallucinations      text[],
  warnings            text[],
  critic_model        text,
  critic_latency_ms   int,
  raw_critic_response text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_response_audits_user_created_idx
  ON runcoach.coach_response_audits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coach_response_audits_overall_score_idx
  ON runcoach.coach_response_audits (overall_score)
  WHERE overall_score IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_calls_audit_id_fkey'
  ) THEN
    ALTER TABLE runcoach.coach_calls
      ADD CONSTRAINT coach_calls_audit_id_fkey
      FOREIGN KEY (audit_id) REFERENCES runcoach.coach_response_audits(id) ON DELETE SET NULL;
  END IF;
END $$;
