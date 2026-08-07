/**
 * `runcoach.daily_wellness` data access.
 *
 * Deliberately thin: upsert plus a recent-days read. The baseline maths that
 * Phase 8's readiness rules need (28-day rolling HRV mean, resting-HR baseline)
 * is left out until those rules exist and can say what shape they actually
 * want.
 */

import { supabase } from '@/lib/db/supabase';
import { daysBetweenDateStr, userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
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

/**
 * The newest wellness row that actually carries a watch reading.
 *
 * ## Why the newest row is the wrong row
 *
 * The nightly cron runs at 21:40 UTC — 00:40 in Israel — so it creates today's
 * row less than an hour into the local day, before the watch has synced
 * anything. That row is not empty: intervals.icu computes `ctl`/`atl` from
 * training load, so they are present and current. Only the watch-sourced
 * fields are absent.
 *
 * The result was a Recovery tile reading "--" every single morning, and a
 * two-day HRV suppression rule that could never fire before the watch synced,
 * with yesterday's complete row sitting one index away. Structural, not a
 * one-off.
 *
 * So: fitness and form keep reading the latest row, and anything watch-sourced
 * reads the latest row WITH readings — carrying its age, because using
 * yesterday's HRV to judge today is a real approximation and every caller has
 * to be able to say so.
 */
export interface LatestRecoveryReading {
  row: DailyWellness;
  /** Calendar days between that row's `day` and today, user timezone. */
  ageDays: number;
  /**
   * The most recent HRV reading BEFORE `row` — what the two-day suppression
   * rule needs. Taking the next row down would hand that rule the same reading
   * it is already looking at whenever the latest row is a day old.
   */
  previousHrv: number | null;
  /**
   * True when `previousHrv` comes from the calendar day immediately before
   * `row.day`. The rule says "two days running", and two readings four days
   * apart are not that — a gap the watch left is not a trend.
   */
  previousHrvIsConsecutive: boolean;
}

/** A row counts as a reading only if the watch actually contributed something. */
function hasWatchReading(row: DailyWellness): boolean {
  return row.hrv != null || row.resting_hr != null || row.sleep_secs != null;
}

export async function getLatestRecoveryReading(
  userId: string,
  windowDays = 14,
): Promise<LatestRecoveryReading | null> {
  const { data, error } = await supabase
    .from('daily_wellness')
    .select('*')
    .eq('user_id', userId)
    .gte('day', userDateStrDaysAgo(windowDays))
    .order('day', { ascending: false });

  if (error) return null;
  const rows = (data ?? []) as DailyWellness[];

  const index = rows.findIndex(hasWatchReading);
  if (index === -1) return null;
  const row = rows[index];

  // Strictly before the chosen row, so it can never be the same reading.
  const previous = rows.slice(index + 1).find((r) => r.hrv != null) ?? null;

  return {
    row,
    ageDays: daysBetweenDateStr(row.day, userDateStr()),
    previousHrv: previous?.hrv ?? null,
    previousHrvIsConsecutive: previous ? daysBetweenDateStr(previous.day, row.day) === 1 : false,
  };
}

/**
 * The newest wellness row, or null.
 *
 * ⚠️ NOT a freshness check. A row exists for today from just after local
 * midnight carrying only ctl/atl, so this returns "today" every morning while
 * every watch-sourced field in it is null — which is exactly how the preflight
 * staleness check came to report the recovery feed as current on mornings it
 * had no readings at all. Use `getLatestRecoveryReading` for anything that
 * cares whether there is a READING.
 */
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
