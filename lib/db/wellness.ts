/**
 * `runcoach.daily_wellness` data access.
 *
 * Deliberately thin: upsert plus a recent-days read. The baseline maths that
 * Phase 8's readiness rules need (28-day rolling HRV mean, resting-HR baseline)
 * is left out until those rules exist and can say what shape they actually
 * want.
 */

import { supabase } from '@/lib/db/supabase';
import { userDateStrDaysAgo } from '@/lib/utils/user-time';
import type { DailyWellness } from '@/lib/db/types';
import type { NormalizedWellness } from '@/lib/ingest/intervals';

/**
 * Upsert a batch of wellness days on `(user_id, day)`.
 *
 * Full-row overwrite is correct here, unlike runs: intervals.icu recomputes
 * ctl/atl retroactively as activities land, so a newer read of an older day is
 * genuinely better data rather than a competing opinion. There is no
 * user-authored content on these rows to protect.
 */
export async function upsertWellnessDays(days: NormalizedWellness[]): Promise<number> {
  if (days.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = days.map((d) => ({ ...d, updated_at: now }));

  const { error } = await supabase.from('daily_wellness').upsert(rows, { onConflict: 'user_id,day' });
  if (error) throw new Error(`Failed to upsert wellness: ${error.message}`);

  return rows.length;
}

/** Most recent wellness days for a user, newest first. */
export async function getRecentWellness(userId: string, days = 7): Promise<DailyWellness[]> {
  const { data, error } = await supabase
    .from('daily_wellness')
    .select('*')
    .eq('user_id', userId)
    .gte('day', userDateStrDaysAgo(days))
    .order('day', { ascending: false });

  if (error) throw new Error(`Failed to read wellness: ${error.message}`);
  return (data ?? []) as DailyWellness[];
}

/**
 * Rolling baselines for the readiness rules.
 *
 * HRV is only meaningful relative to the athlete's own normal — an absolute
 * number says nothing. The SD matters as much as the mean: "1 SD below
 * baseline" is the threshold, so a stable athlete trips it on a smaller
 * absolute drop than a variable one, which is the correct behaviour.
 *
 * Everything returns null rather than a guess when coverage is thin. HRV is
 * absent ~12% of the year, and a "baseline" computed from three readings would
 * be noise presented as signal — the readiness rules are built to fall back to
 * training load when these are null, which is safer than acting on a fabricated
 * number.
 */
export interface WellnessBaselines {
  hrvMean: number | null;
  hrvSd: number | null;
  restingHrMean: number | null;
  /** Days with an HRV reading in the window — lets callers judge confidence. */
  hrvSampleCount: number;
  windowDays: number;
}

/** Below this many readings a baseline is noise, not signal. */
const MIN_BASELINE_SAMPLES = 10;

export async function getWellnessBaselines(userId: string, windowDays = 28): Promise<WellnessBaselines> {
  const { data } = await supabase
    .from('daily_wellness')
    .select('hrv,resting_hr')
    .eq('user_id', userId)
    .gte('day', userDateStrDaysAgo(windowDays))
    .order('day', { ascending: false });

  const rows = (data ?? []) as Pick<DailyWellness, 'hrv' | 'resting_hr'>[];

  const hrv = rows.map((r) => r.hrv).filter((v): v is number => typeof v === 'number');
  const rhr = rows.map((r) => r.resting_hr).filter((v): v is number => typeof v === 'number');

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let hrvMean: number | null = null;
  let hrvSd: number | null = null;
  if (hrv.length >= MIN_BASELINE_SAMPLES) {
    hrvMean = mean(hrv);
    // Population SD: this is the athlete's whole recent history, not a sample
    // drawn from something larger.
    hrvSd = Math.sqrt(mean(hrv.map((v) => (v - hrvMean!) ** 2)));
  }

  return {
    hrvMean,
    hrvSd,
    restingHrMean: rhr.length >= MIN_BASELINE_SAMPLES ? mean(rhr) : null,
    hrvSampleCount: hrv.length,
    windowDays,
  };
}

/** The newest wellness row, or null. Used to detect a stale recovery feed. */
export async function getLatestWellness(userId: string): Promise<DailyWellness | null> {
  const { data, error } = await supabase
    .from('daily_wellness')
    .select('*')
    .eq('user_id', userId)
    .order('day', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as DailyWellness) ?? null;
}
