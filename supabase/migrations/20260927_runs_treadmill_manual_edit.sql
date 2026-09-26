-- Treadmill sessions and manual run corrections (applied via Supabase MCP 2026-09-27).
--
-- Most treadmills never tell the watch their incline, so an indoor session
-- that climbed 500 m syncs as 0 m (stored as NULL = unmeasured, see
-- indoorAwareGain), and a wrist-estimated treadmill distance is often wrong.
-- The athlete can now mark a run as a treadmill session and enter distance,
-- duration and total climbing himself.
--
-- The entered values go into the normal columns (distance_km, duration_min,
-- elevation_gain_m ...) so every reader — weekly climbing, phase KPIs, the
-- scorecard, the coaches — uses them without special cases. The sync is
-- fill-null-only, so it never overwrites them. The watch's original values are
-- kept in manual_edit.original, so an edit is always reversible and the
-- provenance of every number is recorded.

-- True when the athlete marked the run as a treadmill session.
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS is_treadmill boolean NOT NULL DEFAULT false;
-- { edited_at, fields: [...], original: { distance_km, duration_min, ... }, incline?: { grade, speed_kmh, minutes } }
ALTER TABLE runcoach.runs ADD COLUMN IF NOT EXISTS manual_edit jsonb;
