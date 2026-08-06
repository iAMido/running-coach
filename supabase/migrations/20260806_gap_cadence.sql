-- Tier 1 — surface two fields intervals.icu already returns and we discarded.
--
-- Both are additive and nullable. Existing rows stay null until the backfill
-- re-run populates them; nothing is rewritten here.
--
-- Applied via Supabase MCP on 2026-08-06.

-- ------------------------------------------------------------ grade-adjusted pace
--
-- Stored as min/km to match the `avg_pace_min_km` sitting beside it. The API
-- returns `gap` in m/s, but keeping two units for the same concept in one row
-- invites someone to subtract them directly, and the first thing anyone wants
-- from these columns is exactly that difference.
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS gap_pace_min_km numeric;
ALTER TABLE runcoach.laps ADD COLUMN IF NOT EXISTS gap_pace_min_km numeric;

COMMENT ON COLUMN runcoach.runs.gap_pace_min_km IS
  'Grade-adjusted pace, min/km. From intervals.icu `gap` (m/s), converted at ingest. Compare directly against avg_pace_min_km.';
COMMENT ON COLUMN runcoach.laps.gap_pace_min_km IS
  'Grade-adjusted pace for this lap, min/km. From icu_intervals[].gap (m/s).';

-- ------------------------------------------------------------------- cadence
--
-- STEPS per minute, both feet. intervals.icu reports `average_cadence` as
-- one-leg rpm — measured range across this athlete's 117 runs is 56.2-83.6
-- (median 78.5), which doubles to 112-167 spm, exactly where running cadence
-- belongs. A raw 78 stored under a bare `cadence` name reads as a catastrophic
-- shuffle, so the column name carries the unit and the doubling happens once,
-- at ingest.
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS cadence_spm int;
ALTER TABLE runcoach.laps ADD COLUMN IF NOT EXISTS cadence_spm int;

COMMENT ON COLUMN runcoach.runs.cadence_spm IS
  'Cadence in STEPS per minute (both feet). intervals.icu returns one-leg rpm; doubled at ingest. Do not double again.';
COMMENT ON COLUMN runcoach.laps.cadence_spm IS
  'Cadence in STEPS per minute (both feet). See runs.cadence_spm.';
