-- Garmin Connect Personal API — a second wellness source next to intervals.icu.
--
-- See docs/garmin-wellness-plan.md and docs/garmin-personal-probe-findings.md.
--
--   garmin_tokens          the athlete's Personal API key (encrypted) and a
--                          cached 24 h access token (encrypted)
--   garmin_daily_wellness  Garmin-only recovery data: body battery, stress,
--                          sleep stages, HRV status/baseline, night physiology
--
-- A SEPARATE table on purpose: upsertWellnessDays overwrites daily_wellness
-- rows in full on every intervals.icu sync, so Garmin values stored there would
-- be replaced (often with null) on the next sync.
--
-- hrv / resting_hr / sleep_secs / sleep_score stay owned by daily_wellness
-- (intervals.icu). They were measured identical to Garmin's on 14/14 days, so
-- the copies here exist for traceability and must not feed a baseline.
--
-- RLS on with no policies, as in 20260805_intervals_icu.sql: the app reaches
-- Postgres with the service-role key.

CREATE TABLE IF NOT EXISTS runcoach.garmin_tokens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 text NOT NULL UNIQUE,
  -- AES-256-GCM blob (lib/intervals/crypto.ts). Never plaintext: it reads all
  -- of the athlete's health data.
  api_key                 text NOT NULL,
  -- Entered at connect time; the API does not report it. Keys last 30/90/180/365 days.
  key_expires_at          date NOT NULL,
  -- Encrypted too: valid for 24 h against the same data.
  access_token            text,
  access_token_expires_at timestamptz,
  -- Claimed by sync-on-open (compare-and-swap), so it can mean "started".
  last_sync_at            timestamptz,
  -- Only ever written on success. What staleness checks read.
  last_success_at         timestamptz,
  last_error              text,
  -- Set on a 429; every sync respects it.
  cooldown_until          timestamptz,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE runcoach.garmin_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.garmin_tokens FROM anon;

COMMENT ON TABLE runcoach.garmin_tokens IS
  'Garmin Connect Personal API key per user. api_key and access_token are AES-256-GCM blobs (INTERVALS_TOKEN_KEY); never store plaintext.';

CREATE TABLE IF NOT EXISTS runcoach.garmin_daily_wellness (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   text NOT NULL,
  -- Garmin's calendarDate: the WAKE date, same attribution as daily_wellness (verified 14/14).
  day                       date NOT NULL,

  -- Body battery (0-100). at_wake is read from the intraday series at sleep end.
  body_battery_min          smallint,
  body_battery_max          smallint,
  body_battery_charged      smallint,
  body_battery_drained      smallint,
  body_battery_at_wake      smallint,

  -- All-day stress (0-100).
  stress_avg                smallint,
  stress_max                smallint,
  stress_qualifier          text,
  stress_high_secs          int,

  -- Sleep. sleep_secs / sleep_score duplicate daily_wellness (traceability only).
  sleep_secs                int,
  sleep_score               smallint,
  sleep_deep_secs           int,
  sleep_light_secs          int,
  sleep_rem_secs            int,
  sleep_awake_secs          int,
  sleep_awake_count         smallint,
  sleep_stress_avg          numeric,
  sleep_avg_hr              numeric,
  sleep_respiration_avg     numeric,
  sleep_spo2_avg            numeric,
  sleep_need_mins           int,
  sleep_need_baseline_mins  int,
  sleep_start               timestamptz,
  sleep_end                 timestamptz,

  -- HRV context. hrv_last_night duplicates daily_wellness.hrv (traceability only);
  -- status and the baseline band are what Garmin adds.
  hrv_last_night            numeric,
  hrv_weekly_avg            numeric,
  hrv_baseline_low          numeric,
  hrv_baseline_high         numeric,
  hrv_status                text,

  resting_hr                smallint,

  -- Per-endpoint source objects for the day, for re-mapping without re-fetching.
  raw                       jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz DEFAULT now(),
  UNIQUE (user_id, day)
);

ALTER TABLE runcoach.garmin_daily_wellness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.garmin_daily_wellness FROM anon;

CREATE INDEX IF NOT EXISTS garmin_daily_wellness_user_day_idx
  ON runcoach.garmin_daily_wellness (user_id, day DESC);

COMMENT ON TABLE runcoach.garmin_daily_wellness IS
  'Garmin-only recovery data from the Personal API. hrv_last_night / resting_hr / sleep_secs / sleep_score duplicate daily_wellness and must not feed baselines; daily_wellness owns them.';
