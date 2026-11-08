-- Where a run's elevation_gain_m / elevation_loss_m came from (2026-11-09).
-- NULL = whatever the importer stored (intervals.icu's map-corrected value for
-- every run before the switch). 'watch' = the watch's barometric total, read
-- from Garmin. From 2026-11-08 the athlete chose the watch; history is left as
-- it was on purpose (his decision, a known break in the climb series).
alter table runcoach.runs add column if not exists elevation_source text
  check (elevation_source in ('watch'));
