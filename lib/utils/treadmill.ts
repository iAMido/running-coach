/**
 * Treadmill sessions and manual run corrections.
 *
 * Most treadmills never tell the watch their incline, so a session that
 * climbed 500 m syncs as unmeasured, and a wrist-estimated treadmill distance
 * is often wrong. The athlete marks the run as a treadmill session and enters
 * the numbers the treadmill showed. Pure: builds the row patch, the restore
 * patch, and the incline calculator; the API route applies them.
 *
 * Entered values go into the normal columns, so every reader (weekly climbing,
 * phase KPIs, scorecard, coaches) uses them with no special case, and the
 * fill-null-only sync never overwrites them. The watch's values are kept in
 * `manual_edit.original` the FIRST time a run is edited — later edits keep
 * that original, so "restore watch data" always restores the watch.
 */

import { formatPace } from '@/lib/utils/pace';
import { treadmillVertPerHour } from '@/lib/utils/elevation';

/** The columns a manual edit may change, as they were before any edit. */
export interface RunDataSnapshot {
  distance_km: number | null;
  duration_min: number | null;
  duration_sec: number | null;
  avg_pace_min_km: number | null;
  avg_pace_str: string | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  gap_pace_min_km: number | null;
}

export interface ManualEdit {
  edited_at: string;
  fields: string[];
  original: RunDataSnapshot;
  incline?: { grade_pct: number; speed_kmh: number; minutes: number };
}

export interface RunDataInput {
  is_treadmill: boolean;
  distance_km?: number;
  duration_min?: number;
  elevation_gain_m?: number;
  /** How the climbing was worked out, when the calculator was used. */
  incline?: { grade_pct: number; speed_kmh: number; minutes: number };
}

type RunRow = RunDataSnapshot & { is_treadmill?: boolean | null; manual_edit?: ManualEdit | null };

const SNAPSHOT_KEYS: (keyof RunDataSnapshot)[] = [
  'distance_km', 'duration_min', 'duration_sec', 'avg_pace_min_km', 'avg_pace_str',
  'elevation_gain_m', 'elevation_loss_m', 'gap_pace_min_km',
];

/** Distance and climbing from a treadmill's grade, speed and time. */
export function inclineSession(gradePct: number, speedKmh: number, minutes: number): { distance_km: number; elevation_gain_m: number } {
  return {
    distance_km: Math.round(((speedKmh * minutes) / 60) * 100) / 100,
    elevation_gain_m: Math.round((treadmillVertPerHour(gradePct, speedKmh) * minutes) / 60),
  };
}

/** The row patch for a manual edit. Throws on values no run can have. */
export function buildRunEdit(run: RunRow, input: RunDataInput, now = new Date()): Record<string, unknown> {
  const original: RunDataSnapshot = run.manual_edit?.original
    ?? Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, run[k] ?? null])) as unknown as RunDataSnapshot;

  const distance = input.distance_km ?? run.distance_km ?? null;
  const duration = input.duration_min ?? run.duration_min ?? null;
  if (distance !== null && (distance <= 0 || distance > 150)) throw new Error('distance must be between 0 and 150 km');
  if (duration !== null && (duration <= 0 || duration > 1440)) throw new Error('duration must be between 0 and 24 h');
  if (input.elevation_gain_m !== undefined && (input.elevation_gain_m < 0 || input.elevation_gain_m > 10000)) {
    throw new Error('climbing must be between 0 and 10,000 m');
  }

  const pace = distance && duration ? duration / distance : null;
  const fields = SNAPSHOT_KEYS.filter((k) =>
    (k === 'distance_km' && input.distance_km !== undefined)
    || (k === 'duration_min' && input.duration_min !== undefined)
    || (k === 'elevation_gain_m' && input.elevation_gain_m !== undefined));

  const patch: Record<string, unknown> = {
    is_treadmill: input.is_treadmill,
    distance_km: distance,
    duration_min: duration,
    duration_sec: duration !== null ? Math.round(duration * 60) : null,
    avg_pace_min_km: pace !== null ? Math.round(pace * 1000) / 1000 : null,
    avg_pace_str: pace !== null ? formatPace(pace) : null,
    manual_edit: {
      edited_at: now.toISOString(),
      fields: [...new Set([...(run.manual_edit?.fields ?? []), ...fields, ...(input.is_treadmill ? ['is_treadmill'] : [])])],
      original,
      ...(input.incline ? { incline: input.incline } : {}),
    } satisfies ManualEdit,
  };
  if (input.elevation_gain_m !== undefined) patch.elevation_gain_m = Math.round(input.elevation_gain_m);
  if (input.is_treadmill) {
    // A treadmill never descends — 0 is a real measurement here, not a gap.
    patch.elevation_loss_m = 0;
    // The watch's grade-adjusted pace on a belt is meaningless; unmeasured
    // beats a confident wrong number (the app's standing rule).
    patch.gap_pace_min_km = null;
  }
  return patch;
}

/** Put the watch's values back and clear the edit. */
export function buildRunRestore(run: RunRow): Record<string, unknown> | null {
  if (!run.manual_edit?.original) return null;
  return { ...run.manual_edit.original, is_treadmill: false, manual_edit: null };
}
