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
