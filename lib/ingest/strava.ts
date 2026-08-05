/**
 * Strava -> `NormalizedRun`.
 *
 * The only Strava-shaped code left in the ingestion path. Both sync routes
 * (manual and cron) build their runs through here and hand them to
 * `upsertRun`, so the mapping exists once.
 *
 * Laps and HR streams are returned as thunks, not values: `upsertRun` calls
 * them only on the paths that need them — streams when a row is missing its
 * zones, laps when a row has none. Fetching eagerly would spend Strava rate
 * limit on every already-synced activity in the window.
 */

import { formatPace } from '@/lib/utils/pace';
import type { HrStream, NormalizedLap, NormalizedRun } from '@/lib/ingest/upsert-run';

const STRAVA_API = 'https://www.strava.com/api/v3';

export interface StravaActivity {
  id: number;
  type: string;
  name: string;
  start_date: string;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
}

export interface StravaLap {
  lap_index: number;
  distance: number;
  moving_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
}

/** Strava reports both outdoor and treadmill runs; everything else is ignored. */
export function isRunActivity(a: { type: string }): boolean {
  return a.type === 'Run' || a.type === 'VirtualRun';
}

export function filterRuns(activities: unknown): StravaActivity[] {
  if (!Array.isArray(activities)) return [];
  return (activities as StravaActivity[]).filter(isRunActivity);
}

async function fetchLaps(activityId: number, accessToken: string): Promise<NormalizedLap[] | null> {
  const response = await fetch(`${STRAVA_API}/activities/${activityId}/laps`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return (data as StravaLap[]).map((lap) => ({
    lapNumber: lap.lap_index,
    distanceKm: lap.distance / 1000,
    durationSec: lap.moving_time,
    avgHr: lap.average_heartrate ?? null,
    maxHr: lap.max_heartrate ?? null,
    // average_speed is m/s; the reciprocal in min/km is what formatPace wants.
    avgPaceStr: lap.average_speed > 0 ? formatPace(1 / ((lap.average_speed * 60) / 1000)) : null,
  }));
}

async function fetchHrStream(activityId: number, accessToken: string): Promise<HrStream | null> {
  const response = await fetch(
    `${STRAVA_API}/activities/${activityId}/streams?keys=heartrate,time&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;

  const streams = await response.json();
  const hr = streams?.heartrate?.data;
  if (!Array.isArray(hr) || hr.length === 0) return null;

  return { hr, time: streams?.time?.data ?? null };
}

export function toNormalizedRun(activity: StravaActivity, accessToken: string): NormalizedRun {
  return {
    externalId: `strava_${activity.id}`,
    date: activity.start_date,
    distanceKm: activity.distance / 1000,
    durationMin: activity.moving_time / 60,
    avgHr: activity.average_heartrate ?? null,
    maxHr: activity.max_heartrate ?? null,
    calories: activity.calories ?? null,
    workoutName: activity.name,
    dataSource: 'strava_sync',
    hrStream: () => fetchHrStream(activity.id, accessToken),
    laps: () => fetchLaps(activity.id, accessToken),
  };
}
