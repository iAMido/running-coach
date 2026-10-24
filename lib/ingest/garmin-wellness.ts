/**
 * Garmin Personal API -> `runcoach.garmin_daily_wellness` rows.
 *
 * Pure. Each endpoint has its own mapper returning the columns it owns, keyed by
 * day, and `mergeGarminDays` combines them. Keeping the components separate
 * matters for the sync: when one endpoint fails, its columns are LEFT OUT of
 * the upsert rather than written as null, so a failed sleep fetch cannot erase
 * yesterday's sleep.
 *
 * Absent is null, never 0. A body battery of 0 reads as exhaustion and a stress
 * of 0 as total calm; Garmin also uses negative stress values (-1, -2) for
 * "not measured". Out-of-range values are rejected (null), not clamped: a clamp
 * would hide that Garmin changed a convention.
 *
 * Day attribution is Garmin's own `calendarDate` — the WAKE date — which was
 * measured identical to intervals.icu's on 14/14 days.
 */

import type {
  GarminBodyBatteryReport,
  GarminDailySleep,
  GarminDailySummary,
  GarminHrvSummary,
  GarminScore,
} from '@/lib/garmin/types';

/** Columns of `garmin_daily_wellness`, minus the keys and bookkeeping. */
export interface GarminWellnessColumns {
  body_battery_min: number | null;
  body_battery_max: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  body_battery_at_wake: number | null;
  stress_avg: number | null;
  stress_max: number | null;
  stress_qualifier: string | null;
  stress_high_secs: number | null;
  sleep_secs: number | null;
  sleep_score: number | null;
  sleep_deep_secs: number | null;
  sleep_light_secs: number | null;
  sleep_rem_secs: number | null;
  sleep_awake_secs: number | null;
  sleep_awake_count: number | null;
  sleep_stress_avg: number | null;
  sleep_avg_hr: number | null;
  sleep_respiration_avg: number | null;
  sleep_spo2_avg: number | null;
  sleep_need_mins: number | null;
  sleep_need_baseline_mins: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
  hrv_last_night: number | null;
  hrv_weekly_avg: number | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  hrv_status: string | null;
  resting_hr: number | null;
}

export type GarminComponent = 'hrv' | 'summary' | 'sleep' | 'bodyBattery';

/** Columns per component — the set a sync writes when that component succeeded. */
export const COMPONENT_COLUMNS: Record<GarminComponent, (keyof GarminWellnessColumns)[]> = {
  hrv: ['hrv_last_night', 'hrv_weekly_avg', 'hrv_baseline_low', 'hrv_baseline_high', 'hrv_status'],
  summary: [
    'resting_hr', 'stress_avg', 'stress_max', 'stress_qualifier', 'stress_high_secs',
    'body_battery_min', 'body_battery_max', 'body_battery_charged', 'body_battery_drained',
  ],
  sleep: [
    'sleep_secs', 'sleep_score', 'sleep_deep_secs', 'sleep_light_secs', 'sleep_rem_secs', 'sleep_awake_secs',
    'sleep_awake_count', 'sleep_stress_avg', 'sleep_avg_hr', 'sleep_respiration_avg', 'sleep_spo2_avg',
    'sleep_need_mins', 'sleep_need_baseline_mins', 'sleep_start', 'sleep_end',
  ],
  // at_wake needs the sleep end too; the merge leaves it out unless both succeeded.
  bodyBattery: ['body_battery_at_wake'],
};

export interface GarminWellnessRow extends Partial<GarminWellnessColumns> {
  user_id: string;
  day: string;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------- validators

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A value inside [min, max], rounded; anything else is "not measured". */
export function inRange(v: unknown, min: number, max: number, decimals = 0): number | null {
  const n = finite(v);
  if (n === null || n < min || n > max) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Non-negative seconds, rounded. */
export function secs(v: unknown): number | null {
  return inRange(v, 0, 7 * 86_400);
}

/** 0-100 scores: body battery, stress, sleep score. Negative = Garmin's "not measured" marker. */
export function score(v: unknown): number | null {
  return inRange(v, 0, 100);
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Garmin GMT timestamps: epoch ms on sleep, "YYYY-MM-DD HH:mm:ss" on other
 * endpoints. Both are UTC. Returns epoch ms or null.
 */
export function gmtMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const s = v.trim().replace(' ', 'T');
    const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function scoreValue(s: GarminScore | undefined): number | null {
  if (typeof s === 'number') return score(s);
  return score(s?.value);
}

// ---------------------------------------------------------------- per endpoint

export function mapHrv(summaries: GarminHrvSummary[]): Map<string, Partial<GarminWellnessColumns>> {
  const out = new Map<string, Partial<GarminWellnessColumns>>();
  for (const h of summaries ?? []) {
    if (!isDay(h?.calendarDate)) continue;
    out.set(h.calendarDate, {
      hrv_last_night: inRange(h.lastNightAvg, 1, 300),
      hrv_weekly_avg: inRange(h.weeklyAvg, 1, 300),
      hrv_baseline_low: inRange(h.baseline?.balancedLow, 1, 300),
      hrv_baseline_high: inRange(h.baseline?.balancedUpper, 1, 300),
      hrv_status: text(h.status),
    });
  }
  return out;
}

export function mapDailySummaries(days: GarminDailySummary[]): Map<string, Partial<GarminWellnessColumns>> {
  const out = new Map<string, Partial<GarminWellnessColumns>>();
  for (const d of days ?? []) {
    if (!isDay(d?.calendarDate)) continue;
    const highMs = finite(d.stress?.highStressDurationInMillis);
    out.set(d.calendarDate, {
      resting_hr: inRange(d.heartRate?.restingValue, 25, 120),
      stress_avg: score(d.stress?.avgLevel),
      stress_max: score(d.stress?.maxLevel),
      stress_qualifier: text(d.stress?.qualifier),
      stress_high_secs: highMs === null ? null : secs(highMs / 1000),
      body_battery_min: score(d.bodyBattery?.minValue),
      body_battery_max: score(d.bodyBattery?.maxValue),
      body_battery_charged: score(d.bodyBattery?.chargedValue),
      body_battery_drained: score(d.bodyBattery?.drainedValue),
    });
  }
  return out;
}

/**
 * One night. Keyed by the response's own calendarDate, falling back to the
 * date that was asked for. A night with no total sleep is "not measured"
 * altogether — returns null, so the day gets no sleep columns from it.
 */
export function mapSleep(
  night: GarminDailySleep | null,
  requestedDay: string,
): { day: string; columns: Partial<GarminWellnessColumns> } | null {
  if (!night) return null;
  const total = secs(night.sleepTimeSeconds);
  if (total === null || total === 0) return null;
  const start = gmtMs(night.sleepStartTimestampGMT);
  const end = gmtMs(night.sleepEndTimestampGMT);
  return {
    day: isDay(night.calendarDate) ? night.calendarDate : requestedDay,
    columns: {
      sleep_secs: total,
      sleep_score: scoreValue(night.sleepScores?.overall),
      sleep_deep_secs: secs(night.deepSleepSeconds),
      sleep_light_secs: secs(night.lightSleepSeconds),
      sleep_rem_secs: secs(night.remSleepSeconds),
      sleep_awake_secs: secs(night.awakeSleepSeconds),
      sleep_awake_count: inRange(night.awakeCount, 0, 500),
      sleep_stress_avg: inRange(night.avgSleepStress, 0, 100, 1),
      sleep_avg_hr: inRange(night.avgHeartRate, 25, 150, 1),
      sleep_respiration_avg: inRange(night.averageRespirationValue, 1, 60, 1),
      sleep_spo2_avg: inRange(night.averageSpO2Value, 50, 100, 1),
      sleep_need_mins: inRange(night.sleepNeed?.actual, 1, 24 * 60),
      sleep_need_baseline_mins: inRange(night.sleepNeed?.baseline, 1, 24 * 60),
      sleep_start: start === null ? null : new Date(start).toISOString(),
      sleep_end: end === null ? null : new Date(end).toISOString(),
    },
  };
}

/** How far from wake a body battery reading may be and still count as "at wake". */
export const WAKE_READING_TOLERANCE_MS = 30 * 60 * 1000;

/**
 * Body battery at the moment of waking, from the intraday series.
 *
 * Columns are located by the response's own descriptor list
 * (`bodyBatteryValueDescriptorDTOList`), never by position: without
 * descriptors there is no reliable way to tell a level from a status code, so
 * the answer is null rather than a guess.
 */
export function bodyBatteryAtWake(report: GarminBodyBatteryReport | undefined, wakeMs: number | null): number | null {
  if (!report || wakeMs === null) return null;
  const descriptors = report.bodyBatteryValueDescriptorDTOList ?? [];
  const tsIndex = descriptors.find((d) => d.bodyBatteryValueDescriptorKey === 'timestamp')?.bodyBatteryValueDescriptorIndex;
  const levelIndex = descriptors.find((d) => d.bodyBatteryValueDescriptorKey === 'bodyBatteryLevel')
    ?.bodyBatteryValueDescriptorIndex;
  if (typeof tsIndex !== 'number' || typeof levelIndex !== 'number') return null;

  let best: { distance: number; level: number } | null = null;
  for (const row of report.bodyBatteryValuesArray ?? []) {
    const ts = gmtMs(row?.[tsIndex]);
    const level = score(row?.[levelIndex]);
    if (ts === null || level === null) continue;
    const distance = Math.abs(ts - wakeMs);
    if (distance <= WAKE_READING_TOLERANCE_MS && (!best || distance < best.distance)) best = { distance, level };
  }
  return best?.level ?? null;
}

// ---------------------------------------------------------------- merge

export interface GarminFetched {
  hrv?: GarminHrvSummary[];
  summaries?: GarminDailySummary[];
  /** Requested day -> response (null = nothing recorded that night). */
  sleep?: Map<string, GarminDailySleep | null>;
  bodyBattery?: GarminBodyBatteryReport[];
}

/**
 * Combine the endpoints that SUCCEEDED into one row per day.
 *
 * A component that was not fetched (`undefined`) contributes no keys at all,
 * so the upsert leaves those columns as they are. A component that was fetched
 * but has nothing for a day writes explicit nulls for that day — it is a real
 * "not measured". Every row in the result carries the same key set, which is
 * what a batch upsert needs.
 */
export function mergeGarminDays(userId: string, days: string[], fetched: GarminFetched): GarminWellnessRow[] {
  const hrv = fetched.hrv ? mapHrv(fetched.hrv) : null;
  const summaries = fetched.summaries ? mapDailySummaries(fetched.summaries) : null;

  const sleep = new Map<string, { columns: Partial<GarminWellnessColumns>; raw: GarminDailySleep }>();
  if (fetched.sleep) {
    for (const [requested, night] of fetched.sleep) {
      const mapped = mapSleep(night, requested);
      if (mapped && night) sleep.set(mapped.day, { columns: mapped.columns, raw: night });
    }
  }

  const batteryByDay = new Map((fetched.bodyBattery ?? []).filter((r) => isDay(r?.date)).map((r) => [r.date, r]));
  const canComputeWake = Boolean(fetched.bodyBattery && fetched.sleep);

  const nullsFor = (component: GarminComponent): Partial<GarminWellnessColumns> =>
    Object.fromEntries(COMPONENT_COLUMNS[component].map((c) => [c, null]));

  return days.map((day) => {
    const row: GarminWellnessRow = { user_id: userId, day, raw: {} };

    if (hrv) {
      Object.assign(row, nullsFor('hrv'), hrv.get(day) ?? {});
      const src = fetched.hrv?.find((h) => h.calendarDate === day);
      if (src) row.raw.hrv = src;
    }
    if (summaries) {
      Object.assign(row, nullsFor('summary'), summaries.get(day) ?? {});
      const src = fetched.summaries?.find((s) => s.calendarDate === day);
      if (src) row.raw.summary = { heartRate: src.heartRate, stress: src.stress, bodyBattery: src.bodyBattery };
    }
    if (fetched.sleep) {
      const night = sleep.get(day);
      Object.assign(row, nullsFor('sleep'), night?.columns ?? {});
      if (night) row.raw.sleep = night.raw;
    }
    if (canComputeWake) {
      const wakeMs = sleep.get(day)?.columns.sleep_end ? Date.parse(sleep.get(day)!.columns.sleep_end!) : null;
      row.body_battery_at_wake = bodyBatteryAtWake(batteryByDay.get(day), wakeMs);
      const report = batteryByDay.get(day);
      if (report) {
        // Shape of the intraday series, kept so a null at-wake value can be
        // explained without re-fetching: no series at all, a series that does
        // not reach wake time, or descriptors under unexpected keys.
        const values = report.bodyBatteryValuesArray ?? [];
        row.raw.bodyBattery = {
          charged: report.charged,
          drained: report.drained,
          values: values.length,
          firstRow: values[0] ?? null,
          lastRow: values.at(-1) ?? null,
          descriptors: (report.bodyBatteryValueDescriptorDTOList ?? []).map((d) => d.bodyBatteryValueDescriptorKey ?? null),
        };
      }
    }
    return row;
  });
}
