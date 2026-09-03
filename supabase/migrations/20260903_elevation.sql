-- Chunk 1 — elevation capture for the mountain-race build (21K / 1300 m, 2027-07-03).
--
-- Additive and nullable throughout. Existing rows stay null until the
-- intervals.icu backfill re-run fills them; nothing is rewritten here.
--
-- Probed live against the account on 2026-09-03, 130 run activities over 400
-- days: `total_elevation_gain` 128/130, `total_elevation_loss` 128/130, both on
-- the activity SUMMARY payload `getActivities` already fetches. Descent
-- therefore costs no extra API call and needs no altitude stream.
--
-- `average_vertical_speed` (VAM) is present on only 9/130 and is deliberately
-- NOT stored — a column populated 7% of the time reads as a metric and behaves
-- as a coin flip.

-- ------------------------------------------------------------------- runs
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS elevation_gain_m int;
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS elevation_loss_m int;

COMMENT ON COLUMN runcoach.runs.elevation_gain_m IS
  'Metres climbed. From intervals.icu total_elevation_gain (their own barometric/DEM correction, already applied server-side). Null on every run recorded before 2025-08-05.';
COMMENT ON COLUMN runcoach.runs.elevation_loss_m IS
  'Metres descended, positive. From intervals.icu total_elevation_loss. Descent is its own stressor (eccentric loading), not the mirror of gain — a point-to-point run has neither equal to the other.';

-- Gradient, not altitude, is the training problem this build exists to solve:
-- measured over the athlete's 128 runs carrying elevation, the median run is
-- 8.8 m/km and the steepest ever recorded is 20.2. Race day is 61.9 — roughly
-- 3x his hardest single run and 7x his typical one. Stored generated so it can
-- be filtered and ordered in SQL without every caller re-deriving it (and
-- re-deriving it slightly differently).
ALTER TABLE runcoach.runs
  ADD COLUMN IF NOT EXISTS vert_per_km numeric
  GENERATED ALWAYS AS (elevation_gain_m::numeric / NULLIF(distance_km, 0)) STORED;

COMMENT ON COLUMN runcoach.runs.vert_per_km IS
  'Metres of climb per km. Generated from elevation_gain_m / distance_km. Athlete baseline as of 2026-09-03: median 8.8, p90 11.6, max 20.2. Target race: 61.9.';

-- ------------------------------------------------------------------- laps
--
-- Present on 191/191 laps across a 12-run sample. There is NO per-lap
-- `total_elevation_loss` — 0/191 — so laps carry gain only.
--
-- ⚠ Lap gain does NOT sum to the run's gain, and must never be used to derive
-- it. Measured on i172836000: activity 210.9 m against 130.4 m summed across
-- its laps. intervals.icu laps are auto-detected work/recovery segments that do
-- not tile the whole activity, so the shortfall is uncovered time, not an error
-- in either number. The run total comes from the summary payload; this column
-- exists only to say which SEGMENT of a session did the climbing.
ALTER TABLE runcoach.laps ADD COLUMN IF NOT EXISTS elevation_gain_m int;

COMMENT ON COLUMN runcoach.laps.elevation_gain_m IS
  'Metres climbed in this lap. From icu_intervals[].total_elevation_gain. Does NOT sum to runs.elevation_gain_m — laps are detected segments and do not cover the whole activity. No per-lap loss exists.';
