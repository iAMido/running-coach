/**
 * intervals.icu -> `NormalizedRun`.
 *
 * Mirrors `lib/ingest/strava.ts`: the only intervals.icu-shaped code in the
 * ingestion path. Everything downstream goes through `upsertRun`.
 *
 * Laps and the HR stream are thunks, so `upsertRun` fetches them only when it
 * needs them — the stream when a row is missing its zones, laps when a row has
 * none. On a 400-day backfill that is the difference between ~117 extra API
 * calls and ~234.
 */

import { formatPace } from '@/lib/utils/pace';
import { utcFromUserLocal } from '@/lib/utils/user-time';
import { indoorAwareGain } from '@/lib/utils/elevation';
import type { IntervalsClient } from '@/lib/intervals/client';
import type { IntervalsActivity, IntervalsInterval, IntervalsWellness } from '@/lib/intervals/types';
import type { NormalizedLap, NormalizedRun } from '@/lib/ingest/upsert-run';

/**
 * The account also holds WeightTraining, Swim, Ride, VirtualRide, Hike,
 * Elliptical and Pilates. Only these two are runs.
 */
export function isRunActivity(a: { type?: string }): boolean {
  return a.type === 'Run' || a.type === 'VirtualRun';
}

export function filterRuns(activities: IntervalsActivity[]): IntervalsActivity[] {
  return (activities ?? []).filter(isRunActivity);
}

/** m/s -> min/km. The unit every pace column in this schema uses. */
export function speedToPaceMinKm(metresPerSecond: number | null | undefined): number | null {
  if (typeof metresPerSecond !== 'number' || metresPerSecond <= 0) return null;
  return 1000 / (metresPerSecond * 60);
}

/**
 * intervals.icu reports `average_cadence` as ONE-LEG rpm — measured 56.2-83.6
 * across this athlete's 117 runs, which doubles to 112-167 steps/min, exactly
 * where running cadence belongs.
 *
 * The doubling is guarded rather than unconditional: a source that ever starts
 * reporting true steps/min would otherwise be silently doubled into nonsense.
 * The threshold sits 36 above the highest value ever observed here, so no real
 * reading is near the boundary.
 */
const ONE_LEG_CADENCE_CEILING = 120;

export function toCadenceSpm(averageCadence: number | null | undefined): number | null {
  if (typeof averageCadence !== 'number' || averageCadence <= 0) return null;
  return Math.round(averageCadence < ONE_LEG_CADENCE_CEILING ? averageCadence * 2 : averageCadence);
}

/** `icu_intervals[]` -> laps. Index order gives the lap number. */
export function toNormalizedLaps(intervals: IntervalsInterval[]): NormalizedLap[] {
  return (intervals ?? []).map((lap, index) => {
    const pace = speedToPaceMinKm(lap.average_speed);
    return {
      lapNumber: index + 1,
      distanceKm: typeof lap.distance === 'number' ? lap.distance / 1000 : undefined,
      durationSec: typeof lap.moving_time === 'number' ? lap.moving_time : undefined,
      avgHr: lap.average_heartrate ?? null,
      maxHr: lap.max_heartrate ?? null,
      avgPaceStr: pace !== null ? formatPace(pace) : null,
      gapPaceMinKm: speedToPaceMinKm(lap.gap),
      cadenceSpm: toCadenceSpm(lap.average_cadence),
      elevationGainM: toMetres(lap.total_elevation_gain),
    };
  });
}

/**
 * Elevation arrives as a float with false precision (62.000008 m). Rounded to
 * whole metres, which is well inside barometric accuracy and stops the column
 * implying a resolution the sensor does not have.
 *
 * Negative is rejected rather than clamped: gain and loss are both reported
 * positive, so a negative would mean the provider changed convention, and
 * silently flipping the sign would hide that.
 */
export function toMetres(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

/**
 * The run's true UTC instant.
 *
 * `start_date` is authoritative and is used whenever present — it carries no
 * timezone assumption at all.
 *
 * `start_date_local` is local to WHERE THE RUN HAPPENED, not to the athlete's
 * home timezone. Converting it via `utcFromUserLocal` assumes Asia/Jerusalem,
 * which silently breaks for travel: the 2025 New York trip lands 6-7h out,
 * far enough that the fuzzy matcher misses the existing row and inserts a
 * duplicate instead of enriching it. It survives only as a fallback for an
 * activity with no `start_date`, where a home-timezone guess beats nothing.
 */
export function resolveRunDate(activity: IntervalsActivity): string {
  if (activity.start_date) {
    const parsed = Date.parse(activity.start_date);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }

  // ANOMALY, not a routine path: start_date was populated on 117/117 runs.
  // Reaching here silently reintroduces the New York bug for any run recorded
  // abroad, and no test would catch it — every fixture is in Israel.
  console.warn(
    `[intervals] activity ${activity.id} ("${activity.name}") has no start_date; ` +
      `falling back to converting start_date_local as Asia/Jerusalem. ` +
      `This is WRONG if the run was recorded in another timezone — verify before trusting its date.`,
  );
  return utcFromUserLocal(activity.start_date_local);
}

export function toNormalizedRun(activity: IntervalsActivity, client: IntervalsClient): NormalizedRun {
  return {
    externalId: `icu_${activity.id}`,
    date: resolveRunDate(activity),
    distanceKm: activity.distance / 1000,
    durationMin: activity.moving_time / 60,
    avgHr: activity.average_heartrate ?? null,
    maxHr: activity.max_heartrate ?? null,
    calories: activity.calories ?? null,
    workoutName: activity.name,
    dataSource: 'intervals_sync',
    // Grade-adjusted pace. On net-descending terrain this diverges from raw
    // pace by 36-48 s/km, which is the difference between reading a session as
    // threshold work and reading it as an easy run.
    gapPaceMinKm: speedToPaceMinKm(activity.gap),
    cadenceSpm: toCadenceSpm(activity.average_cadence),
    // Climb and descent, both from the summary payload — no stream fetch and no
    // extra request. Gain is the training variable this athlete's mountain
    // build turns on (his median run is 8.8 m/km against a 61.9 m/km race);
    // loss is stored separately because eccentric descent loading is its own
    // stressor and a point-to-point route does not balance the two.
    // Indoor-aware: a treadmill reporting 0 m is almost always a treadmill
    // that never told the watch its incline, not a flat session. Storing the
    // zero would make a 700 m vertical workout read as a flat one — red
    // scorecard, and the weekly loop firing vert_below_phase on a week the
    // athlete executed perfectly. See indoorAwareGain.
    elevationGainM: indoorAwareGain(
      toMetres(activity.total_elevation_gain),
      activity.name,
      activity.type,
    ),
    elevationLossM: indoorAwareGain(
      toMetres(activity.total_elevation_loss),
      activity.name,
      activity.type,
    ),
    // Zones are ALWAYS derived from the stream against the athlete's own bands.
    // `icu_hr_zone_times` is on the summary and tempting, but intervals.icu
    // disagrees with athlete_profile about where the zones are — using it would
    // redefine "Z4" partway through the history.
    hrStream: () => client.getHrStream(activity.id),
    laps: async () => toNormalizedLaps(await client.getActivityIntervals(activity.id)),
  };
}

/** A `runcoach.daily_wellness` row, minus the columns the database fills. */
export interface NormalizedWellness {
  user_id: string;
  day: string;
  ctl: number | null;
  atl: number | null;
  resting_hr: number | null;
  hrv: number | null;
  sleep_secs: number | null;
  sleep_score: number | null;
  sleep_quality: number | null;
  weight_kg: number | null;
  steps: number | null;
  vo2max: number | null;
  raw: IntervalsWellness;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const int = (v: number | null | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/**
 * Wellness day -> database row. `id` on the API object is the DATE, not a row
 * identifier.
 *
 * Absent metrics stay null rather than becoming zero: HRV is missing about 12%
 * of the year (nights the watch was off), and a zero HRV would read as
 * catastrophic recovery to the readiness verdict rather than as "no data".
 */
export function toNormalizedWellness(userId: string, day: IntervalsWellness): NormalizedWellness {
  return {
    user_id: userId,
    day: day.id,
    ctl: num(day.ctl),
    atl: num(day.atl),
    resting_hr: int(day.restingHR),
    hrv: num(day.hrv),
    sleep_secs: int(day.sleepSecs),
    sleep_score: int(day.sleepScore),
    sleep_quality: int(day.sleepQuality),
    weight_kg: num(day.weight),
    steps: int(day.steps),
    vo2max: num(day.vo2max),
    raw: day,
  };
}
