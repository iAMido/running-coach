/**
 * Assemble the weekly scorecard from the database.
 *
 * Used by BOTH the `/coach/review` UI and the weekly analysis prompt, so the
 * card the athlete looks at and the card the coach reasons from are the same
 * object. Same reason readiness was extracted next door.
 */

import { supabase } from '@/lib/db/supabase';
import { getActivePlan } from '@/lib/db/plans';
import { readinessForUser } from '@/lib/coach/readiness-service';
import { buildScorecard, type Scorecard, type ScorecardRun } from '@/lib/utils/scorecard';
import { plannedWorkoutForRunDate } from '@/lib/ai/run-reaction';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import type { TrainingPlan } from '@/lib/db/types';

interface WeekRunRow {
  date: string;
  run_type: string | null;
  decoupling_pct: number | null;
  pct_z1: number | null; pct_z2: number | null; pct_z3: number | null;
  pct_z4: number | null; pct_z5: number | null; pct_z6: number | null;
}

/**
 * `weekStart` and `weekEnd` are YYYY-MM-DD, Sunday to Saturday, resolved by the
 * caller in the user's timezone.
 */
export async function buildScorecardForUser(
  userId: string,
  weekStart: string,
  weekEnd: string,
  preloadedPlan?: TrainingPlan | null,
): Promise<Scorecard> {
  const plan = preloadedPlan !== undefined ? preloadedPlan : await getActivePlan(userId);

  const [runsRes, historyRes, readiness] = await Promise.all([
    supabase
      .from('runs')
      .select('date,run_type,decoupling_pct,pct_z1,pct_z2,pct_z3,pct_z4,pct_z5,pct_z6')
      .eq('user_id', userId)
      .gte('date', `${weekStart}T00:00:00Z`)
      .lte('date', `${weekEnd}T23:59:59Z`)
      .order('date', { ascending: true }),
    supabase.from('runs').select('decoupling_pct').eq('user_id', userId).not('decoupling_pct', 'is', null),
    readinessForUser(userId, plan).catch((err) => {
      console.error('scorecard: readiness unavailable:', err);
      return null;
    }),
  ]);

  const runs: ScorecardRun[] = ((runsRes.data ?? []) as WeekRunRow[]).map((r) => {
    // What the plan asked for on that date. Intent must come from the plan —
    // run_type is derived from the zone distribution, so comparing the two
    // would measure the classifier against its own input.
    const { workout } = plannedWorkoutForRunDate(plan, new Date(r.date));
    return {
      date: r.date,
      runType: r.run_type,
      zones: {
        pct_z1: r.pct_z1, pct_z2: r.pct_z2, pct_z3: r.pct_z3,
        pct_z4: r.pct_z4, pct_z5: r.pct_z5, pct_z6: r.pct_z6,
      },
      decouplingPct: r.decoupling_pct,
      plannedTargetHr: workout?.target_hr ?? null,
      plannedType: workout?.type ?? null,
    };
  });

  const weekNumber = plan?.start_date
    ? calculateCurrentWeek(plan.start_date, plan.duration_weeks, new Date(`${weekStart}T12:00:00Z`)).currentWeek
    : null;

  return buildScorecard({
    weekLabel: weekNumber ? `Week ${weekNumber}` : 'This week',
    weekStart,
    weekEnd,
    runs,
    readiness: readiness?.readiness ?? null,
    decouplingHistory: ((historyRes.data ?? []) as { decoupling_pct: number }[]).map((r) => r.decoupling_pct),
  });
}
