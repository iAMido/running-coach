/**
 * `runcoach.garmin_tokens` + `runcoach.garmin_daily_wellness` data access.
 *
 * Only this file and `lib/db/wellness.ts` should read `garmin_daily_wellness`;
 * everything else goes through the wellness readers, so the coach and the app
 * cannot reason from different numbers.
 */

import { supabase } from '@/lib/db/supabase';
import { daysBetweenDateStr, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { GarminDailyWellness, GarminToken } from '@/lib/db/types';
import type { GarminWellnessRow } from '@/lib/ingest/garmin-wellness';

export async function getGarminToken(userId: string): Promise<GarminToken | null> {
  const { data, error } = await supabase.from('garmin_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read garmin_tokens: ${error.message}`);
  return (data as GarminToken) ?? null;
}

export async function updateGarminToken(userId: string, patch: Partial<GarminToken>): Promise<void> {
  const { error } = await supabase
    .from('garmin_tokens')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to update garmin_tokens: ${error.message}`);
}

/**
 * Upsert on (user_id, day).
 *
 * Every row from `mergeGarminDays` carries the same key set, and a component
 * that failed this run contributes NO keys, so its columns keep their stored
 * values. A newer read of a day the component did return replaces it: Garmin
 * recalculates recent days (HRV status, body battery), so newer is better.
 */
export async function upsertGarminWellnessDays(rows: GarminWellnessRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('garmin_daily_wellness')
    .upsert(rows.map((r) => ({ ...r, synced_at: now })), { onConflict: 'user_id,day' });
  if (error) throw new Error(`Failed to upsert garmin wellness: ${error.message}`);
  return rows.length;
}

/** Rows from `days` days ago through today — `days + 1` calendar days, like `getRecentWellness`. */
export async function getRecentGarminWellness(userId: string, days = 7): Promise<GarminDailyWellness[]> {
  const { data, error } = await supabase
    .from('garmin_daily_wellness')
    .select('*')
    .eq('user_id', userId)
    .gte('day', userDateStrDaysAgo(days))
    .order('day', { ascending: false });
  if (error) throw new Error(`Failed to read garmin wellness: ${error.message}`);
  return (data ?? []) as GarminDailyWellness[];
}

/** What the status endpoint, health audit and smoke test report. Never includes secrets. */
export interface GarminFeedStatus {
  connected: boolean;
  keyExpiresAt: string | null;
  /** Negative once expired. */
  keyDaysLeft: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  cooldownUntil: string | null;
  /** Days in the last 7 with a sleep or body-battery reading. */
  daysWithReadings7d: number;
  latestReadingDay: string | null;
}

/** Warn this many days before the key expires. Garmin's own email comes at 7. */
export const GARMIN_KEY_WARN_DAYS = 14;

export async function getGarminFeedStatus(userId: string): Promise<GarminFeedStatus> {
  const token = await getGarminToken(userId);
  if (!token) {
    return {
      connected: false, keyExpiresAt: null, keyDaysLeft: null, lastSuccessAt: null, lastError: null,
      cooldownUntil: null, daysWithReadings7d: 0, latestReadingDay: null,
    };
  }
  // Today plus the 6 days before it — `getRecentGarminWellness(n)` spans n+1 calendar days.
  const recent = await getRecentGarminWellness(userId, 6).catch(() => [] as GarminDailyWellness[]);
  const withReadings = recent.filter((d) => d.sleep_secs != null || d.body_battery_max != null);
  return {
    connected: true,
    keyExpiresAt: token.key_expires_at,
    keyDaysLeft: daysBetweenDateStr(userDateStr(), token.key_expires_at),
    lastSuccessAt: token.last_success_at ?? null,
    lastError: token.last_error ?? null,
    cooldownUntil: token.cooldown_until ?? null,
    daysWithReadings7d: withReadings.length,
    latestReadingDay: withReadings[0]?.day ?? null,
  };
}

/**
 * The athlete's own normal for the Garmin-only signals — what every reading is
 * compared against. Never Garmin's generic bands (the same reason Friel's
 * decoupling bands were rejected: calibrated on other people).
 *
 * Below MIN_GARMIN_BASELINE_SAMPLES a field's baseline is null, and readers must
 * say "no baseline yet" rather than call a value high or low.
 */
export interface GarminBaselines {
  /**
   * Morning body battery = the day's PEAK (`body_battery_max`). Measured
   * 2026-10-24: the peak equals the at-wake reading on 129/136 days (within 3
   * on 135) — body battery tops out at waking — and exists on all 731 imported
   * days, while the at-wake reading needs Garmin's 6-point intraday series,
   * which carries no levels before ~April 2026.
   */
  bbPeakMedian: number | null;
  /** 10th percentile: "below your usual range" starts here. */
  bbPeakP10: number | null;
  stressMedian: number | null;
  deepSleepMedianSecs: number | null;
  sampleCount: number;
  windowDays: number;
}

export const MIN_GARMIN_BASELINE_SAMPLES = 10;

/** Nearest-rank percentile of an unsorted list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function garminBaselinesFrom(
  rows: Pick<GarminDailyWellness, 'body_battery_max' | 'stress_avg' | 'sleep_deep_secs'>[],
  windowDays: number,
): GarminBaselines {
  const nums = (k: 'body_battery_max' | 'stress_avg' | 'sleep_deep_secs') =>
    rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number');
  const enough = (xs: number[]) => xs.length >= MIN_GARMIN_BASELINE_SAMPLES;
  const bb = nums('body_battery_max');
  const stress = nums('stress_avg');
  const deep = nums('sleep_deep_secs');
  return {
    bbPeakMedian: enough(bb) ? percentile(bb, 50) : null,
    bbPeakP10: enough(bb) ? percentile(bb, 10) : null,
    stressMedian: enough(stress) ? percentile(stress, 50) : null,
    deepSleepMedianSecs: enough(deep) ? percentile(deep, 50) : null,
    sampleCount: bb.length,
    windowDays,
  };
}

/**
 * Baselines over the `windowDays` BEFORE today, so today's reading is never part
 * of its own normal. 90 days, not 28: a 10th percentile of 28 values is the
 * 3rd-lowest day, which is noise; with the history imported 90 are available.
 */
export async function getGarminBaselines(userId: string, windowDays = 90): Promise<GarminBaselines> {
  const { data, error } = await supabase
    .from('garmin_daily_wellness')
    .select('body_battery_max,stress_avg,sleep_deep_secs')
    .eq('user_id', userId)
    .gte('day', userDateStrDaysAgo(windowDays))
    .lt('day', userDateStr());
  if (error) throw new Error(`Failed to read garmin baselines: ${error.message}`);
  return garminBaselinesFrom((data ?? []) as GarminDailyWellness[], windowDays);
}
