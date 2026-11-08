/**
 * Garmin Connect activity -> NormalizedRun (2026-11-09).
 *
 * The second activity source. intervals.icu stays the main one (GAP, its laps,
 * the watch push); this exists because intervals.icu can stop delivering — on
 * 2026-11-08 a dormant account meant a run Garmin had for an hour never reached
 * the app. A run imported from here gets distance, time, HR, zones, laps,
 * cadence, climb and the coach note at once. Grade-adjusted pace stays null
 * until intervals.icu delivers the same run and fills it (with its own laps,
 * which carry GAP, so decoupling can be computed).
 *
 * Climb is the watch's own barometric total: from 2026-11-08 the athlete chose
 * the watch over intervals.icu's map-corrected value (see WATCH_CLIMB_FROM).
 */

import FitParser from 'fit-file-parser';
import type { GarminActivitySummary } from '@/lib/garmin/types';
import type { HrStream, NormalizedLap, NormalizedRun } from '@/lib/ingest/upsert-run';
import { toCadenceSpm } from '@/lib/ingest/intervals';
import { calculatePace, formatPace } from '@/lib/utils/pace';

/** Runs on or after this date (UTC) take their climb from the watch. Earlier runs keep what was stored. */
export const WATCH_CLIMB_FROM = '2026-11-08';

const INDOOR_TYPES = /treadmill|indoor/i;

export function isGarminRun(a: GarminActivitySummary): boolean {
  return /running/i.test(a.activityType?.typeKey ?? '');
}

/** "2026-11-08 18:15:37" (GMT, no zone) -> ISO instant. */
export function garminGmtToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  return m ? `${m[1]}T${m[2]}.000Z` : null;
}

function metres(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

/**
 * Watch climb for one activity. An indoor run reporting 0 m is unmeasured, not
 * flat (most treadmills never send incline to the watch) — same rule as
 * `indoorAwareGain` for intervals.icu.
 */
export function watchClimb(a: GarminActivitySummary): { gain: number | null; loss: number | null } {
  const indoor = INDOOR_TYPES.test(a.activityType?.typeKey ?? '');
  const gain = metres(a.elevationGain);
  const loss = metres(a.elevationLoss);
  if (indoor) return { gain: gain ? gain : null, loss: gain ? 0 : null };
  return { gain, loss };
}

export interface ParsedFit {
  laps: NormalizedLap[];
  hrStream: HrStream | null;
}

interface FitLap {
  total_distance?: number;
  total_timer_time?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
}
interface FitRecord {
  heart_rate?: number;
  elapsed_time?: number;
}

/** Pure: parsed FIT data -> laps + HR stream. Distances in km (parser lengthUnit 'km'). */
export function fitDataToLapsAndStream(data: { laps?: FitLap[]; records?: FitRecord[] }): ParsedFit {
  const laps: NormalizedLap[] = (data.laps ?? []).map((l, i) => {
    const km = typeof l.total_distance === 'number' ? l.total_distance : undefined;
    const sec = typeof l.total_timer_time === 'number' ? l.total_timer_time : undefined;
    const pace = km && sec ? calculatePace(km, sec / 60) : null;
    return {
      lapNumber: i + 1,
      distanceKm: km,
      durationSec: sec,
      avgHr: l.avg_heart_rate ?? null,
      maxHr: l.max_heart_rate ?? null,
      avgPaceStr: pace ? formatPace(pace) : null,
      gapPaceMinKm: null,
      cadenceSpm: toCadenceSpm(l.avg_cadence),
      elevationGainM: null,
    };
  });

  const hr: number[] = [];
  const time: number[] = [];
  for (const r of data.records ?? []) {
    if (typeof r.heart_rate === 'number' && r.heart_rate > 0 && typeof r.elapsed_time === 'number') {
      hr.push(r.heart_rate);
      time.push(r.elapsed_time);
    }
  }
  return { laps, hrStream: hr.length ? { hr, time } : null };
}

export function parseFit(fit: Buffer): Promise<ParsedFit> {
  const parser = new FitParser({ force: true, speedUnit: 'km/h', lengthUnit: 'km', elapsedRecordField: true, mode: 'list' });
  return new Promise((resolve, reject) => {
    parser.parse(fit as unknown as ArrayBuffer, (err: unknown, data: unknown) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(fitDataToLapsAndStream(data as { laps?: FitLap[]; records?: FitRecord[] }));
    });
  });
}

/**
 * Summary -> NormalizedRun. `loadFit` is only called when upsertRun actually
 * needs laps or the HR stream (a new run), so a run intervals.icu already
 * delivered costs no download.
 */
export function toNormalizedGarminRun(
  a: GarminActivitySummary,
  loadFit: () => Promise<ParsedFit | null>,
): NormalizedRun | null {
  const date = garminGmtToIso(a.startTimeGMT);
  const distanceKm = typeof a.distance === 'number' ? a.distance / 1000 : 0;
  const seconds = a.movingDuration ?? a.duration ?? 0;
  if (!date || distanceKm <= 0 || seconds <= 0) return null;

  const climb = date.slice(0, 10) >= WATCH_CLIMB_FROM ? watchClimb(a) : { gain: null, loss: null };
  return {
    externalId: `garmin_${a.activityId}`,
    date,
    distanceKm,
    durationMin: seconds / 60,
    avgHr: a.averageHR ?? null,
    maxHr: a.maxHR ?? null,
    calories: a.calories ?? null,
    workoutName: a.activityName ?? null,
    dataSource: 'garmin_api',
    gapPaceMinKm: null,
    cadenceSpm: toCadenceSpm(a.averageRunningCadenceInStepsPerMinute),
    elevationGainM: climb.gain,
    elevationLossM: climb.loss,
    hrStream: async () => (await loadFit())?.hrStream ?? null,
    laps: async () => (await loadFit())?.laps ?? null,
  };
}
