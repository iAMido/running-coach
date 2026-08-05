-- intervals.icu migration, phase 2 — schema.
--
-- Two additive tables. Nothing existing is altered, so this is safe to apply
-- ahead of any application code.
--
--   intervals_tokens  one row per athlete: the API credential plus forward
--                     slots for OAuth, so adding a second athlete later is a
--                     code change rather than another migration.
--   daily_wellness    the recovery layer the app has never had — HRV, sleep,
--                     resting HR and the CTL/ATL fitness/fatigue series.
--
-- RLS is enabled with no policies, matching the pattern established in
-- 20260603_runcoach_enable_rls_on_new_tables.sql: the app authenticates via
-- NextAuth and reaches Postgres with the service-role key (which bypasses
-- RLS), so anon and authenticated should have zero access by default.
--
-- Applied via Supabase MCP on 2026-08-05.

-- ---------------------------------------------------------------- tokens

CREATE TABLE IF NOT EXISTS runcoach.intervals_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL UNIQUE,
  api_key       text NOT NULL,
  athlete_id    text NOT NULL,
  -- Forward slots for OAuth. intervals.icu requires OAuth before a second
  -- athlete can connect; leaving them here means that is additive.
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  last_sync_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE runcoach.intervals_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.intervals_tokens FROM anon;

COMMENT ON TABLE runcoach.intervals_tokens IS
  'intervals.icu credentials, one row per athlete. See lib/intervals/crypto.ts.';

-- The credential grants WRITE access to the athlete''s training calendar, and
-- the service-role key bypasses RLS — so RLS is not what protects this column.
-- It is stored as an AES-256-GCM blob encrypted with INTERVALS_TOKEN_KEY, a
-- secret the database does not hold. Never write a plaintext key here.
COMMENT ON COLUMN runcoach.intervals_tokens.api_key IS
  'AES-256-GCM ciphertext (v1.iv.tag.ct), NOT plaintext. Encrypt via lib/intervals/crypto.ts.';

-- --------------------------------------------------------------- wellness

CREATE TABLE IF NOT EXISTS runcoach.daily_wellness (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  day           date NOT NULL,
  -- Fitness / fatigue. Form is the derived difference (ctl - atl); it is not
  -- stored, so the two can never disagree with it.
  ctl           numeric,
  atl           numeric,
  resting_hr    int,
  hrv           numeric,
  sleep_secs    int,
  sleep_score   int,
  sleep_quality int,
  weight_kg     numeric,
  steps         int,
  vo2max        numeric,
  raw           jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, day)
);

ALTER TABLE runcoach.daily_wellness ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON runcoach.daily_wellness FROM anon;

-- The UNIQUE constraint indexes (user_id, day) ascending; this serves the
-- "most recent wellness for this athlete" lookup the readiness verdict makes.
CREATE INDEX IF NOT EXISTS daily_wellness_user_day_desc_idx
  ON runcoach.daily_wellness (user_id, day DESC);

COMMENT ON TABLE runcoach.daily_wellness IS
  'Daily recovery metrics from intervals.icu. One row per athlete per day, upserted on (user_id, day).';

-- bodyBattery, readiness, stress, respiration, spO2 and avgSleepingHR are
-- deliberately absent: they are Garmin-native composite scores that do not
-- propagate through intervals.icu, and were empty across all 366 probed days.
