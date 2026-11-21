-- Garmin Connect (the consumer web/mobile API) — pushes strength workouts
-- straight onto the athlete's Garmin calendar (2026-11-21).
--
-- Why: intervals.icu's Garmin upload sends the workout NAME and step timing,
-- but drops every step's text (measured on the watch's own FIT files:
-- wkt_step_name is empty), and the WeightTraining event never reached the
-- Garmin calendar at all. So exercise names cannot get to the watch through
-- intervals.icu. This is NOT an official Garmin API (the Personal API in
-- 20261024_garmin_personal.sql is read-only); the athlete chose it knowing it
-- can break.
--
--   garmin_connect_tokens    OAuth1 token (≈1 year) minted by a login the
--                            athlete runs on their own machine, the OAuth
--                            consumer it was minted with, and a cached OAuth2
--                            access token (≈1 day). All encrypted
--                            (lib/intervals/crypto.ts). The password is never
--                            stored or sent to the app.
--   garmin_connect_workouts  every workout the app created on Garmin Connect,
--                            so a re-push deletes only its own workouts.
--
-- RLS on with no policies, as for the other token tables: the app reaches
-- Postgres with the service-role key.

CREATE TABLE IF NOT EXISTS runcoach.garmin_connect_tokens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL UNIQUE,
  -- Encrypted JSON {oauth_token, oauth_token_secret, mfa_token?}.
  oauth1              text NOT NULL,
  -- Encrypted JSON {consumer_key, consumer_secret}.
  consumer            text NOT NULL,
  -- Encrypted JSON of the OAuth2 token; expires in about a day.
  oauth2              text,
  oauth2_expires_at   timestamptz,
  -- Off switch for pushing strength sessions.
  auto_push           boolean NOT NULL DEFAULT true,
  last_success_at     timestamptz,
  last_error          text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE runcoach.garmin_connect_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS runcoach.garmin_connect_workouts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             text NOT NULL,
  plan_id             uuid,
  week_number         int,
  -- Calendar day the workout is scheduled on (athlete's local date).
  scheduled_date      date NOT NULL,
  kind                text NOT NULL DEFAULT 'strength',
  garmin_workout_id   bigint NOT NULL,
  garmin_schedule_id  bigint,
  -- Hash of what was sent: an unchanged session is never re-pushed.
  content_hash        text NOT NULL,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, scheduled_date, kind)
);

CREATE INDEX IF NOT EXISTS garmin_connect_workouts_plan_week
  ON runcoach.garmin_connect_workouts (user_id, plan_id, week_number);

ALTER TABLE runcoach.garmin_connect_workouts ENABLE ROW LEVEL SECURITY;
