-- intervals.icu migration, phase 2b — new HR anchors.
--
-- Max HR was corrected to 191 on 2026-08-05 and is already live on Garmin and
-- in intervals.icu. `parseZonesFromProfile` reads THIS row, not Garmin, so
-- without this update every newly synced run would be bucketed against stale
-- bands.
--
-- Bands are the existing %-of-max model (~65 / 75 / 81 / 88 / 95 / 100%)
-- rescaled from 185 to 191, preserving its shape:
--
--   Zone   old (max 185)   new (max 191)
--   Z1     0-120           0-124
--   Z2     120-138         124-143
--   Z3     138-150         143-155
--   Z4     150-162         155-168
--   Z5     162-175         168-181
--   Z6     175-185         181-191
--
-- lactate_threshold_hr deliberately STAYS AT 165. An earlier draft of the spec
-- said 173 (intervals.icu's value); that was premature. 173 is a peak-fitness
-- threshold inferred from a 2023 half marathon, but current CTL is 17.7 and the
-- hardest recent session peaked at 166 — below what 173 assumes. The true
-- threshold is unknown until tested; 165 is the closer placeholder.
--
-- Why %-of-max rather than threshold-anchored zones — decided against measured
-- data, not preference. Z4+ time across the last 10 runs:
--
--   run                            OLD(185)  chosen(191)  LTHR-173  icu native
--   2026-08-03 Threshold Intervals   26.0%      15.4%       2.7%      3.9%
--   2026-08-01 Long Run              59.2%      46.0%      21.6%     24.5%
--   2026-07-25 Long Run              29.7%      21.8%      13.0%     13.7%
--   runs tripping Z4+ > 40%           1/10       1/10        0/10      0/10
--
-- A threshold-anchored model silently disables rule 3 in lib/utils/readiness.ts:
-- nothing in six weeks would register as hard, including a long run that plainly
-- was. Max HR is a stable anchor; threshold moves with fitness and his has
-- dropped a long way. The rescale also minimises discontinuity against ~660 runs
-- of %max-based history. Do not revisit without re-running that comparison.
--
-- Historical pct_z1..pct_z6 are deliberately NOT recomputed — the new zones
-- apply going forward only. See CLAUDE.md for the cutover note.
--
-- Applied via Supabase MCP on 2026-08-05.

UPDATE runcoach.athlete_profile
   SET max_hr     = 191,
       hr_zone_z1 = '0-124',
       hr_zone_z2 = '124-143',
       hr_zone_z3 = '143-155',
       hr_zone_z4 = '155-168',
       hr_zone_z5 = '168-181',
       hr_zone_z6 = '181-191',
       updated_at = now()
 WHERE user_id = 'idomosseri@gmail.com';
