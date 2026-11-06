/**
 * Auto-sync: keep the current and next plan week on the athlete's
 * intervals.icu calendar (and so on the watch) without a button press.
 *
 * Athlete's request, 2026-11-06: "once a plan is approved, sync it to the
 * watch". Runs when a plan is saved or changed (build, adjust, accepted
 * proposal) and daily from the intervals sync cron, so next week arrives as
 * this one ends.
 *
 * Same push as the button (lib/intervals/push-week.ts — replace, never
 * append, only our own events), with the same hard gate: if intervals.icu's
 * max HR disagrees with ours, nothing is pushed, because every percentage
 * target would mean a different bpm range.
 *
 * A week is re-pushed only when its content changed (`watch_pushes`
 * content_hash): a push deletes and recreates its events, so pushing an
 * unchanged week every day would churn the watch for nothing.
 */

import { createHash } from 'node:crypto';
import { supabase } from '@/lib/db/supabase';
import { getActivePlan } from '@/lib/db/plans';
import { getAthleteProfile } from '@/lib/db/profile';
import { parseZonesFromProfile } from '@/lib/utils/zones';
import { userDateStr, userDateStrDaysAgo } from '@/lib/utils/user-time';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { getIntervalsClientForUser } from '@/lib/intervals/sync';
import { pushWeek } from '@/lib/intervals/push-week';
import type { PlanWeek } from '@/lib/db/types';

export interface AutoSyncResult {
  status: 'pushed' | 'unchanged' | 'off' | 'skipped' | 'error';
  reason?: string;
  weeks: { week: number; status: 'pushed' | 'unchanged' | 'error'; created?: number; errors?: string[] }[];
}

/** Stable hash of what a week pushes. Max HR is in it: a change re-pushes. */
export function weekHash(week: PlanWeek, maxHr: number): string {
  return createHash('sha256').update(JSON.stringify({ w: week.workouts ?? {}, maxHr })).digest('hex').slice(0, 32);
}

export async function autoSyncPlanToWatch(userId: string, trigger: string): Promise<AutoSyncResult> {
  const out: AutoSyncResult = { status: 'unchanged', weeks: [] };
  try {
    const { data: token } = await supabase.from('intervals_tokens').select('auto_push').eq('user_id', userId).maybeSingle();
    if (!token) return { ...out, status: 'off', reason: 'intervals.icu not connected' };
    if ((token as { auto_push?: boolean }).auto_push === false) return { ...out, status: 'off', reason: 'auto-sync is off' };

    const [plan, profile] = await Promise.all([getActivePlan(userId), getAthleteProfile(userId)]);
    if (!plan?.start_date) return { ...out, status: 'skipped', reason: 'no active plan with a start date' };
    if (!profile?.max_hr) return { ...out, status: 'skipped', reason: 'no max HR in the profile' };

    const connection = await getIntervalsClientForUser(userId);
    if (!connection) return { ...out, status: 'off', reason: 'intervals.icu not connected' };

    const today = userDateStr();
    const theirMaxHr = await connection.client.getAthleteMaxHr(userDateStrDaysAgo(60), today).catch(() => null);
    if (theirMaxHr !== null && theirMaxHr !== profile.max_hr) {
      return { ...out, status: 'skipped', reason: `max HR differs (intervals.icu ${theirMaxHr}, app ${profile.max_hr}) — reconcile before workouts can be pushed` };
    }

    const { currentWeek, isAfterEnd } = calculateCurrentWeek(plan.start_date, plan.duration_weeks);
    if (isAfterEnd) return { ...out, status: 'skipped', reason: 'the plan has ended' };
    const weeks = (plan.plan_json?.weeks ?? []) as PlanWeek[];
    const bands = parseZonesFromProfile(profile);

    const { data: pushed } = await supabase.from('watch_pushes').select('week_number,content_hash')
      .eq('user_id', userId).eq('plan_id', plan.id);
    const lastHash = new Map(((pushed ?? []) as { week_number: number; content_hash: string }[]).map((r) => [r.week_number, r.content_hash]));

    for (const n of [currentWeek, currentWeek + 1]) {
      const week = weeks.find((w) => w.week_number === n);
      if (!week) continue;
      const hash = weekHash(week, profile.max_hr);
      if (lastHash.get(n) === hash) {
        out.weeks.push({ week: n, status: 'unchanged' });
        continue;
      }
      const r = await pushWeek(connection.client, plan, week, n, bands, profile.max_hr, today);
      const ok = r.errors.length === 0;
      out.weeks.push({ week: n, status: ok ? 'pushed' : 'error', created: r.created, errors: r.errors.length ? r.errors : undefined });
      await supabase.from('watch_pushes').upsert({
        user_id: userId, plan_id: plan.id, week_number: n,
        // A failed push stores no hash, so the next run tries again.
        content_hash: ok ? hash : '',
        pushed_at: new Date().toISOString(), created: r.created,
        errors: r.errors.length ? r.errors : null, trigger,
      }, { onConflict: 'user_id,plan_id,week_number' });
    }
    out.status = out.weeks.some((w) => w.status === 'error') ? 'error'
      : out.weeks.some((w) => w.status === 'pushed') ? 'pushed' : 'unchanged';
    return out;
  } catch (err) {
    console.error('auto-sync to watch failed:', err);
    return { ...out, status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }
}
