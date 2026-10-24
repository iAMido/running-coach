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
  const recent = await getRecentGarminWellness(userId, 7).catch(() => [] as GarminDailyWellness[]);
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
